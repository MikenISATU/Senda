#![cfg(test)]
extern crate std;

use super::*;

fn ce(e: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(e as u32)
}
use proptest::prelude::*;
use soroban_sdk::{
    contract, contractimpl,
    testutils::Address as _,
    token::{StellarAssetClient, TokenClient},
    Address, Env, Map,
};

/// Minimal Blend-like pool: tracks b_tokens per address for one reserve and a
/// settable b_rate. Interest is simulated by the test minting extra tokens to
/// the pool and raising b_rate accordingly (the way real supply interest works).
#[contract]
pub struct MockPool;

#[contracttype]
#[derive(Clone)]
enum PK {
    Asset,
    BRate,
    B(Address),
}

#[contractimpl]
impl MockPool {
    pub fn init(env: Env, asset: Address) {
        env.storage().instance().set(&PK::Asset, &asset);
        env.storage().instance().set(&PK::BRate, &SCALAR_12);
    }
    pub fn set_b_rate(env: Env, r: i128) {
        env.storage().instance().set(&PK::BRate, &r);
    }
    pub fn submit(env: Env, from: Address, spender: Address, to: Address, requests: Vec<Request>) -> Positions {
        spender.require_auth();
        let asset: Address = env.storage().instance().get(&PK::Asset).unwrap();
        let rate: i128 = env.storage().instance().get(&PK::BRate).unwrap();
        let t = token::Client::new(&env, &asset);
        for r in requests.iter() {
            let cur: i128 = env.storage().instance().get(&PK::B(from.clone())).unwrap_or(0);
            if r.request_type == REQUEST_SUPPLY {
                t.transfer(&spender, &env.current_contract_address(), &r.amount);
                let b = r.amount * SCALAR_12 / rate;
                env.storage().instance().set(&PK::B(from.clone()), &(cur + b));
            } else if r.request_type == REQUEST_WITHDRAW {
                let b = (r.amount * SCALAR_12 + rate - 1) / rate; // ceil, like Blend
                assert!(b <= cur, "insufficient b_tokens");
                env.storage().instance().set(&PK::B(from.clone()), &(cur - b));
                t.transfer(&env.current_contract_address(), &to, &r.amount);
            }
        }
        Self::get_positions(env, from)
    }
    pub fn get_positions(env: Env, address: Address) -> Positions {
        let b: i128 = env.storage().instance().get(&PK::B(address)).unwrap_or(0);
        let mut supply = Map::new(&env);
        if b > 0 {
            supply.set(0u32, b);
        }
        Positions { liabilities: Map::new(&env), collateral: Map::new(&env), supply }
    }
    pub fn get_reserve(env: Env, asset: Address) -> Reserve {
        let rate: i128 = env.storage().instance().get(&PK::BRate).unwrap();
        Reserve {
            asset,
            config: ReserveConfig {
                index: 0, decimals: 7, c_factor: 0, l_factor: 0, util: 0, max_util: 0,
                r_base: 0, r_one: 0, r_two: 0, r_three: 0, reactivity: 0, supply_cap: i128::MAX, enabled: true,
            },
            data: ReserveData { d_rate: SCALAR_12, b_rate: rate, ir_mod: 0, b_supply: 0, d_supply: 0, backstop_credit: 0, last_time: 0 },
            scalar: 10_000_000,
        }
    }
}

struct Ctx {
    env: Env,
    vault: UsdcEarnVaultClient<'static>,
    pool: MockPoolClient<'static>,
    asset: Address,
    guardian: Address,
}

fn setup(cap: i128) -> Ctx {
    let env = Env::default();
    env.mock_all_auths_allowing_non_root_auth();
    let admin = Address::generate(&env);
    let guardian = Address::generate(&env);
    let asset = env.register_stellar_asset_contract_v2(Address::generate(&env)).address();
    let pool_id = env.register(MockPool, ());
    let pool = MockPoolClient::new(&env, &pool_id);
    pool.init(&asset);
    let vid = env.register(UsdcEarnVault, (admin, guardian.clone(), asset.clone(), pool_id, cap));
    let vault = UsdcEarnVaultClient::new(&env, &vid);
    let vault: UsdcEarnVaultClient<'static> = unsafe { core::mem::transmute(vault) };
    let pool: MockPoolClient<'static> = unsafe { core::mem::transmute(pool) };
    Ctx { env, vault, pool, asset, guardian }
}

fn user(c: &Ctx, amount: i128) -> Address {
    let u = Address::generate(&c.env);
    StellarAssetClient::new(&c.env, &c.asset).mint(&u, &amount);
    u
}

fn bal(c: &Ctx, who: &Address) -> i128 {
    TokenClient::new(&c.env, &c.asset).balance(who)
}

