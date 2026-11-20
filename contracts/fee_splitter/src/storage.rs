use crate::{Config, Share};
use senda_shared::{PendingUpgrade, INSTANCE_BUMP, INSTANCE_THRESHOLD};
use soroban_sdk::{contracttype, Address, Env, Vec};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Shares,
    PendingAdmin,
    PendingUpgrade,
    TokenAllowed(Address),
    Collected(Address),
}

fn bump_instance(env: &Env) {
    env.storage().instance().extend_ttl(INSTANCE_THRESHOLD, INSTANCE_BUMP);
}

pub fn get_config(env: &Env) -> Config {
    bump_instance(env);
    env.storage().instance().get(&DataKey::Config).expect("not initialized")
}

pub fn put_config(env: &Env, cfg: &Config) {
    env.storage().instance().set(&DataKey::Config, cfg);
    bump_instance(env);
}

pub fn get_shares(env: &Env) -> Vec<Share> {
    env.storage().instance().get(&DataKey::Shares).expect("not initialized")
}

pub fn put_shares(env: &Env, shares: &Vec<Share>) {
    env.storage().instance().set(&DataKey::Shares, shares);
}

pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage().instance().get(&DataKey::TokenAllowed(token.clone())).unwrap_or(false)
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    env.storage().instance().set(&DataKey::TokenAllowed(token.clone()), &allowed);
}

pub fn get_collected(env: &Env, token: &Address) -> i128 {
    env.storage().instance().get(&DataKey::Collected(token.clone())).unwrap_or(0)
}

pub fn add_collected(env: &Env, token: &Address, amount: i128) {
    let v = get_collected(env, token).checked_add(amount).expect("overflow");
    env.storage().instance().set(&DataKey::Collected(token.clone()), &v);
}

pub fn get_pending_admin(env: &Env) -> Option<Address> {
    env.storage().instance().get(&DataKey::PendingAdmin)
}
pub fn set_pending_admin(env: &Env, a: &Address) {
    env.storage().instance().set(&DataKey::PendingAdmin, a);
}
pub fn clear_pending_admin(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingAdmin);
}

pub fn get_pending_upgrade(env: &Env) -> Option<PendingUpgrade> {
    env.storage().instance().get(&DataKey::PendingUpgrade)
}
pub fn set_pending_upgrade(env: &Env, p: &PendingUpgrade) {
    env.storage().instance().set(&DataKey::PendingUpgrade, p);
}
pub fn clear_pending_upgrade(env: &Env) {
    env.storage().instance().remove(&DataKey::PendingUpgrade);
}
