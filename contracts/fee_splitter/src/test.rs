#![cfg(test)]
extern crate std;

use super::*;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    vec as svec, Address, BytesN, Env,
};

fn ce(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}

struct Ctx {
    env: Env,
    c: FeeSplitterClient<'static>,
    id: Address,
    token: Address,
    other_token: Address,
    admin: Address,
    treasury: Address,
    community: Address,
    payer: Address,
    creator: Address,
}

const START: u64 = 1_800_000_000;
const FUNDS: i128 = 1_000_000_000_000;

fn setup_with(send_bps: u32, platform_bps: u32) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    env.ledger().set_timestamp(START);
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let community = Address::generate(&env);
    let payer = Address::generate(&env);
    let creator = Address::generate(&env);
    let issuer = Address::generate(&env);
    let token = env.register_stellar_asset_contract_v2(issuer.clone()).address();
    let other_token = env.register_stellar_asset_contract_v2(issuer).address();
    StellarAssetClient::new(&env, &token).mint(&payer, &FUNDS);
    StellarAssetClient::new(&env, &other_token).mint(&payer, &FUNDS);
    let id = env.register(
        FeeSplitter,
        (
            admin.clone(),
            send_bps,
            platform_bps,
            svec![&env, Share { to: treasury.clone(), bps: 8_000 }, Share { to: community.clone(), bps: 2_000 }],
            svec![&env, token.clone()],
        ),
    );
    let c = FeeSplitterClient::new(&env, &id);
    let c: FeeSplitterClient<'static> = unsafe { core::mem::transmute(c) };
    Ctx { env, c, id, token, other_token, admin, treasury, community, payer, creator }
}

fn setup() -> Ctx {
    setup_with(50, 250)
}

fn bal(x: &Ctx, who: &Address) -> i128 {
    TokenClient::new(&x.env, &x.token).balance(who)
}

#[test]
fn tip_pays_creator_and_splits_fee_80_20() {
    let x = setup();
    // 10.0000000 at 2.5% = 0.25 fee: 0.20 treasury, 0.05 community.
    let fee = x.c.pay(&x.payer, &x.creator, &x.token, &100_000_000, &PayKind::Tip);
    assert_eq!(fee, 2_500_000);
    assert_eq!(bal(&x, &x.creator), 97_500_000);
    assert_eq!(bal(&x, &x.treasury), 2_000_000);
    assert_eq!(bal(&x, &x.community), 500_000);
    assert_eq!(bal(&x, &x.payer), FUNDS - 100_000_000);
    assert_eq!(bal(&x, &x.id), 0, "contract never holds a pay");
    assert_eq!(x.c.total_collected(&x.token), 2_500_000);
}

#[test]
fn send_uses_the_send_rate_and_purchase_the_platform_rate() {
    let x = setup();
    assert_eq!(x.c.pay(&x.payer, &x.creator, &x.token, &200_000_000, &PayKind::Send), 1_000_000); // 0.5%
    assert_eq!(x.c.pay(&x.payer, &x.creator, &x.token, &200_000_000, &PayKind::Purchase), 5_000_000); // 2.5%
    assert_eq!(x.c.quote(&200_000_000, &PayKind::Send), (199_000_000, 1_000_000));
    assert_eq!(bal(&x, &x.creator), 199_000_000 + 195_000_000);
}

#[test]
fn zero_fee_rate_pays_everything_to_the_recipient() {
    let x = setup_with(0, 0);
    assert_eq!(x.c.pay(&x.payer, &x.creator, &x.token, &123, &PayKind::Send), 0);
    assert_eq!(bal(&x, &x.creator), 123);
    assert_eq!(bal(&x, &x.treasury), 0);
}

#[test]
fn rounding_dust_goes_to_the_last_recipient_and_nothing_is_lost() {
    let x = setup();
    // fee = floor(399 * 250 / 10000) = 9; treasury floor(9*0.8)=7, community 2.
    let fee = x.c.pay(&x.payer, &x.creator, &x.token, &399, &PayKind::Tip);
    assert_eq!(fee, 9);
    assert_eq!(bal(&x, &x.treasury), 7);
    assert_eq!(bal(&x, &x.community), 2);
    assert_eq!(bal(&x, &x.creator), 390);
}

