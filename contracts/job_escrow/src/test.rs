#![cfg(test)]
extern crate std;
use std::vec;

use super::*;

fn ce(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};
use soroban_sdk::vec as svec;

const DAY: u64 = 24 * 60 * 60;
const START: u64 = 1_800_000_000;

struct Ctx {
    env: Env,
    escrow: JobEscrowClient<'static>,
    token: Address,
    other_token: Address,
    admin: Address,
    guardian: Address,
    mediator: Address,
    fee: Address,
    client: Address,
    freelancer: Address,
}

fn setup() -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);

    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let mediator = Address::generate(&env);
    let fee = Address::generate(&env);
    let client = Address::generate(&env);
    let freelancer = Address::generate(&env);

    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let other_token = env.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&env, &token).mint(&client, &1_000_000_000_000);
    StellarAssetClient::new(&env, &other_token).mint(&client, &1_000_000_000_000);

    let id = env.register(
        JobEscrow,
        (
            admin.clone(),
            guardian.clone(),
            mediator.clone(),
            fee.clone(),
            250u32, // 2.5%
            7 * DAY,
            svec![&env, token.clone()],
        ),
    );
    let escrow = JobEscrowClient::new(&env, &id);
    // Extend lifetimes for the test struct.
    let escrow: JobEscrowClient<'static> = unsafe { core::mem::transmute(escrow) };
    Ctx { env, escrow, token, other_token, admin, guardian, mediator, fee, client, freelancer }
}

fn jid(env: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(env, &[n; 32])
}

fn bal(c: &Ctx, who: &Address) -> i128 {
    TokenClient::new(&c.env, &c.token).balance(who)
}

fn fund(c: &Ctx, n: u8, amount: i128) -> BytesN<32> {
    c.escrow.fund(&jid(&c.env, n), &c.client, &c.freelancer, &c.token, &amount, &(START + 14 * DAY))
}

fn advance(c: &Ctx, secs: u64) {
    let t = c.env.ledger().timestamp();
    c.env.ledger().set_timestamp(t + secs);
}

#[test]
fn happy_path_pays_exactly_once_with_fee() {
    let c = setup();
    let before = bal(&c, &c.client);
    let id = fund(&c, 1, 1_000_0000000);
    assert_eq!(bal(&c, &c.escrow.address), 1_000_0000000);
    assert_eq!(c.escrow.total_locked(&c.token), 1_000_0000000);

    c.escrow.submit_proof(&id, &jid(&c.env, 9));
    c.escrow.approve(&id);

    let job = c.escrow.get_job(&id).unwrap();
    assert_eq!(job.status, JobStatus::Paid);
    assert_eq!(bal(&c, &c.freelancer), 975_0000000);
    assert_eq!(bal(&c, &c.fee), 25_0000000);
    assert_eq!(bal(&c, &c.escrow.address), 0);
    assert_eq!(bal(&c, &c.client), before - 1_000_0000000);
    assert_eq!(c.escrow.total_locked(&c.token), 0);

    // Double release is impossible.
    assert_eq!(c.escrow.try_approve(&id), Err(Ok(ce(Error::InvalidState))));
    assert_eq!(c.escrow.try_claim_after_review(&id), Err(Ok(ce(Error::InvalidState))));
    assert_eq!(c.escrow.try_refund_expired(&id), Err(Ok(ce(Error::InvalidState))));
}

#[test]
fn duplicate_job_id_rejected() {
    let c = setup();
    fund(&c, 1, 100);
    let r = c.escrow.try_fund(&jid(&c.env, 1), &c.client, &c.freelancer, &c.token, &100, &(START + DAY));
    assert_eq!(r, Err(Ok(ce(Error::JobExists))));
}

