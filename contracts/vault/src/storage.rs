//! Storage layout for the LiraShield vault contract.
use soroban_sdk::{contracttype, Address, Env};

/// Instance-level admin/config bumps: kept alive for the whole contract lifetime.
pub const INSTANCE_BUMP_AMOUNT: u32 = 34560 * 30; // ~30 days (5s ledgers)
pub const INSTANCE_LIFETIME_THRESHOLD: u32 = INSTANCE_BUMP_AMOUNT - 34560;

/// Persistent user positions: renewed on every touch, expire only if abandoned.
pub const PERSISTENT_BUMP_AMOUNT: u32 = 34560 * 90; // ~90 days
pub const PERSISTENT_LIFETIME_THRESHOLD: u32 = PERSISTENT_BUMP_AMOUNT - 34560;

/// Temporary re-entrancy guard: only needs to live for a single transaction.
pub const TEMPORARY_BUMP_AMOUNT: u32 = 100;

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// instance storage: global contract configuration
    Config,
    /// persistent storage: one entry per user, keyed by their address
    Position(Address),
    /// temporary storage: in-flight operation guard, keyed by user address
    PendingOp(Address),
}

#[derive(Clone)]
#[contracttype]
pub struct Config {
    pub admin: Address,
    pub try_token: Address,
    pub usdc_token: Address,
    pub soroswap_router: Address,
    pub defindex_vault: Address,
}

#[derive(Clone)]
#[contracttype]
pub struct Position {
    /// DeFindex vault shares currently held on the user's behalf
    pub usdc_shares: i128,
    /// lifetime total of TRY the user has deposited (informational)
    pub total_try_deposited: i128,
    /// lifetime total of TRY the user has withdrawn (informational)
    pub total_try_withdrawn: i128,
}

impl Position {
    pub fn empty() -> Self {
        Position {
            usdc_shares: 0,
            total_try_deposited: 0,
            total_try_withdrawn: 0,
        }
    }
}

pub fn has_config(env: &Env) -> bool {
    env.storage().instance().has(&DataKey::Config)
}

pub fn read_config(env: &Env) -> Config {
    let config = env
        .storage()
        .instance()
        .get(&DataKey::Config)
        .expect("lirashield: not initialized");
    bump_instance(env);
    config
}

pub fn write_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_LIFETIME_THRESHOLD, INSTANCE_BUMP_AMOUNT);
}

pub fn read_position(env: &Env, user: &Address) -> Position {
    let key = DataKey::Position(user.clone());
    match env.storage().persistent().get::<DataKey, Position>(&key) {
        Some(position) => {
            env.storage().persistent().extend_ttl(
                &key,
                PERSISTENT_LIFETIME_THRESHOLD,
                PERSISTENT_BUMP_AMOUNT,
            );
            position
        }
        None => Position::empty(),
    }
}

pub fn write_position(env: &Env, user: &Address, position: &Position) {
    let key = DataKey::Position(user.clone());
    env.storage().persistent().set(&key, position);
    env.storage().persistent().extend_ttl(
        &key,
        PERSISTENT_LIFETIME_THRESHOLD,
        PERSISTENT_BUMP_AMOUNT,
    );
}

/// Guards a user's deposit/withdraw call against re-entrant double-submission
/// within the same short window; expires on its own via temporary storage TTL.
pub fn begin_operation(env: &Env, user: &Address) {
    let key = DataKey::PendingOp(user.clone());
    if env.storage().temporary().has(&key) {
        panic!("lirashield: operation already in progress for user");
    }
    env.storage().temporary().set(&key, &true);
    env.storage()
        .temporary()
        .extend_ttl(&key, TEMPORARY_BUMP_AMOUNT, TEMPORARY_BUMP_AMOUNT);
}

pub fn end_operation(env: &Env, user: &Address) {
    let key = DataKey::PendingOp(user.clone());
    env.storage().temporary().remove(&key);
}
