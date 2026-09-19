#![cfg(test)]
use crate::{LiraShieldVault, LiraShieldVaultClient};
use soroban_sdk::{
    contract, contractimpl, contracttype,
    testutils::Address as _,
    token, Address, Env, Val, Vec,
};

#[derive(Clone)]
#[contracttype]
enum MockVaultKey {
    Token,
    Shares(Address),
}

/// A 1:1 test double for the DeFindex vault: mints one share per unit deposited
/// so assertions stay simple, while still exercising the real deposit/withdraw wiring.
#[contract]
pub struct MockDeFindexVault;

#[contractimpl]
impl MockDeFindexVault {
    pub fn init(env: Env, usdc_token: Address) {
        env.storage().instance().set(&MockVaultKey::Token, &usdc_token);
    }

    pub fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        _amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> (Vec<i128>, i128, Val) {
        let token_addr: Address = env.storage().instance().get(&MockVaultKey::Token).unwrap();
        let amount = amounts_desired.get(0).unwrap();
        let contract_address = env.current_contract_address();
        token::Client::new(&env, &token_addr).transfer(&from, &contract_address, &amount);

        let key = MockVaultKey::Shares(from);
        let mut shares: i128 = env.storage().instance().get(&key).unwrap_or(0);
        shares += amount;
        env.storage().instance().set(&key, &shares);

        let mut deposited = Vec::new(&env);
        deposited.push_back(amount);
        (deposited, amount, Val::VOID.into())
    }

    pub fn withdraw(env: Env, withdraw_shares: i128, _min_amounts_out: Vec<i128>, from: Address) -> Vec<i128> {
        let token_addr: Address = env.storage().instance().get(&MockVaultKey::Token).unwrap();
        let key = MockVaultKey::Shares(from.clone());
        let mut shares: i128 = env.storage().instance().get(&key).unwrap_or(0);
        if withdraw_shares > shares {
            panic!("mock vault: insufficient shares");
        }
        shares -= withdraw_shares;
        env.storage().instance().set(&key, &shares);
        token::Client::new(&env, &token_addr).transfer(&env.current_contract_address(), &from, &withdraw_shares);

        let mut out = Vec::new(&env);
        out.push_back(withdraw_shares);
        out
    }

    pub fn balance(env: Env, from: Address) -> i128 {
        env.storage().instance().get(&MockVaultKey::Shares(from)).unwrap_or(0)
    }

    /// 1:1 test double: one vault share always corresponds to one unit of the underlying asset.
    pub fn get_asset_amounts_per_shares(env: Env, vault_shares: i128) -> Vec<i128> {
        let mut amounts = Vec::new(&env);
        amounts.push_back(vault_shares);
        amounts
    }
}

/// A 1:1 test double for the Soroswap router: relays `amount_in` of the output
/// token back to `to`, so tests can assert on exact amounts without real pricing.
#[contract]
pub struct MockSoroswapRouter;

#[contractimpl]
impl MockSoroswapRouter {
    pub fn swap_exact_tokens_for_tokens(
        env: Env,
        amount_in: i128,
        amount_out_min: i128,
        path: Vec<Address>,
        to: Address,
        _deadline: u64,
    ) -> Vec<i128> {
        if amount_in < amount_out_min {
            panic!("mock router: slippage");
        }
        let token_in = path.get(0).unwrap();
        let token_out = path.get(path.len() - 1).unwrap();
        let contract_address = env.current_contract_address();
        token::Client::new(&env, &token_in).transfer_from(&contract_address, &to, &contract_address, &amount_in);
        token::Client::new(&env, &token_out).transfer(&contract_address, &to, &amount_in);

        let mut result = Vec::new(&env);
        result.push_back(amount_in);
        result.push_back(amount_in);
        result
    }
}

struct TestSetup {
    env: Env,
    vault: LiraShieldVaultClient<'static>,
    try_token: token::Client<'static>,
    usdc_token: token::Client<'static>,
    user: Address,
}