#[test]
fn funding_validation() {
    let c = setup();
    let id = jid(&c.env, 2);
    let dl = START + DAY;
    assert_eq!(c.escrow.try_fund(&id, &c.client, &c.freelancer, &c.other_token, &100, &dl), Err(Ok(ce(Error::TokenNotAllowed))));
    assert_eq!(c.escrow.try_fund(&id, &c.client, &c.freelancer, &c.token, &0, &dl), Err(Ok(ce(Error::InvalidAmount))));
    assert_eq!(c.escrow.try_fund(&id, &c.client, &c.freelancer, &c.token, &-5, &dl), Err(Ok(ce(Error::InvalidAmount))));
    assert_eq!(c.escrow.try_fund(&id, &c.client, &c.client, &c.token, &100, &dl), Err(Ok(ce(Error::SameParty))));
    assert_eq!(c.escrow.try_fund(&id, &c.client, &c.freelancer, &c.token, &100, &START), Err(Ok(ce(Error::DeadlineInPast))));
}

#[test]
fn funding_requires_client_auth() {
    let c = setup();
    // Clear mocked auths: without the client's signature, funding must fail.
    c.env.set_auths(&[]);
    let r = c.escrow.try_fund(&jid(&c.env, 3), &c.client, &c.freelancer, &c.token, &100, &(START + DAY));
    assert!(r.is_err());
}

#[test]
fn refund_after_deadline_only_without_pending_proof() {
    let c = setup();
    let before = bal(&c, &c.client);
    let id = fund(&c, 4, 500);
    assert_eq!(c.escrow.try_refund_expired(&id), Err(Ok(ce(Error::DeadlineNotReached))));
    advance(&c, 15 * DAY);
    c.escrow.refund_expired(&id);
    assert_eq!(bal(&c, &c.client), before);
    assert_eq!(c.escrow.get_job(&id).unwrap().status, JobStatus::Refunded);
    assert_eq!(c.escrow.total_locked(&c.token), 0);

    // With proof pending, client cannot refund even after deadline.
    let id2 = c.escrow.fund(&jid(&c.env, 5), &c.client, &c.freelancer, &c.token, &500, &(c.env.ledger().timestamp() + DAY));
    c.escrow.submit_proof(&id2, &jid(&c.env, 7));
    advance(&c, 2 * DAY);
    assert_eq!(c.escrow.try_refund_expired(&id2), Err(Ok(ce(Error::InvalidState))));
}

#[test]
fn freelancer_can_claim_if_client_ghosts() {
    let c = setup();
    let id = fund(&c, 6, 10_000);
    c.escrow.submit_proof(&id, &jid(&c.env, 1));
    advance(&c, 6 * DAY);
    assert_eq!(c.escrow.try_claim_after_review(&id), Err(Ok(ce(Error::ReviewWindowOpen))));
    advance(&c, DAY);
    c.escrow.claim_after_review(&id);
    assert_eq!(bal(&c, &c.freelancer), 9_750);
    assert_eq!(bal(&c, &c.fee), 250);
}

#[test]
fn revisions_extend_deadline_and_are_capped() {
    let c = setup();
    let id = fund(&c, 7, 1_000);
    for _ in 0..MAX_REVISIONS {
        c.escrow.submit_proof(&id, &jid(&c.env, 2));
        c.escrow.request_revision(&id);
    }
    c.escrow.submit_proof(&id, &jid(&c.env, 2));
    assert_eq!(c.escrow.try_request_revision(&id), Err(Ok(ce(Error::TooManyRevisions))));
    let job = c.escrow.get_job(&id).unwrap();
    assert!(job.deadline >= START + 7 * DAY);
}

#[test]
fn dispute_mediator_can_only_split_between_parties() {
    let c = setup();
    let before_client = bal(&c, &c.client);
    let id = fund(&c, 8, 1_000);
    c.escrow.submit_proof(&id, &jid(&c.env, 3));
    c.escrow.open_dispute(&id, &c.client);
    // No approval or freelancer cancel while disputed.
    assert_eq!(c.escrow.try_approve(&id), Err(Ok(ce(Error::InvalidState))));
    assert_eq!(c.escrow.try_resolve_dispute(&id, &1_001), Err(Ok(ce(Error::InvalidAmount))));
    c.escrow.resolve_dispute(&id, &600);
    assert_eq!(bal(&c, &c.freelancer), 585); // 600 - 2.5%
    assert_eq!(bal(&c, &c.fee), 15);
    assert_eq!(bal(&c, &c.client), before_client - 600);
    assert_eq!(bal(&c, &c.mediator), 0);
    assert_eq!(bal(&c, &c.admin), 0);
    assert_eq!(c.escrow.get_job(&id).unwrap().status, JobStatus::Resolved);
}

