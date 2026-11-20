#![no_std]
#![allow(deprecated)]
//! # Senda USDC Earn vault (EXPERIMENTAL, UNAUDITED, OFF BY DEFAULT)
//!
//! A pooled share vault that supplies one asset into an external, audited
//! Blend v2 lending pool (`strategy`). Yield is whatever the Blend reserve
//! actually pays through its b_rate. **Nothing in this contract generates
//! yield or pays one user's deposit to another as "interest".**
//!
//! * shares: `deposit` mints `amount * (S + V) / (A + 1)` (virtual offset V
//!   blocks first-depositor inflation attacks); `withdraw` burns shares and
//!   redeems `shares * (A + 1) / (S + V)` rounded down.
//! * total assets `A` = vault bTokens * b_rate / 1e12 read from the pool.
//! * losses (bad debt in the pool) reduce A and therefore every share's value.
//! * guardian pause blocks deposits only; withdrawals are always open,
//!   subject to pool liquidity (if utilization is 100%, withdraw reverts).
//! * a per-vault deposit cap limits exposure while unaudited.
//!
//! The Senda app's default Earn path does NOT use this vault: users supply to
//! the Blend pool directly from their own wallet. This contract exists for a
//! future pooled product and must pass an independent audit before mainnet use.

#[cfg(test)]
mod test;

use senda_shared::{INSTANCE_BUMP, INSTANCE_THRESHOLD, PERSISTENT_BUMP, PERSISTENT_THRESHOLD};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractimpl, contracttype, panic_with_error,
    symbol_short, token, vec, Address, Env, IntoVal, Map, Symbol, Vec,
};

pub const SCALAR_12: i128 = 1_000_000_000_000;
pub const VIRTUAL_SHARES: i128 = 1_000;
pub const REQUEST_SUPPLY: u32 = 0;
pub const REQUEST_WITHDRAW: u32 = 1;