fn setup() -> TestSetup {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let user = Address::generate(&env);

    let try_asset = env.register_stellar_asset_contract_v2(admin.clone());
    let try_token_address = try_asset.address();
    let usdc_asset = env.register_stellar_asset_contract_v2(admin.clone());
    let usdc_token_address = usdc_asset.address();

    let try_token = token::Client::new(&env, &try_token_address);
    let usdc_token = token::Client::new(&env, &usdc_token_address);
    let try_token_admin = token::StellarAssetClient::new(&env, &try_token_address);
    let usdc_token_admin = token::StellarAssetClient::new(&env, &usdc_token_address);

    // Fund the user with TRY and USDC, and pre-fund the mock router with both
    // assets so it can pay out either leg of a swap.
    try_token_admin.mint(&user, &1_000_000_000);
    usdc_token_admin.mint(&user, &1_000_000_000);
    let router_id = env.register(MockSoroswapRouter, ());
    try_token_admin.mint(&router_id, &1_000_000_000);
    usdc_token_admin.mint(&router_id, &1_000_000_000);

    let vault_id = env.register(MockDeFindexVault, ());
    MockDeFindexVaultClient::new(&env, &vault_id).init(&usdc_token_address);

    let contract_id = env.register(LiraShieldVault, ());
    let vault = LiraShieldVaultClient::new(&env, &contract_id);
    vault.initialize(&admin, &try_token_address, &usdc_token_address, &router_id, &vault_id);

    TestSetup {
        env,
        vault,
        try_token,
        usdc_token,
        user,
    }
}

#[test]
fn test_deposit_and_shield_mints_shares() {
    let t = setup();

    let shares = t.vault.deposit_and_shield(&t.user, &500_000, &500_000);

    assert_eq!(shares, 500_000);
    assert_eq!(t.try_token.balance(&t.user), 1_000_000_000 - 500_000);

    let position = t.vault.get_user_position(&t.user);
    assert_eq!(position.usdc_shares, 500_000);
    assert_eq!(position.total_try_deposited, 500_000);
    assert_eq!(position.estimated_usdc_value, 500_000);
}

#[test]
fn test_withdraw_to_lira_returns_try() {
    let t = setup();
    t.vault.deposit_and_shield(&t.user, &500_000, &500_000);

    let try_received = t.vault.withdraw_to_lira(&t.user, &200_000, &200_000);

    assert_eq!(try_received, 200_000);
    let position = t.vault.get_user_position(&t.user);
    assert_eq!(position.usdc_shares, 300_000);
    assert_eq!(position.total_try_withdrawn, 200_000);
    assert_eq!(t.usdc_token.balance(&t.user), 1_000_000_000);
}

#[test]
#[should_panic(expected = "lirashield: insufficient shielded balance")]
fn test_withdraw_more_than_balance_panics() {
    let t = setup();
    t.vault.deposit_and_shield(&t.user, &100_000, &100_000);
    t.vault.withdraw_to_lira(&t.user, &200_000, &200_000);
}

#[test]
#[should_panic(expected = "mock router: slippage")]
fn test_deposit_rejects_output_below_minimum() {
    let t = setup();
    t.vault.deposit_and_shield(&t.user, &500_000, &500_001);
}

#[test]
fn test_shield_usdc_skips_swap() {
    let t = setup();

    let shares = t.vault.shield_usdc(&t.user, &300_000);

    assert_eq!(shares, 300_000);
    assert_eq!(t.usdc_token.balance(&t.user), 1_000_000_000 - 300_000);
    let position = t.vault.get_user_position(&t.user);
    assert_eq!(position.usdc_shares, 300_000);
    assert_eq!(position.total_try_deposited, 0);
}

#[test]
fn test_unshield_usdc_skips_swap() {
    let t = setup();
    t.vault.shield_usdc(&t.user, &300_000);

    let usdc_received = t.vault.unshield_usdc(&t.user, &100_000);

    assert_eq!(usdc_received, 100_000);
    assert_eq!(t.usdc_token.balance(&t.user), 1_000_000_000 - 300_000 + 100_000);
    let position = t.vault.get_user_position(&t.user);
    assert_eq!(position.usdc_shares, 200_000);
}

#[test]
fn test_unshield_usdc_to_pays_recipient() {
    let t = setup();
    let recipient = Address::generate(&t.env);
    t.vault.shield_usdc(&t.user, &300_000);

    let usdc_received = t.vault.unshield_usdc_to(&t.user, &100_000, &recipient);

    assert_eq!(usdc_received, 100_000);
    assert_eq!(t.usdc_token.balance(&recipient), 100_000);
    let position = t.vault.get_user_position(&t.user);
    assert_eq!(position.usdc_shares, 200_000);
}

#[test]
#[should_panic(expected = "lirashield: already initialized")]
fn test_double_initialize_panics() {
    let t = setup();
    let admin = Address::generate(&t.env);
    t.vault.initialize(
        &admin,
        &Address::generate(&t.env),
        &Address::generate(&t.env),
        &Address::generate(&t.env),
        &Address::generate(&t.env),
    );
}