#[test]
fn non_party_cannot_dispute() {
    let c = setup();
    let id = fund(&c, 9, 1_000);
    let stranger = Address::generate(&c.env);
    assert_eq!(c.escrow.try_open_dispute(&id, &stranger), Err(Ok(ce(Error::NotParty))));
}

#[test]
fn stale_dispute_without_proof_refunds_client() {
    let c = setup();
    let id = fund(&c, 10, 1_000);
    c.escrow.open_dispute(&id, &c.freelancer);
    assert_eq!(c.escrow.try_resolve_stale_dispute(&id), Err(Ok(ce(Error::DisputeNotStale))));
    advance(&c, DISPUTE_TIMEOUT_SECS);
    c.escrow.resolve_stale_dispute(&id);
    let j = c.escrow.get_job(&id).unwrap();
    assert_eq!(j.paid_freelancer + j.paid_fee + j.refunded_client, 1_000);
    assert_eq!(j.refunded_client, 1_000);
}

#[test]
fn stale_dispute_over_pending_proof_pays_freelancer() {
    let c = setup();
    let id = fund(&c, 20, 1_000);
    c.escrow.submit_proof(&id, &jid(&c.env, 1));
    c.escrow.open_dispute(&id, &c.client);
    advance(&c, DISPUTE_TIMEOUT_SECS);
    c.escrow.resolve_stale_dispute(&id);
    let j = c.escrow.get_job(&id).unwrap();
    assert_eq!(j.refunded_client, 0);
    assert_eq!(j.paid_freelancer, 975);
}

#[test]
fn job_ids_cannot_be_squatted() {
    let c = setup();
    let attacker = Address::generate(&c.env);
    StellarAssetClient::new(&c.env, &c.token).mint(&attacker, &10);
    let salt = jid(&c.env, 30);
    // Attacker funds the same salt first, with 1 stroop.
    let squat = c.escrow.fund(&salt, &attacker, &c.freelancer, &c.token, &1, &(START + DAY));
    // The real client's job still funds, under a different id.
    let real = c.escrow.fund(&salt, &c.client, &c.freelancer, &c.token, &1_000, &(START + DAY));
    assert_ne!(squat, real);
    assert_eq!(real, c.escrow.job_id_for(&c.client, &salt));
    assert_eq!(c.escrow.get_job(&real).unwrap().amount, 1_000);
}

#[test]
fn late_proof_cannot_block_refund() {
    let c = setup();
    let id = fund(&c, 31, 1_000);
    advance(&c, 15 * DAY);
    assert_eq!(c.escrow.try_submit_proof(&id, &jid(&c.env, 2)), Err(Ok(ce(Error::DeadlinePassed))));
    c.escrow.refund_expired(&id);
}

#[test]
fn mediator_is_snapshotted_per_job() {
    let c = setup();
    let id = fund(&c, 32, 1_000);
    c.escrow.open_dispute(&id, &c.client);
    let new_mediator = Address::generate(&c.env);
    c.escrow.set_roles(&c.guardian, &new_mediator, &c.fee);
    assert_eq!(c.escrow.get_job(&id).unwrap().mediator, c.mediator);
    c.escrow.resolve_dispute(&id, &500);
    // Auth was demanded from the snapshotted mediator, not the new one.
    let auths = c.env.auths();
    assert!(auths.iter().any(|(a, _)| *a == c.mediator));
    assert!(!auths.iter().any(|(a, _)| *a == new_mediator));
}

#[test]
fn dispute_clears_pending_settlement() {
    let c = setup();
    let id = fund(&c, 33, 1_000);
    c.escrow.propose_settlement(&id, &c.client, &100);
    c.escrow.open_dispute(&id, &c.freelancer);
    assert_eq!(c.escrow.try_accept_settlement(&id, &c.freelancer, &100), Err(Ok(ce(Error::NoSettlement))));
}