/// Simulate real interest: the pool receives tokens and b_rate rises.
fn accrue(c: &Ctx, bps: i128) {
    let res = c.pool.get_reserve(&c.asset);
    let pos = c.pool.get_positions(&c.vault.address);
    let b = pos.supply.get(0).unwrap_or(0);
    let new_rate = res.data.b_rate * (10_000 + bps) / 10_000;
    let extra = b * new_rate / SCALAR_12 - b * res.data.b_rate / SCALAR_12;
    StellarAssetClient::new(&c.env, &c.asset).mint(&c.pool.address, &(extra + 1));
    c.pool.set_b_rate(&new_rate);
}

#[test]
fn deposit_and_withdraw_round_trip_without_yield() {
    let c = setup(1_000_000_0000000);
    let u = user(&c, 1_000_0000000);
    c.vault.deposit(&u, &1_000_0000000);
    assert_eq!(bal(&c, &u), 0);
    let shares = c.vault.shares(&u);
    let out = c.vault.withdraw(&u, &shares);
    assert!(out <= 1_000_0000000 && out >= 1_000_0000000 - 2);
}

#[test]
fn yield_only_comes_from_strategy() {
    let c = setup(1_000_000_0000000);
    let a = user(&c, 1_000_0000000);
    c.vault.deposit(&a, &1_000_0000000);
    // No accrual => no yield, regardless of new deposits.
    let b = user(&c, 5_000_0000000);
    c.vault.deposit(&b, &5_000_0000000);
    assert!(c.vault.value_of(&a) <= 1_000_0000000);
    // 5% strategy accrual => ~5% value increase for both.
    accrue(&c, 500);
    let va = c.vault.value_of(&a);
    assert!(va >= 1_049_0000000 && va <= 1_050_0000000, "va={va}");
}

#[test]
fn losses_are_shared_pro_rata() {
    let c = setup(1_000_000_0000000);
    let a = user(&c, 1_000_0000000);
    c.vault.deposit(&a, &1_000_0000000);
    c.pool.set_b_rate(&(SCALAR_12 * 9 / 10)); // 10% loss in pool
    assert!(c.vault.value_of(&a) <= 900_0000000);
}

#[test]
fn cap_and_pause() {
    let c = setup(100);
    let u = user(&c, 1_000);
    assert_eq!(c.vault.try_deposit(&u, &101), Err(Ok(ce(Error::CapExceeded))));
    c.vault.deposit(&u, &100);
    c.vault.pause(&c.guardian);
    assert_eq!(c.vault.try_deposit(&u, &1), Err(Ok(ce(Error::Paused))));
    // Withdraw still works while paused.
    let s = c.vault.shares(&u);
    c.vault.withdraw(&u, &s);
}

#[test]
fn cannot_withdraw_more_shares_than_owned() {
    let c = setup(1_000_000);
    let a = user(&c, 1_000);
    let b = user(&c, 1_000);
    c.vault.deposit(&a, &1_000);
    c.vault.deposit(&b, &1_000);
    let s = c.vault.shares(&a);
    assert_eq!(c.vault.try_withdraw(&a, &(s + 1)), Err(Ok(ce(Error::InsufficientShares))));
}

#[test]
fn inflation_attack_is_unprofitable() {
    let c = setup(i128::MAX / 4);
    let attacker = user(&c, 10_001);
    c.vault.deposit(&attacker, &1);
    // Attacker donates directly to the pool via accrual (raises share price).
    accrue(&c, 10_000 * 1_000);
    let victim = user(&c, 1_000);
    let r = c.vault.try_deposit(&victim, &1_000);
    // Either the victim gets fair shares or the deposit is refused (ZeroShares), never silently robbed.
    if r.is_ok() {
        let v = c.vault.value_of(&victim);
        assert!(v >= 990, "victim value {v}");
    }
}

proptest! {
    #![proptest_config(ProptestConfig { cases: 32, .. ProptestConfig::default() })]

    /// With no strategy accrual, nobody can withdraw more than they deposited,
    /// and the vault never pays out more than it holds.
    #[test]
    fn no_free_money(deps in proptest::collection::vec(1i128..1_000_000_000, 1..6)) {
        let c = setup(i128::MAX / 4);
        let users: std::vec::Vec<(Address, i128)> = deps.iter().map(|d| (user(&c, *d), *d)).collect();
        for (u, d) in users.iter() { c.vault.deposit(u, d); }
        for (u, d) in users.iter() {
            let s = c.vault.shares(u);
            let out = c.vault.withdraw(u, &s);
            prop_assert!(out <= *d);
            prop_assert_eq!(bal(&c, u), out);
        }
        prop_assert_eq!(c.vault.total_shares(), 0);
    }
}