#[test]
fn rejects_bad_input() {
    let x = setup();
    assert_eq!(x.c.try_pay(&x.payer, &x.creator, &x.token, &0, &PayKind::Tip), Err(Ok(ce(Error::InvalidAmount))));
    assert_eq!(x.c.try_pay(&x.payer, &x.creator, &x.token, &-5, &PayKind::Tip), Err(Ok(ce(Error::InvalidAmount))));
    assert_eq!(x.c.try_pay(&x.payer, &x.payer, &x.token, &100, &PayKind::Send), Err(Ok(ce(Error::SameParty))));
    assert_eq!(x.c.try_pay(&x.payer, &x.creator, &x.other_token, &100, &PayKind::Send), Err(Ok(ce(Error::TokenNotAllowed))));
    assert_eq!(x.c.try_distribute(&x.other_token), Err(Ok(ce(Error::TokenNotAllowed))));
    // More than the payer has: the token itself refuses, nothing moves.
    assert!(x.c.try_pay(&x.payer, &x.creator, &x.token, &(FUNDS + 1), &PayKind::Send).is_err());
    assert_eq!(bal(&x, &x.creator), 0);
}

#[test]
fn pay_needs_the_payers_signature() {
    let x = setup();
    x.env.set_auths(&[]);
    assert!(x.c.try_pay(&x.payer, &x.creator, &x.token, &100, &PayKind::Send).is_err());
    assert_eq!(bal(&x, &x.creator), 0);
}

#[test]
fn distribute_splits_the_contract_balance_and_anyone_can_call_it() {
    let x = setup();
    // The escrow contract sends job fees here as a plain transfer.
    TokenClient::new(&x.env, &x.token).transfer(&x.payer, &x.id, &37_500_001);
    x.env.set_auths(&[]); // no signatures at all
    assert_eq!(x.c.distribute(&x.token), 37_500_001);
    assert_eq!(bal(&x, &x.treasury), 30_000_000);
    assert_eq!(bal(&x, &x.community), 7_500_001);
    assert_eq!(bal(&x, &x.id), 0);
    assert_eq!(x.c.distribute(&x.token), 0, "nothing left");
    assert_eq!(x.c.total_collected(&x.token), 37_500_001);
}

#[test]
fn pause_stops_pay_but_not_distribute() {
    let x = setup();
    x.c.pause();
    assert_eq!(x.c.try_pay(&x.payer, &x.creator, &x.token, &100, &PayKind::Send), Err(Ok(ce(Error::Paused))));
    TokenClient::new(&x.env, &x.token).transfer(&x.payer, &x.id, &1_000);
    assert_eq!(x.c.distribute(&x.token), 1_000);
    x.c.unpause();
    assert_eq!(x.c.pay(&x.payer, &x.creator, &x.token, &10_000, &PayKind::Send), 50);
}

#[test]
fn fees_are_capped_and_shares_must_total_100_percent() {
    let x = setup();
    assert_eq!(x.c.try_set_fees(&1_001, &250), Err(Ok(ce(Error::InvalidFee))));
    assert_eq!(x.c.try_set_fees(&50, &1_001), Err(Ok(ce(Error::InvalidFee))));
    x.c.set_fees(&100, &1_000);
    assert_eq!(x.c.get_config().platform_fee_bps, 1_000);

    let a = Address::generate(&x.env);
    let bad_total = svec![&x.env, Share { to: a.clone(), bps: 9_999 }];
    assert_eq!(x.c.try_set_shares(&bad_total), Err(Ok(ce(Error::InvalidShares))));
    let dup = svec![&x.env, Share { to: a.clone(), bps: 5_000 }, Share { to: a.clone(), bps: 5_000 }];
    assert_eq!(x.c.try_set_shares(&dup), Err(Ok(ce(Error::InvalidShares))));
    let zero = svec![&x.env, Share { to: a.clone(), bps: 10_000 }, Share { to: x.treasury.clone(), bps: 0 }];
    assert_eq!(x.c.try_set_shares(&zero), Err(Ok(ce(Error::InvalidShares))));
    assert_eq!(x.c.try_set_shares(&svec![&x.env]), Err(Ok(ce(Error::InvalidShares))));

    x.c.set_shares(&svec![&x.env, Share { to: a.clone(), bps: 10_000 }]);
    x.c.pay(&x.payer, &x.creator, &x.token, &1_000, &PayKind::Tip);
    assert_eq!(bal(&x, &a), 100);
    assert_eq!(bal(&x, &x.treasury), 0);
}

