#![no_std]
#![allow(deprecated)]
//! # Senda fee splitter
//!
//! One contract does two jobs, and never holds a user's money:
//!
//! ```text
//! pay(from, to, token, amount, kind)
//!     from ──► to                 amount minus the fee
//!     from ──► treasury           fee x treasury share
//!     from ──► community          fee x community share      (all in one transaction)
//!
//! distribute(token)               anyone may call
//!     contract balance ──► treasury / community by share
//!     (used for job fees, which the escrow contract sends here)
//! ```
//!
//! Invariants (see tests):
//! * `pay` moves exactly `amount` out of `from`: recipient + every fee share = amount.
//! * The fee rate is capped at 10% and is read from the contract, never from the caller.
//! * Fee shares always total 100%; the last recipient absorbs rounding dust.
//! * Only allow-listed tokens. Nothing in `pay` passes through the contract's own balance.
//! * The admin can change fee rates (within the cap) and who receives the fees,
//!   but has no function that touches a payer's or recipient's funds.
//! * Pausing stops `pay` only. `distribute` always works, so fees are never stuck.

mod storage;
#[cfg(test)]
mod test;

use senda_shared::{split_fee, PendingUpgrade, BPS_DENOMINATOR, MAX_FEE_BPS, UPGRADE_DELAY_SECS};
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, symbol_short, token,
    Address, BytesN, Env, Vec,
};
use storage::*;

/// At most this many fee recipients.
pub const MAX_RECIPIENTS: u32 = 5;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    TokenNotAllowed = 2,
    InvalidAmount = 3,
    InvalidFee = 4,
    InvalidShares = 5,
    SameParty = 6,
    NoPendingAdmin = 7,
    NoPendingUpgrade = 8,
    UpgradeNotReady = 9,
    Overflow = 10,
}

/// What the payment is for. It selects the fee rate.
#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum PayKind {
    /// Person-to-person send or a paid chat request: `send_fee_bps`.
    Send = 0,
    /// Tip on a post: `platform_fee_bps`.
    Tip = 1,
    /// Paid post unlock: `platform_fee_bps`.
    Purchase = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Share {
    pub to: Address,
    /// Basis points of each fee. All shares total 10_000.
    pub bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub send_fee_bps: u32,
    pub platform_fee_bps: u32,
    pub paused: bool,
}

#[contract]
pub struct FeeSplitter;

fn now(env: &Env) -> u64 {
    env.ledger().timestamp()
}

fn check_fee(env: &Env, bps: u32) {
    if bps > MAX_FEE_BPS {
        panic_with_error!(env, Error::InvalidFee);
    }
}

fn check_shares(env: &Env, shares: &Vec<Share>) {
    if shares.is_empty() || shares.len() > MAX_RECIPIENTS {
        panic_with_error!(env, Error::InvalidShares);
    }
    let mut total: u32 = 0;
    for (i, s) in shares.iter().enumerate() {
        if s.bps == 0 {
            panic_with_error!(env, Error::InvalidShares);
        }
        total = total.checked_add(s.bps).unwrap_or_else(|| panic_with_error!(env, Error::InvalidShares));
        for (j, other) in shares.iter().enumerate() {
            if j > i && other.to == s.to {
                panic_with_error!(env, Error::InvalidShares);
            }
        }
    }
    if total as i128 != BPS_DENOMINATOR {
        panic_with_error!(env, Error::InvalidShares);
    }
}

/// Sends `fee` of `token` from `source` to the recipients by share. The last
/// recipient gets whatever is left, so the parts always total `fee`.
fn split_out(env: &Env, token: &Address, source: &Address, fee: i128) {
    if fee <= 0 {
        return;
    }
    let shares = get_shares(env);
    let client = token::Client::new(env, token);
    let last = shares.len() - 1;
    let mut left = fee;
    for (i, s) in shares.iter().enumerate() {
        let part = if i as u32 == last {
            left
        } else {
            fee.checked_mul(s.bps as i128)
                .and_then(|v| v.checked_div(BPS_DENOMINATOR))
                .unwrap_or_else(|| panic_with_error!(env, Error::Overflow))
        };
        if part > 0 {
            client.transfer(source, &s.to, &part);
            left -= part;
        }
    }
    add_collected(env, token, fee);
}

#[contractimpl]
impl FeeSplitter {
    pub fn __constructor(
        env: Env,
        admin: Address,
        send_fee_bps: u32,
        platform_fee_bps: u32,
        shares: Vec<Share>,
        allowed_tokens: Vec<Address>,
    ) {
        check_fee(&env, send_fee_bps);
        check_fee(&env, platform_fee_bps);
        check_shares(&env, &shares);
        put_config(&env, &Config { admin, send_fee_bps, platform_fee_bps, paused: false });
        put_shares(&env, &shares);
        for t in allowed_tokens.iter() {
            set_token_allowed(&env, &t, true);
        }
    }