#[test]
fn mutual_settlement_requires_counterparty_and_exact_amount() {
    let c = setup();
    let id = fund(&c, 11, 1_000);
    c.escrow.propose_settlement(&id, &c.client, &400);
    assert_eq!(c.escrow.try_accept_settlement(&id, &c.client, &400), Err(Ok(ce(Error::NoSettlement))));
    assert_eq!(c.escrow.try_accept_settlement(&id, &c.freelancer, &401), Err(Ok(ce(Error::NoSettlement))));
    c.escrow.accept_settlement(&id, &c.freelancer, &400);
    assert_eq!(bal(&c, &c.freelancer), 390);
}

#[test]
fn freelancer_cancel_refunds_client() {
    let c = setup();
    let before = bal(&c, &c.client);
    let id = fund(&c, 12, 777);
    c.escrow.cancel_by_freelancer(&id);
    assert_eq!(bal(&c, &c.client), before);
}

#[test]
fn pause_blocks_funding_but_not_exits() {
    let c = setup();
    let id = fund(&c, 13, 1_000);
    c.escrow.pause(&c.guardian);
    let r = c.escrow.try_fund(&jid(&c.env, 14), &c.client, &c.freelancer, &c.token, &1, &(START + DAY));
    assert_eq!(r, Err(Ok(ce(Error::Paused))));
    c.escrow.approve(&id);
    assert_eq!(c.escrow.get_job(&id).unwrap().status, JobStatus::Paid);
    let stranger = Address::generate(&c.env);
    assert_eq!(c.escrow.try_pause(&stranger), Err(Ok(ce(Error::Unauthorized))));
    c.escrow.unpause();
    fund(&c, 15, 1);
}

#[test]
fn fee_change_does_not_affect_existing_jobs() {
    let c = setup();
    let id = fund(&c, 16, 10_000);
    c.escrow.set_fee(&1_000);
    c.escrow.approve(&id);
    assert_eq!(bal(&c, &c.fee), 250);
    assert_eq!(c.escrow.try_set_fee(&1_001), Err(Ok(ce(Error::InvalidFee))));
}

#[test]
fn upgrade_is_timelocked() {
    let c = setup();
    let h = BytesN::from_array(&c.env, &[1; 32]);
    assert_eq!(c.escrow.try_execute_upgrade(), Err(Ok(ce(Error::NoPendingUpgrade))));
    c.escrow.propose_upgrade(&h);
    assert_eq!(c.escrow.try_execute_upgrade(), Err(Ok(ce(Error::UpgradeNotReady))));
    c.escrow.cancel_upgrade();
    assert!(c.escrow.pending_upgrade().is_none());
}

#[test]
fn admin_handover_is_two_step() {
    let c = setup();
    let next = Address::generate(&c.env);
    c.escrow.propose_admin(&next);
    assert_eq!(c.escrow.get_config().admin, c.admin);
    c.escrow.accept_admin();
    assert_eq!(c.escrow.get_config().admin, next);
}

// ───────────────────────── property-based tests ─────────────────────────

#[derive(Debug, Clone)]
enum Op {
    Fund(u8, i128),
    Proof(u8),
    Revision(u8),
    Approve(u8),
    Claim(u8),
    Refund(u8),
    Cancel(u8),
    Dispute(u8, bool),
    Resolve(u8, u16),
    Stale(u8),
    Advance(u32),
}

