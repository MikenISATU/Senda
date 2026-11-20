#![no_std]
#![allow(deprecated)]
//! # Senda job escrow
//!
//! Holds a client's payment for one freelance job until an authorized outcome:
//!
//! ```text
//! fund ──► Funded ──submit_proof──► ProofSubmitted ──approve──────────► Paid
//!            │  ▲                        │   │      ──claim_after_review► Paid
//!            │  └────request_revision────┘   │
//!            │        (RevisionRequested)    └─open_dispute─► Disputed ─resolve─► Resolved
//!            ├─refund_expired (after deadline, no pending proof) ─► Refunded
//!            └─cancel_by_freelancer ─► Refunded
//! ```
//!
//! Invariants (see tests):
//! * Only allow-listed tokens; the exact `amount` is pulled from the client at funding.
//! * One job id funds exactly once; a terminal job never pays again.
//! * Every payout sums to exactly the escrowed amount (net + fee [+ client part]).
//! * Job ids are derived on-chain from the client address and a salt, so nobody
//!   can pre-register ("squat") another client's job id.
//! * No function lets admin, guardian or mediator send escrowed funds to
//!   themselves. The mediator is snapshotted per job at funding and can only
//!   split between client and freelancer.
//! * Trust note: the admin can upgrade the contract code after a 7-day public
//!   timelock. Use a multisig admin; users can watch `pending_upgrade`.
//! * Pausing blocks new funding only. Refunds, approvals and dispute exits always work.
//! * `total_locked(token)` always equals the sum of non-terminal job amounts.

mod storage;
#[cfg(test)]
mod test;

use senda_shared::{split_fee, PendingUpgrade, MAX_FEE_BPS, UPGRADE_DELAY_SECS};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    xdr::ToXdr, Address, Bytes, BytesN, Env, Vec,
};
use storage::*;

/// Max client revision requests per job before they must approve or dispute.
pub const MAX_REVISIONS: u32 = 5;
/// If the mediator does not act on a dispute within this window, anyone can
/// trigger the state-based fallback (see `resolve_stale_dispute`).
pub const DISPUTE_TIMEOUT_SECS: u64 = 30 * 24 * 60 * 60;
/// Bounds for the client review window.
pub const MIN_REVIEW_SECS: u64 = 24 * 60 * 60;
pub const MAX_REVIEW_SECS: u64 = 30 * 24 * 60 * 60;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    TokenNotAllowed = 2,
    InvalidAmount = 3,
    JobExists = 4,
    JobNotFound = 5,
    InvalidState = 6,
    NotParty = 7,
    DeadlineInPast = 8,
    DeadlineNotReached = 9,
    ReviewWindowOpen = 10,
    TooManyRevisions = 11,
    InvalidFee = 12,
    SameParty = 13,
    Unauthorized = 14,
    UpgradeNotReady = 15,
    NoPendingUpgrade = 16,
    DisputeNotStale = 17,
    NoSettlement = 18,
    InvalidReviewPeriod = 19,
    Overflow = 20,
    NoPendingAdmin = 21,
    DeadlinePassed = 22,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum JobStatus {
    Funded = 0,
    ProofSubmitted = 1,
    RevisionRequested = 2,
    Disputed = 3,
    Paid = 4,
    Refunded = 5,
    Resolved = 6,
}