    // ───────────────────────────── payments ─────────────────────────────

    /// Pays `to` and Senda's fee recipients in one step. `amount` is the total
    /// that leaves `from`. Returns the fee that was taken.
    pub fn pay(env: Env, from: Address, to: Address, token: Address, amount: i128, kind: PayKind) -> i128 {
        from.require_auth();
        let cfg = get_config(&env);
        if cfg.paused {
            panic_with_error!(&env, Error::Paused);
        }
        if !is_token_allowed(&env, &token) {
            panic_with_error!(&env, Error::TokenNotAllowed);
        }
        if from == to {
            panic_with_error!(&env, Error::SameParty);
        }
        let bps = match kind {
            PayKind::Send => cfg.send_fee_bps,
            PayKind::Tip | PayKind::Purchase => cfg.platform_fee_bps,
        };
        let (net, fee) = split_fee(amount, bps).unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount));
        if amount <= 0 || net <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        token::Client::new(&env, &token).transfer(&from, &to, &net);
        split_out(&env, &token, &from, fee);
        env.events().publish((symbol_short!("pay"), from, to), (token, amount, fee, kind as u32));
        fee
    }

    /// Splits whatever `token` balance this contract holds (job fees sent here
    /// by the escrow contract) to the fee recipients. Anyone may call it.
    pub fn distribute(env: Env, token: Address) -> i128 {
        if !is_token_allowed(&env, &token) {
            panic_with_error!(&env, Error::TokenNotAllowed);
        }
        get_config(&env); // keeps the contract alive
        let me = env.current_contract_address();
        let balance = token::Client::new(&env, &token).balance(&me);
        if balance <= 0 {
            return 0;
        }
        split_out(&env, &token, &me, balance);
        env.events().publish((symbol_short!("distrib"),), (token, balance));
        balance
    }

    // ─────────────────────────────── views ───────────────────────────────

    /// (recipient receives, fee) for a payment of `amount`.
    pub fn quote(env: Env, amount: i128, kind: PayKind) -> (i128, i128) {
        let cfg = get_config(&env);
        let bps = match kind {
            PayKind::Send => cfg.send_fee_bps,
            PayKind::Tip | PayKind::Purchase => cfg.platform_fee_bps,
        };
        split_fee(amount, bps).unwrap_or_else(|| panic_with_error!(&env, Error::InvalidAmount))
    }

    pub fn get_config(env: Env) -> Config {
        get_config(&env)
    }

    pub fn get_shares(env: Env) -> Vec<Share> {
        get_shares(&env)
    }

    /// Lifetime fees routed through this contract for `token`.
    pub fn total_collected(env: Env, token: Address) -> i128 {
        get_collected(&env, &token)
    }

    pub fn is_token_allowed(env: Env, token: Address) -> bool {
        is_token_allowed(&env, &token)
    }

    pub fn pending_upgrade(env: Env) -> Option<PendingUpgrade> {
        get_pending_upgrade(&env)
    }

    // ──────────────────────────── governance ────────────────────────────
    // None of these can move a user's funds.

    pub fn pause(env: Env) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        cfg.paused = true;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("paused"),), ());
    }

    pub fn unpause(env: Env) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        cfg.paused = false;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("unpaused"),), ());
    }

    /// Each rate is capped at 10%.
    pub fn set_fees(env: Env, send_fee_bps: u32, platform_fee_bps: u32) {
        let mut cfg = get_config(&env);
        cfg.admin.require_auth();
        check_fee(&env, send_fee_bps);
        check_fee(&env, platform_fee_bps);
        cfg.send_fee_bps = send_fee_bps;
        cfg.platform_fee_bps = platform_fee_bps;
        put_config(&env, &cfg);
        env.events().publish((symbol_short!("fees"),), (send_fee_bps, platform_fee_bps));
    }

    /// Changes who receives the fees. Shares must total 100%.
    pub fn set_shares(env: Env, shares: Vec<Share>) {
        get_config(&env).admin.require_auth();
        check_shares(&env, &shares);
        put_shares(&env, &shares);
        env.events().publish((symbol_short!("shares"),), shares);
    }

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

    /// Step 1 of a timelocked upgrade (7 days).
    pub fn propose_upgrade(env: Env, wasm_hash: BytesN<32>) {
        get_config(&env).admin.require_auth();
        let eta = now(&env)
            .checked_add(UPGRADE_DELAY_SECS)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        set_pending_upgrade(&env, &PendingUpgrade { wasm_hash: wasm_hash.clone(), eta });
        env.events().publish((symbol_short!("upg_prop"),), (wasm_hash, eta));
    }

    pub fn cancel_upgrade(env: Env) {
        get_config(&env).admin.require_auth();
        clear_pending_upgrade(&env);
    }

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