fn op() -> impl Strategy<Value = Op> {
    let id = 0u8..6;
    prop_oneof![
        (id.clone(), 1i128..1_000_000_000).prop_map(|(i, a)| Op::Fund(i, a)),
        id.clone().prop_map(Op::Proof),
        id.clone().prop_map(Op::Revision),
        id.clone().prop_map(Op::Approve),
        id.clone().prop_map(Op::Claim),
        id.clone().prop_map(Op::Refund),
        id.clone().prop_map(Op::Cancel),
        (id.clone(), any::<bool>()).prop_map(|(i, b)| Op::Dispute(i, b)),
        (id.clone(), 0u16..=10_000).prop_map(|(i, p)| Op::Resolve(i, p)),
        id.prop_map(Op::Stale),
        (0u32..(40 * 24 * 3600)).prop_map(Op::Advance),
    ]
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 48, .. ProptestConfig::default() })]

    /// For any sequence of calls:
    /// * contract balance == total_locked == sum of non-terminal job amounts
    /// * every terminal job distributed exactly its amount
    /// * value is conserved across client, freelancer, fee collector and contract
    #[test]
    fn escrow_conserves_value(ops in proptest::collection::vec(op(), 1..40)) {
        let c = setup();
        let start_total = bal(&c, &c.client);
        for o in ops {
            let id = |i: u8| c.escrow.job_id_for(&c.client, &jid(&c.env, i));
            match o {
                Op::Fund(i, a) => {
                    let dl = c.env.ledger().timestamp() + 5 * DAY;
                    let _ = c.escrow.try_fund(&jid(&c.env, i), &c.client, &c.freelancer, &c.token, &a, &dl);
                }
                Op::Proof(i) => { let _ = c.escrow.try_submit_proof(&id(i), &id(99)); }
                Op::Revision(i) => { let _ = c.escrow.try_request_revision(&id(i)); }
                Op::Approve(i) => { let _ = c.escrow.try_approve(&id(i)); }
                Op::Claim(i) => { let _ = c.escrow.try_claim_after_review(&id(i)); }
                Op::Refund(i) => { let _ = c.escrow.try_refund_expired(&id(i)); }
                Op::Cancel(i) => { let _ = c.escrow.try_cancel_by_freelancer(&id(i)); }
                Op::Dispute(i, by_client) => {
                    let who = if by_client { c.client.clone() } else { c.freelancer.clone() };
                    let _ = c.escrow.try_open_dispute(&id(i), &who);
                }
                Op::Resolve(i, pct) => {
                    if let Some(j) = c.escrow.get_job(&id(i)) {
                        let fa = j.amount * pct as i128 / 10_000;
                        let _ = c.escrow.try_resolve_dispute(&id(i), &fa);
                    }
                }
                Op::Stale(i) => { let _ = c.escrow.try_resolve_stale_dispute(&id(i)); }
                Op::Advance(s) => advance(&c, s as u64),
            }

            let mut open_sum = 0i128;
            for i in 0u8..6 {
                if let Some(j) = c.escrow.get_job(&c.escrow.job_id_for(&c.client, &jid(&c.env, i))) {
                    if j.status.is_terminal() {
                        prop_assert_eq!(j.paid_freelancer + j.paid_fee + j.refunded_client, j.amount);
                        prop_assert!(j.paid_freelancer >= 0 && j.paid_fee >= 0 && j.refunded_client >= 0);
                    } else {
                        open_sum += j.amount;
                    }
                }
            }
            prop_assert_eq!(c.escrow.total_locked(&c.token), open_sum);
            prop_assert_eq!(bal(&c, &c.escrow.address), open_sum);
            let total = bal(&c, &c.client) + bal(&c, &c.freelancer) + bal(&c, &c.fee) + bal(&c, &c.escrow.address);
            prop_assert_eq!(total, start_total);
        }
    }
}

#[test]
fn job_id_derivation_is_stable() {
    // Must equal the TypeScript derivation in src/lib/server/escrow.ts (tests/unit/escrow-args.test.ts).
    let env = Env::default();
    let id = env.register(JobEscrow, (Address::generate(&env), Address::generate(&env), Address::generate(&env), Address::generate(&env), 0u32, 86_400u64, soroban_sdk::Vec::<Address>::new(&env)));
    let c = JobEscrowClient::new(&env, &id);
    let client = Address::from_str(&env, "GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR");
    let got = c.job_id_for(&client, &BytesN::from_array(&env, &[7; 32]));
    std::println!("RUST_JOB_ID {:?}", got);
    assert_eq!(got.to_array().iter().map(|b| std::format!("{:02x}", b)).collect::<std::string::String>(), "ae8afb6ee1bf72d47a7709ea20b54c1cfd9e586ddeb35ccf8df6c86677210a9e");
}
