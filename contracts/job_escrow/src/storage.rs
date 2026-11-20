use crate::{Config, Job};
use senda_shared::{
    PendingUpgrade, INSTANCE_BUMP, INSTANCE_THRESHOLD, PERSISTENT_BUMP, PERSISTENT_THRESHOLD,
};
use soroban_sdk::{contracttype, Address, BytesN, Env};

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    PendingAdmin,
    PendingUpgrade,
    TokenAllowed(Address),
    Locked(Address),
    Job(BytesN<32>),
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

pub fn is_token_allowed(env: &Env, token: &Address) -> bool {
    env.storage().instance().get(&DataKey::TokenAllowed(token.clone())).unwrap_or(false)
}

pub fn set_token_allowed(env: &Env, token: &Address, allowed: bool) {
    env.storage().instance().set(&DataKey::TokenAllowed(token.clone()), &allowed);
}

pub fn get_locked(env: &Env, token: &Address) -> i128 {
    env.storage().instance().get(&DataKey::Locked(token.clone())).unwrap_or(0)
}

pub fn add_locked(env: &Env, token: &Address, amount: i128) {
    let v = get_locked(env, token).checked_add(amount).expect("overflow");
    env.storage().instance().set(&DataKey::Locked(token.clone()), &v);
}

pub fn sub_locked(env: &Env, token: &Address, amount: i128) {
    let v = get_locked(env, token).checked_sub(amount).expect("underflow");
    assert!(v >= 0, "negative lock");
    env.storage().instance().set(&DataKey::Locked(token.clone()), &v);
}

pub fn has_job(env: &Env, id: &BytesN<32>) -> bool {
    env.storage().persistent().has(&DataKey::Job(id.clone()))
}

pub fn get_job(env: &Env, id: &BytesN<32>) -> Option<Job> {
    let key = DataKey::Job(id.clone());
    let job: Option<Job> = env.storage().persistent().get(&key);
    if job.is_some() {
        env.storage().persistent().extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
    }
    job
}

pub fn put_job(env: &Env, id: &BytesN<32>, job: &Job) {
    let key = DataKey::Job(id.clone());
    env.storage().persistent().set(&key, job);
    env.storage().persistent().extend_ttl(&key, PERSISTENT_THRESHOLD, PERSISTENT_BUMP);
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