#[test]
fn only_admin_governs() {
    let x = setup();
    x.env.set_auths(&[]);
    assert!(x.c.try_pause().is_err());
    assert!(x.c.try_set_fees(&0, &0).is_err());
    assert!(x.c.try_set_shares(&svec![&x.env, Share { to: x.payer.clone(), bps: 10_000 }]).is_err());
    assert!(x.c.try_set_token_allowed(&x.other_token, &true).is_err());
    assert!(x.c.try_propose_admin(&x.payer).is_err());
    assert!(x.c.try_propose_upgrade(&BytesN::from_array(&x.env, &[1; 32])).is_err());
    assert_eq!(x.c.get_config().admin, x.admin);
}

#[test]
fn admin_handover_is_two_step_and_upgrade_is_timelocked() {
    let x = setup();
    let next = Address::generate(&x.env);
    assert_eq!(x.c.try_accept_admin(), Err(Ok(ce(Error::NoPendingAdmin))));
    x.c.propose_admin(&next);
    assert_eq!(x.c.get_config().admin, x.admin);
    x.c.accept_admin();
    assert_eq!(x.c.get_config().admin, next);

    assert_eq!(x.c.try_execute_upgrade(), Err(Ok(ce(Error::NoPendingUpgrade))));
    x.c.propose_upgrade(&BytesN::from_array(&x.env, &[7; 32]));
    assert_eq!(x.c.try_execute_upgrade(), Err(Ok(ce(Error::UpgradeNotReady))));
    x.env.ledger().set_timestamp(START + UPGRADE_DELAY_SECS - 1);
    assert_eq!(x.c.try_execute_upgrade(), Err(Ok(ce(Error::UpgradeNotReady))));
    x.c.cancel_upgrade();
    assert_eq!(x.c.pending_upgrade(), None);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Whatever the amount, rates and share split: the payer loses exactly
    /// `amount`, everyone else gains exactly that in total, and the contract
    /// keeps nothing.
    #[test]
    fn prop_pay_conserves_value(
        amount in 1i128..=500_000_000_000,
        send_bps in 0u32..=1_000,
        platform_bps in 0u32..=1_000,
        first in 1u32..=9_999,
        kind in 0u32..=2,
    ) {
        let x = setup_with(send_bps, platform_bps);
        x.c.set_shares(&svec![&x.env, Share { to: x.treasury.clone(), bps: first }, Share { to: x.community.clone(), bps: 10_000 - first }]);
        let k = match kind { 0 => PayKind::Send, 1 => PayKind::Tip, _ => PayKind::Purchase };
        let fee = x.c.pay(&x.payer, &x.creator, &x.token, &amount, &k);
        let bps = if kind == 0 { send_bps } else { platform_bps } as i128;
        prop_assert_eq!(fee, amount * bps / 10_000);
        prop_assert_eq!(bal(&x, &x.payer), FUNDS - amount);
        prop_assert_eq!(bal(&x, &x.creator), amount - fee);
        prop_assert_eq!(bal(&x, &x.treasury) + bal(&x, &x.community), fee);
        prop_assert_eq!(bal(&x, &x.id), 0);
        prop_assert!(fee * 10 <= amount, "fee never above 10%");
    }

    /// distribute hands out the whole balance, never more.
    #[test]
    fn prop_distribute_empties_the_contract(amount in 1i128..=500_000_000_000, first in 1u32..=9_999) {
        let x = setup();
        x.c.set_shares(&svec![&x.env, Share { to: x.treasury.clone(), bps: first }, Share { to: x.community.clone(), bps: 10_000 - first }]);
        TokenClient::new(&x.env, &x.token).transfer(&x.payer, &x.id, &amount);
        prop_assert_eq!(x.c.distribute(&x.token), amount);
        prop_assert_eq!(bal(&x, &x.treasury) + bal(&x, &x.community), amount);
        prop_assert_eq!(bal(&x, &x.id), 0);
    }
}