impl JobStatus {
    pub fn is_terminal(&self) -> bool {
        matches!(self, JobStatus::Paid | JobStatus::Refunded | JobStatus::Resolved)
    }
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Job {
    pub client: Address,
    pub freelancer: Address,
    pub token: Address,
    pub amount: i128,
    /// Fee snapshot taken at funding; later fee changes never affect this job.
    pub fee_bps: u32,
    pub status: JobStatus,
    /// Work deadline (unix seconds). After it, a client may refund if no proof is pending.
    pub deadline: u64,
    pub review_period: u64,
    pub proof_hash: Option<BytesN<32>>,
    pub proof_at: u64,
    pub revisions: u32,
    pub funded_at: u64,
    pub disputed_at: u64,
    /// True if the dispute was opened while proof was pending review.
    pub disputed_with_proof: bool,
    /// Mediator snapshot at funding; later role changes never affect this job.
    pub mediator: Address,
    /// Pending mutual-settlement proposal (proposer, freelancer gross amount).
    pub settle_proposer: Option<Address>,
    pub settle_amount: i128,
    /// Amount paid to the freelancer (net of fee) once terminal.
    pub paid_freelancer: i128,
    pub paid_fee: i128,
    pub refunded_client: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub guardian: Address,
    pub mediator: Address,
    pub fee_collector: Address,
    pub fee_bps: u32,
    pub review_period: u64,
    pub paused: bool,
}

#[contract]
pub struct JobEscrow;

fn now(env: &Env) -> u64 {
    env.ledger().timestamp()
}

fn tok<'a>(env: &'a Env, t: &Address) -> token::Client<'a> {
    token::Client::new(env, t)
}

/// Pays out a job and closes it. `freelancer_gross` is the freelancer's share
/// before the platform fee; the remainder of `job.amount` returns to the client.
fn settle(env: &Env, id: &BytesN<32>, job: &mut Job, freelancer_gross: i128, status: JobStatus) {
    if freelancer_gross < 0 || freelancer_gross > job.amount {
        panic_with_error!(env, Error::InvalidAmount);
    }
    let (net, fee) = split_fee(freelancer_gross, job.fee_bps)
        .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));
    let client_part = job
        .amount
        .checked_sub(freelancer_gross)
        .unwrap_or_else(|| panic_with_error!(env, Error::Overflow));

    // Effects first: mark terminal and unlock before any external call.
    job.status = status;
    job.paid_freelancer = net;
    job.paid_fee = fee;
    job.refunded_client = client_part;
    job.settle_proposer = None;
    job.settle_amount = 0;
    put_job(env, id, job);
    sub_locked(env, &job.token, job.amount);

    // Interactions.
    let cfg = get_config(env);
    let this = env.current_contract_address();
    let t = tok(env, &job.token);
    if net > 0 {
        t.transfer(&this, &job.freelancer, &net);
    }
    if fee > 0 {
        t.transfer(&this, &cfg.fee_collector, &fee);
    }
    if client_part > 0 {
        t.transfer(&this, &job.client, &client_part);
    }
    env.events().publish(
        (symbol_short!("settled"), id.clone()),
        (status as u32, net, fee, client_part),
    );
}

fn derive_job_id(env: &Env, client: &Address, salt: &BytesN<32>) -> BytesN<32> {
    let mut b: Bytes = client.clone().to_xdr(env);
    b.append(&Bytes::from(salt.clone()));
    env.crypto().sha256(&b).to_bytes()
}

fn load_active(env: &Env, id: &BytesN<32>) -> Job {
    let job = get_job(env, id).unwrap_or_else(|| panic_with_error!(env, Error::JobNotFound));
    if job.status.is_terminal() {
        panic_with_error!(env, Error::InvalidState);
    }
    job
}

fn require_party(env: &Env, job: &Job, who: &Address) {
    if who != &job.client && who != &job.freelancer {
        panic_with_error!(env, Error::NotParty);
    }
    who.require_auth();
}

#[contractimpl]
impl JobEscrow {
    pub fn __constructor(
        env: Env,
        admin: Address,
        guardian: Address,
        mediator: Address,
        fee_collector: Address,
        fee_bps: u32,
        review_period: u64,
        allowed_tokens: Vec<Address>,
    ) {
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        if !(MIN_REVIEW_SECS..=MAX_REVIEW_SECS).contains(&review_period) {
            panic_with_error!(&env, Error::InvalidReviewPeriod);
        }
        put_config(
            &env,
            &Config { admin, guardian, mediator, fee_collector, fee_bps, review_period, paused: false },
        );
        for t in allowed_tokens.iter() {
            set_token_allowed(&env, &t, true);
        }
    }

    // ───────────────────────────── job lifecycle ─────────────────────────────

