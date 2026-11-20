#![no_std]
//! Shared helpers for Senda Soroban contracts.
//!
//! * checked basis-point math (no silent overflow, no negative amounts)
//! * storage TTL constants
//! * timelocked upgrade governance record

use soroban_sdk::{contracttype, BytesN};

/// ~5s ledgers. 1 day = 17_280 ledgers.
pub const DAY_IN_LEDGERS: u32 = 17_280;
// TTL policy: extend in small steps that every interaction tops up, so rent is
// paid gradually by whoever uses the contract. If an entry does expire it is
// archived, not deleted, and can be restored (RestoreFootprint / automatic
// restoration on simulation), so funds are never lost to expiry.
// (Testnet rent was ~204 XLM for an 18 KB code upload on 2026-10-24, so long
// up-front extensions made deployment exceed the per-transaction fee limit.)
/// Instance storage (also keeps the contract code alive): bump to 7 days when below 6.
pub const INSTANCE_BUMP: u32 = 7 * DAY_IN_LEDGERS;
pub const INSTANCE_THRESHOLD: u32 = 6 * DAY_IN_LEDGERS;
/// Persistent records (jobs, positions): bump to 14 days when below 7.
pub const PERSISTENT_BUMP: u32 = 14 * DAY_IN_LEDGERS;
pub const PERSISTENT_THRESHOLD: u32 = 7 * DAY_IN_LEDGERS;

/// Max platform fee: 10%.
pub const MAX_FEE_BPS: u32 = 1_000;
pub const BPS_DENOMINATOR: i128 = 10_000;

/// Minimum delay between proposing and executing a contract upgrade (seconds).
pub const UPGRADE_DELAY_SECS: u64 = 7 * 24 * 60 * 60;

/// A proposed wasm upgrade. Executable only after `eta`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingUpgrade {
    pub wasm_hash: BytesN<32>,
    pub eta: u64,
}

/// fee = floor(amount * bps / 10_000). Returns None on overflow or invalid input.
pub fn bps_of(amount: i128, bps: u32) -> Option<i128> {
    if amount < 0 || bps as i128 > BPS_DENOMINATOR {
        return None;
    }
    amount.checked_mul(bps as i128)?.checked_div(BPS_DENOMINATOR)
}

/// Splits `amount` into (net, fee). net + fee == amount always holds.
pub fn split_fee(amount: i128, bps: u32) -> Option<(i128, i128)> {
    let fee = bps_of(amount, bps)?;
    let net = amount.checked_sub(fee)?;
    if net < 0 {
        return None;
    }
    Some((net, fee))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn split_conserves_amount() {
        for amount in [0i128, 1, 9, 10_000, 123_456_789, i128::MAX / 10_000] {
            for bps in [0u32, 1, 250, 1_000, 10_000] {
                let (net, fee) = split_fee(amount, bps).unwrap();
                assert_eq!(net + fee, amount);
                assert!(net >= 0 && fee >= 0);
            }
        }
    }

    #[test]
    fn rejects_negative_and_overflow() {
        assert!(split_fee(-1, 100).is_none());
        assert!(split_fee(i128::MAX, 100).is_none());
        assert!(split_fee(100, 10_001).is_none());
    }
}