// ─────────── Blend v2 pool interface (types mirror blend-contracts-v2) ───────────

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Request {
    pub request_type: u32,
    pub address: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Positions {
    pub liabilities: Map<u32, i128>,
    pub collateral: Map<u32, i128>,
    pub supply: Map<u32, i128>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveConfig {
    pub index: u32,
    pub decimals: u32,
    pub c_factor: u32,
    pub l_factor: u32,
    pub util: u32,
    pub max_util: u32,
    pub r_base: u32,
    pub r_one: u32,
    pub r_two: u32,
    pub r_three: u32,
    pub reactivity: u32,
    pub supply_cap: i128,
    pub enabled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveData {
    pub d_rate: i128,
    pub b_rate: i128,
    pub ir_mod: i128,
    pub b_supply: i128,
    pub d_supply: i128,
    pub backstop_credit: i128,
    pub last_time: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Reserve {
    pub asset: Address,
    pub config: ReserveConfig,
    pub data: ReserveData,
    pub scalar: i128,
}

#[contractclient(name = "BlendPoolClient")]
pub trait BlendPool {
    fn submit(env: Env, from: Address, spender: Address, to: Address, requests: Vec<Request>) -> Positions;
    fn get_positions(env: Env, address: Address) -> Positions;
    fn get_reserve(env: Env, asset: Address) -> Reserve;
}

// ─────────────────────────────── vault ───────────────────────────────

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    Paused = 1,
    InvalidAmount = 2,
    InsufficientShares = 3,
    CapExceeded = 4,
    Unauthorized = 5,
    Overflow = 6,
    ZeroShares = 7,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultConfig {
    pub admin: Address,
    pub guardian: Address,
    pub asset: Address,
    pub strategy: Address,
    pub deposit_cap: i128,
    pub paused: bool,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    TotalShares,
    Shares(Address),
    NetDeposits(Address),
}

#[contract]
pub struct UsdcEarnVault;

fn cfg(env: &Env) -> VaultConfig {
    env.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
    env.storage().instance().get(&Key::Config).expect("not initialized")
}

fn put_cfg(env: &Env, c: &VaultConfig) {
    env.storage().instance().set(&Key::Config, c);
}

fn total_shares(env: &Env) -> i128 {
    env.storage().instance().get(&Key::TotalShares).unwrap_or(0)
}

fn shares_of(env: &Env, who: &Address) -> i128 {
    let k = Key::Shares(who.clone());
    let v: Option<i128> = env.storage().persistent().get(&k);
    if v.is_some() {
        env.storage().persistent().extend_ttl(&k, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    v.unwrap_or(0)
}

fn set_shares(env: &Env, who: &Address, v: i128) {
    let k = Key::Shares(who.clone());
    env.storage().persistent().set(&k, &v);
    env.storage().persistent().extend_ttl(&k, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

fn net_deposits(env: &Env, who: &Address) -> i128 {
    env.storage().persistent().get(&Key::NetDeposits(who.clone())).unwrap_or(0)
}

fn set_net_deposits(env: &Env, who: &Address, v: i128) {
    let k = Key::NetDeposits(who.clone());
    env.storage().persistent().set(&k, &v);
    env.storage().persistent().extend_ttl(&k, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
}

/// Underlying value held by the vault inside the strategy (rounded down).
fn total_assets(env: &Env, c: &VaultConfig) -> i128 {
    let pool = BlendPoolClient::new(env, &c.strategy);
    let reserve = pool.get_reserve(&c.asset);
    let pos = pool.get_positions(&env.current_contract_address());
    let b_tokens = pos.supply.get(reserve.config.index).unwrap_or(0);
    b_tokens
        .checked_mul(reserve.data.b_rate)
        .and_then(|x| x.checked_div(SCALAR_12))
        .unwrap_or_else(|| panic_with_error!(env, Error::Overflow))
}

fn mul_div_floor(env: &Env, a: i128, b: i128, d: i128) -> i128 {
    a.checked_mul(b)
        .and_then(|x| x.checked_div(d))
        .unwrap_or_else(|| panic_with_error!(env, Error::Overflow))
}

#[contractimpl]
impl UsdcEarnVault {
    pub fn __constructor(
        env: Env,
        admin: Address,
        guardian: Address,
        asset: Address,
        strategy: Address,
        deposit_cap: i128,
    ) {
        if deposit_cap <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        put_cfg(&env, &VaultConfig { admin, guardian, asset, strategy, deposit_cap, paused: false });
        env.storage().instance().set(&Key::TotalShares, &0i128);
    }

    /// Deposit `amount` of the asset; returns minted shares.
    pub fn deposit(env: Env, user: Address, amount: i128) -> i128 {
        user.require_auth();
        let c = cfg(&env);
        if c.paused {
            panic_with_error!(&env, Error::Paused);
        }
        if amount <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let assets_before = total_assets(&env, &c);
        let after = assets_before
            .checked_add(amount)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        if after > c.deposit_cap {
            panic_with_error!(&env, Error::CapExceeded);
        }
        // Interactions first, then measure what the strategy actually credited.
        // Minting from the measured delta (not the nominal amount) protects
        // depositors from strategy-side rounding and donation games.
        let this = env.current_contract_address();
        token::Client::new(&env, &c.asset).transfer(&user, &this, &amount);
        // The pool will call asset.transfer(vault -> pool, amount); pre-authorize exactly that.
        env.authorize_as_current_contract(vec![
            &env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: c.asset.clone(),
                    fn_name: Symbol::new(&env, "transfer"),
                    args: (this.clone(), c.strategy.clone(), amount).into_val(&env),
                },
                sub_invocations: vec![&env],
            }),
        ]);
        BlendPoolClient::new(&env, &c.strategy).submit(
            &this,
            &this,
            &this,
            &vec![&env, Request { request_type: REQUEST_SUPPLY, address: c.asset.clone(), amount }],
        );
        let assets_after_supply = total_assets(&env, &c);
        let credited = assets_after_supply
            .checked_sub(assets_before)
            .unwrap_or_else(|| panic_with_error!(&env, Error::Overflow));
        let s = total_shares(&env);
        let minted = if credited <= 0 { 0 } else { mul_div_floor(&env, credited, s + VIRTUAL_SHARES, assets_before + 1) };
        if minted <= 0 {
            // Reverts the whole transaction, including the transfer.
            panic_with_error!(&env, Error::ZeroShares);
        }
        env.storage().instance().set(&Key::TotalShares, &(s + minted));
        set_shares(&env, &user, shares_of(&env, &user) + minted);
        set_net_deposits(&env, &user, net_deposits(&env, &user) + amount);
        env.events().publish((symbol_short!("deposit"), user), (amount, minted));
        minted
    }

    /// Burn `shares`; the redeemed asset goes straight from the pool to `user`.
    /// Never blocked by pause. Reverts if pool liquidity is insufficient.
    pub fn withdraw(env: Env, user: Address, shares: i128) -> i128 {
        user.require_auth();
        let c = cfg(&env);
        if shares <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        let owned = shares_of(&env, &user);
        if shares > owned {
            panic_with_error!(&env, Error::InsufficientShares);
        }
        let s = total_shares(&env);
        let assets = total_assets(&env, &c);
        let out = mul_div_floor(&env, shares, assets + 1, s + VIRTUAL_SHARES);
        if out <= 0 {
            panic_with_error!(&env, Error::ZeroShares);
        }

        env.storage().instance().set(&Key::TotalShares, &(s - shares));
        set_shares(&env, &user, owned - shares);
        let nd = net_deposits(&env, &user);
        set_net_deposits(&env, &user, if out >= nd { 0 } else { nd - out });

        let this = env.current_contract_address();
        BlendPoolClient::new(&env, &c.strategy).submit(
            &this,
            &this,
            &user,
            &vec![&env, Request { request_type: REQUEST_WITHDRAW, address: c.asset.clone(), amount: out }],
        );
        env.events().publish((symbol_short!("withdraw"), user), (shares, out));
        out
    }

    // ─────────── reads ───────────
    pub fn config(env: Env) -> VaultConfig {
        cfg(&env)
    }
    pub fn total_shares(env: Env) -> i128 {
        total_shares(&env)
    }
    pub fn total_assets(env: Env) -> i128 {
        total_assets(&env, &cfg(&env))
    }
    pub fn shares(env: Env, user: Address) -> i128 {
        shares_of(&env, &user)
    }
    /// Current redeemable value of a user's shares (before pool liquidity limits).
    pub fn value_of(env: Env, user: Address) -> i128 {
        let c = cfg(&env);
        mul_div_floor(&env, shares_of(&env, &user), total_assets(&env, &c) + 1, total_shares(&env) + VIRTUAL_SHARES)
    }
    /// Deposits minus withdrawals at cost; value_of - net_deposits = realized+unrealized yield.
    pub fn net_deposits(env: Env, user: Address) -> i128 {
        net_deposits(&env, &user)
    }

    // ─────────── guardian / admin (cannot move user funds) ───────────
    pub fn pause(env: Env, by: Address) {
        let mut c = cfg(&env);
        if by != c.guardian && by != c.admin {
            panic_with_error!(&env, Error::Unauthorized);
        }
        by.require_auth();
        c.paused = true;
        put_cfg(&env, &c);
    }
    pub fn unpause(env: Env) {
        let mut c = cfg(&env);
        c.admin.require_auth();
        c.paused = false;
        put_cfg(&env, &c);
    }
    pub fn set_deposit_cap(env: Env, cap: i128) {
        let mut c = cfg(&env);
        c.admin.require_auth();
        if cap <= 0 {
            panic_with_error!(&env, Error::InvalidAmount);
        }
        c.deposit_cap = cap;
        put_cfg(&env, &c);
    }
}