    /// Client locks exactly `amount` of `token`. The job id is
    /// sha256(client_xdr || salt), computed here, and returned.
    pub fn fund(
        env: Env,
        salt: BytesN<32>,
        client: Address,
        freelancer: Address,
        token: Address,
        amount: i128,
        deadline: u64,
    ) -> BytesN<32> {
        client.require_auth();
        let job_id = derive_job_id(&env, &client, &salt);
        let cfg = get_config(&env);
        if cfg.paused {
            panic_with_error!(&env, Error::Paused);
        }
        if !is_token_allowed(&env, &token) {
            panic_with_error!(&env, Error::TokenNotAllowed);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        if client == freelancer {
            panic_with_error!(&env, Error::SameParty);
        }
        if deadline <= now(&env) {
            panic_with_error!(&env, Error::DeadlineInPast);
        }
        if has_job(&env, &job_id) {
            panic_with_error!(&env, Error::JobExists);
        }
        let job = Job {
            client: client.clone(),
            freelancer: freelancer.clone(),
            token: token.clone(),
            amount,
            fee_bps: cfg.fee_bps,
            status: JobStatus::Funded,
            deadline,
            review_period: cfg.review_period,
            proof_hash: None,
            proof_at: 0,
            revisions: 0,
            funded_at: now(&env),
            disputed_at: 0,
            disputed_with_proof: false,
            mediator: cfg.mediator.clone(),
            settle_proposer: None,
            settle_amount: 0,
            paid_freelancer: 0,
            paid_fee: 0,
            refunded_client: 0,
        };
        put_job(&env, &job_id, &job);
        add_locked(&env, &token, amount);
        // Pull funds. If the transfer fails the whole transaction reverts.
        tok(&env, &token).transfer(&client, &env.current_contract_address(), &amount);
        env.events()
            .publish((symbol_short!("funded"), job_id.clone()), (client, freelancer, token, amount, deadline));
        job_id
    }

    /// Freelancer records a hash of the delivered work (evidence bundle).
    pub fn submit_proof(env: Env, job_id: BytesN<32>, proof_hash: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        job.freelancer.require_auth();
        if !matches!(job.status, JobStatus::Funded | JobStatus::RevisionRequested) {
            panic_with_error!(&env, Error::InvalidState);
        }
        // A late proof must not block the client's refund.
        if now(&env) > job.deadline {
            panic_with_error!(&env, Error::DeadlinePassed);
        }
        job.status = JobStatus::ProofSubmitted;
        job.proof_hash = Some(proof_hash.clone());
        job.proof_at = now(&env);
        job.settle_proposer = None;
        job.settle_amount = 0;
        put_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("proof"), job_id), proof_hash);
    }

    /// Client asks for changes. Extends the deadline so the freelancer has time.
    pub fn request_revision(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        job.client.require_auth();
        if job.status != JobStatus::ProofSubmitted {
            panic_with_error!(&env, Error::InvalidState);
        }
        if job.revisions >= MAX_REVISIONS {
            panic_with_error!(&env, Error::TooManyRevisions);
        }
        job.revisions += 1;
        job.status = JobStatus::RevisionRequested;
        job.settle_proposer = None;
        job.settle_amount = 0;
        let min_deadline = now(&env)
            .checked_add(job.review_period)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if job.deadline < min_deadline {
            job.deadline = min_deadline;
        }
        put_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("revision"), job_id), job.revisions);
    }

    /// Client approves and releases payment (net of fee) to the freelancer.
    pub fn approve(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        job.client.require_auth();
        if job.status == JobStatus::Disputed {
            panic_with_error!(&env, Error::InvalidState);
        }
        let amount = job.amount;
        settle(&env, &job_id, &mut job, amount, JobStatus::Paid);
    }

    /// Freelancer claims payment if the client ignored submitted proof for the
    /// whole review window. Prevents a client from stalling forever.
    pub fn claim_after_review(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        job.freelancer.require_auth();
        if job.status != JobStatus::ProofSubmitted {
            panic_with_error!(&env, Error::InvalidState);
        }
        let open_until = job
            .proof_at
            .checked_add(job.review_period)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if now(&env) < open_until {
            panic_with_error!(&env, Error::ReviewWindowOpen);
        }
        let amount = job.amount;
        settle(&env, &job_id, &mut job, amount, JobStatus::Paid);
    }

    /// Full refund to the client after the deadline when no proof is pending.
    /// Permissionless: funds can only go back to the client. Works while paused.
    pub fn refund_expired(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        if !matches!(job.status, JobStatus::Funded | JobStatus::RevisionRequested) {
            panic_with_error!(&env, Error::InvalidState);
        }
        if now(&env) <= job.deadline {
            panic_with_error!(&env, Error::DeadlineNotReached);
        }
        settle(&env, &job_id, &mut job, 0, JobStatus::Refunded);
    }

    /// Freelancer walks away; the client gets everything back.
    pub fn cancel_by_freelancer(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        job.freelancer.require_auth();
        if job.status == JobStatus::Disputed {
            panic_with_error!(&env, Error::InvalidState);
        }
        settle(&env, &job_id, &mut job, 0, JobStatus::Refunded);
    }

    /// Either party escalates to the configured mediator.
    pub fn open_dispute(env: Env, job_id: BytesN<32>, by: Address) {
        let mut job = load_active(&env, &job_id);
        require_party(&env, &job, &by);
        if job.status == JobStatus::Disputed {
            panic_with_error!(&env, Error::InvalidState);
        }
        job.disputed_with_proof = job.status == JobStatus::ProofSubmitted;
        job.status = JobStatus::Disputed;
        job.disputed_at = now(&env);
        job.settle_proposer = None;
        job.settle_amount = 0;
        put_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("dispute"), job_id), by);
    }

    /// Mediator splits the escrow between freelancer and client only.
    pub fn resolve_dispute(env: Env, job_id: BytesN<32>, freelancer_amount: i128) {
        let mut job = load_active(&env, &job_id);
        job.mediator.require_auth();
        if job.status != JobStatus::Disputed {
            panic_with_error!(&env, Error::InvalidState);
        }
        settle(&env, &job_id, &mut job, freelancer_amount, JobStatus::Resolved);
    }

    /// Fallback if the mediator never acts, callable by anyone. Decided by state,
    /// so opening a dispute is never a free 50%: if proof was pending review the
    /// freelancer is paid; otherwise the client is refunded.
    pub fn resolve_stale_dispute(env: Env, job_id: BytesN<32>) {
        let mut job = load_active(&env, &job_id);
        if job.status != JobStatus::Disputed {
            panic_with_error!(&env, Error::InvalidState);
        }
        let stale_at = job
            .disputed_at
            .checked_add(DISPUTE_TIMEOUT_SECS)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if now(&env) < stale_at {
            panic_with_error!(&env, Error::DisputeNotStale);
        }
        let freelancer_gross = if job.disputed_with_proof { job.amount } else { 0 };
        settle(&env, &job_id, &mut job, freelancer_gross, JobStatus::Resolved);
    }

    /// Either party proposes a split; the other party accepts with `accept_settlement`.
    pub fn propose_settlement(env: Env, job_id: BytesN<32>, by: Address, freelancer_amount: i128) {
        let mut job = load_active(&env, &job_id);
        require_party(&env, &job, &by);
        if freelancer_amount < 0 || freelancer_amount > job.amount {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        job.settle_proposer = Some(by.clone());
        job.settle_amount = freelancer_amount;
        put_job(&env, &job_id, &job);
        env.events().publish((symbol_short!("propose"), job_id), (by, freelancer_amount));
    }

    pub fn accept_settlement(env: Env, job_id: BytesN<32>, by: Address, freelancer_amount: i128) {
        let mut job = load_active(&env, &job_id);
        require_party(&env, &job, &by);
        let proposer = job.settle_proposer.clone().unwrap_or_else(|| panic_with_error!(&env, Error::NoSettlement));
        // Acceptor must be the counter-party and must confirm the exact amount.
        if proposer == by || job.settle_amount != freelancer_amount {
            panic_with_error!(&env, Error::NoSettlement);
        }
        settle(&env, &job_id, &mut job, freelancer_amount, JobStatus::Resolved);
    }

    // ─────────────────────────────── reads ───────────────────────────────

    /// The id `fund` will assign for this client and salt.
    pub fn job_id_for(env: Env, client: Address, salt: BytesN<32>) -> BytesN<32> {
        derive_job_id(&env, &client, &salt)
    }

    pub fn get_job(env: Env, job_id: BytesN<32>) -> Option<Job> {
        get_job(&env, &job_id)
    }

    pub fn get_config(env: Env) -> Config {
        get_config(&env)
    }

    pub fn total_locked(env: Env, token: Address) -> i128 {
        get_locked(&env, &token)
    }

    pub fn is_token_allowed(env: Env, token: Address) -> bool {
        is_token_allowed(&env, &token)
    }

    pub fn pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        get_pending_upgrade(&env)
    }

    // ──────────────────────────── governance ────────────────────────────
    // None of these can move escrowed funds.

    pub fn pause(env: Env, by: Address) {
        let mut cfg = get_config(&env);
        if by != cfg.guardian && by != cfg.admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        by.require_auth();
        cfg.paused = true;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("paused"),), by);
    }

    pub fn unpause(env: Env) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        cfg.paused = false;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    /// Applies to jobs funded after the change only.
    pub fn set_fee(env: Env, fee_bps: u32) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        if fee_bps > MAX_FEE_BPS {
            panic_with_error!(&env, Error::InvalidFee);
        }
        cfg.fee_bps = fee_bps;
        put_config(&env, &cfg);
    }

    pub fn set_review_period(env: Env, review_period: u64) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        if !(MIN_REVIEW_SECS..=MAX_REVIEW_SECS).contains(&review_period) {
            panic_with_error!(&env, Error::InvalidReviewPeriod);
        }
        cfg.review_period = review_period;
        put_config(&env, &cfg);
    }

    pub fn set_roles(env: Env, guardian: Address, mediator: Address, fee_collector: Address) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        cfg.guardian = guardian;
        cfg.mediator = mediator;
        cfg.fee_collector = fee_collector;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("roles"),), ());
    }

    /// Only affects new funding; existing jobs keep their token.
    pub fn set_token_allowed(env: Env, token: Address, allowed: bool) {
        get_config(&env).admin.require_auth();
        set_token_allowed(&env, &token, allowed);
    }

    pub fn propose_admin(env: Env, new_admin: Address) {
        get_config(&env).admin.require_auth();
        set_pending_admin(&env, &new_admin);
    }

    pub fn accept_admin(env: Env) {
        let pending = get_pending_admin(&env).unwrap_or_else(|| panic_with_error!(&env, Error::NoPendingAdmin));
        pending.require_auth();
        let mut cfg = get_config(&env);
        cfg.admin = pending;
        put_config(&env, &cfg);
        clear_pending_admin(&env);
    }

    /// Step 1 of a timelocked upgrade (admin should be a multisig account).
    pub fn propose_upgrade(env: Env, wasm_hash: BytesN<32>) {
        get_config(&env).admin.require_auth();
        let eta = now(&env)
            .checked_add(UPGRADE_DELAY_SECS)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        set_pending_upgrade(&env, &PendingUpgrade { wasm_hash: wasm_hash.clone(), eta });
        env.events().publish((symbol_short!("upg_prop"),), (wasm_hash, eta));
    }

    pub fn cancel_upgrade(env: Env) {
        let cfg = get_config(&env);
        cfg.admin.require_auth();
        clear_pending_upgrade(&env);
    }

    /// Step 2: after the delay. Gives users time to exit before new code runs.
    pub fn execute_upgrade(env: Env) {
        get_config(&env).admin.require_auth();
        let p = get_pending_upgrade(&env).unwrap_or_else(|| panic_with_error!(&env, Error::NoPendingUpgrade));
        if now(&env) < p.eta {
            panic_with_error!(&env, Error::UpgradeNotReady);
        }
        clear_pending_upgrade(&env);
        env.deployer().update_current_contract_wasm(p.wasm_hash.clone());
        env.events().publish((symbol_short!("upgraded"),), p.wasm_hash);
    }
}
