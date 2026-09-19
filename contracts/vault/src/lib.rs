#![no_std]
//! LiraShield Vault — non-custodial TRY -> USDC shield with DeFindex yield.
//!
//! Deposits TRY, swaps it to USDC via Soroswap, and parks the USDC in a DeFindex
//! yield vault on the user's behalf. Withdrawals reverse the flow back to TRY.
mod external;
mod storage;

#[cfg(test)]
mod test;

use external::{DeFindexVaultClient, SoroswapRouterClient};
use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractevent, contractimpl, contracttype, token, vec, Address, Env, IntoVal, Symbol,
    Vec,
};
use storage::{Config, Position};

fn authorize_token_transfer(
    env: &Env,
    token: &Address,
    from: &Address,
    to: &Address,
    amount: i128,
) {
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: token.clone(),
                fn_name: Symbol::new(env, "transfer"),
                args: (from.clone(), to.clone(), amount).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
}

fn authorize_defindex_withdraw(
    env: &Env,
    defindex_vault: &Address,
    withdraw_shares: i128,
    min_amounts_out: &Vec<i128>,
    from: &Address,
) {
    env.authorize_as_current_contract(vec![
        env,
        InvokerContractAuthEntry::Contract(SubContractInvocation {
            context: ContractContext {
                contract: defindex_vault.clone(),
                fn_name: Symbol::new(env, "withdraw"),
                args: (withdraw_shares, min_amounts_out.clone(), from.clone()).into_val(env),
            },
            sub_invocations: vec![env],
        }),
    ]);
}

#[derive(Clone)]
#[contracttype]
pub struct UserPositionView {
    pub usdc_shares: i128,
    pub estimated_usdc_value: i128,
    pub total_try_deposited: i128,
    pub total_try_withdrawn: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DepositEvent {
    #[topic]
    pub user: Address,
    pub try_amount: i128,
    pub shares_minted: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShieldEvent {
    #[topic]
    pub user: Address,
    pub usdc_amount: i128,
    pub shares_minted: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct WithdrawEvent {
    #[topic]
    pub user: Address,
    pub usdc_share_amount: i128,
    pub try_received: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct UnshieldEvent {
    #[topic]
    pub user: Address,
    pub usdc_share_amount: i128,
    pub usdc_received: i128,
}

#[contract]
pub struct LiraShieldVault;

#[contractimpl]
impl LiraShieldVault {
    /// One-time setup: wires the vault to its TRY/USDC assets and the Soroswap
    /// router + DeFindex vault it composes with. Callable once by the admin.
    pub fn initialize(
        env: Env,
        admin: Address,
        try_token: Address,
        usdc_token: Address,
        soroswap_router: Address,
        defindex_vault: Address,
    ) {
        if storage::has_config(&env) {
            panic!("lirashield: already initialized");
        }
        admin.require_auth();

        storage::write_config(
            &env,
            &Config {
                admin,
                try_token,
                usdc_token,
                soroswap_router,
                defindex_vault,
            },
        );
    }

    /// Pulls `try_amount` TRY from `user`, swaps it to USDC on Soroswap, deposits
    /// the USDC into the DeFindex vault, and credits the resulting shares to the
    /// user's persistent position. Returns the number of vault shares minted.
    pub fn deposit_and_shield(
        env: Env,
        user: Address,
        try_amount: i128,
        min_usdc_received: i128,
    ) -> i128 {
        if try_amount <= 0 {
            panic!("lirashield: amount must be positive");
        }
        if min_usdc_received < 0 {
            panic!("lirashield: minimum output cannot be negative");
        }
        user.require_auth();
        storage::begin_operation(&env, &user);

        let config = storage::read_config(&env);
        let contract_address = env.current_contract_address();
        let expiration_ledger = env.ledger().sequence() + 200;
        let deadline = env.ledger().timestamp() + 300;

        // 1. Pull TRY from the user into this contract.
        let try_client = token::Client::new(&env, &config.try_token);
        try_client.transfer(&user, &contract_address, &try_amount);

        // 2. Swap TRY -> USDC through the Soroswap router.
        try_client.approve(
            &contract_address,
            &config.soroswap_router,
            &try_amount,
            &expiration_ledger,
        );
        let router = SoroswapRouterClient::new(&env, &config.soroswap_router);
        let mut swap_path: Vec<Address> = Vec::new(&env);
        swap_path.push_back(config.try_token.clone());
        swap_path.push_back(config.usdc_token.clone());
        let swap_amounts =
            router.swap_exact_tokens_for_tokens(
                &try_amount,
                &min_usdc_received,
                &swap_path,
                &contract_address,
                &deadline,
            );
        let usdc_received = swap_amounts.get(swap_amounts.len() - 1).unwrap();

        // 3. Deposit the USDC into the DeFindex yield vault and record shares.
        let usdc_client = token::Client::new(&env, &config.usdc_token);
        usdc_client.approve(
            &contract_address,
            &config.defindex_vault,
            &usdc_received,
            &expiration_ledger,
        );
        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let mut amounts_desired: Vec<i128> = Vec::new(&env);
        amounts_desired.push_back(usdc_received);
        let mut amounts_min: Vec<i128> = Vec::new(&env);
        amounts_min.push_back(0);
        authorize_token_transfer(
            &env,
            &config.usdc_token,
            &contract_address,
            &config.defindex_vault,
            usdc_received,
        );
        let (_deposited, shares_minted, _investment) =
            vault.deposit(&amounts_desired, &amounts_min, &contract_address, &true);

        let mut position = storage::read_position(&env, &user);
        position.usdc_shares += shares_minted;
        position.total_try_deposited += try_amount;
        storage::write_position(&env, &user, &position);

        storage::end_operation(&env, &user);
        DepositEvent {
            user,
            try_amount,
            shares_minted,
        }
        .publish(&env);

        shares_minted
    }

    /// Deposits `usdc_amount` of USDC the user already holds directly into the
    /// DeFindex vault, skipping the Soroswap leg. Use this path when the TRY
    /// leg was already converted off-chain (e.g. a SEP-6 anchor that delivers
    /// USDC straight to the user, such as TR Mock Anchor). Returns the shares minted.
    pub fn shield_usdc(env: Env, user: Address, usdc_amount: i128) -> i128 {
        if usdc_amount <= 0 {
            panic!("lirashield: amount must be positive");
        }
        user.require_auth();
        storage::begin_operation(&env, &user);

        let config = storage::read_config(&env);
        let contract_address = env.current_contract_address();
        let expiration_ledger = env.ledger().sequence() + 200;

        // 1. Pull USDC from the user into this contract.
        let usdc_client = token::Client::new(&env, &config.usdc_token);
        usdc_client.transfer(&user, &contract_address, &usdc_amount);

        // 2. Deposit the USDC into the DeFindex yield vault and record shares.
        usdc_client.approve(
            &contract_address,
            &config.defindex_vault,
            &usdc_amount,
            &expiration_ledger,
        );
        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let mut amounts_desired: Vec<i128> = Vec::new(&env);
        amounts_desired.push_back(usdc_amount);
        let mut amounts_min: Vec<i128> = Vec::new(&env);
        amounts_min.push_back(0);
        authorize_token_transfer(
            &env,
            &config.usdc_token,
            &contract_address,
            &config.defindex_vault,
            usdc_amount,
        );
        let (_deposited, shares_minted, _investment) =
            vault.deposit(&amounts_desired, &amounts_min, &contract_address, &true);

        let mut position = storage::read_position(&env, &user);
        position.usdc_shares += shares_minted;
        storage::write_position(&env, &user, &position);

        storage::end_operation(&env, &user);
        ShieldEvent {
            user,
            usdc_amount,
            shares_minted,
        }
        .publish(&env);

        shares_minted
    }

    /// Burns `usdc_share_amount` of the user's DeFindex shares, swaps the
    /// resulting USDC back to TRY on Soroswap, and pays the user in TRY.
    /// Returns the TRY amount transferred to the user.
    pub fn withdraw_to_lira(
        env: Env,
        user: Address,
        usdc_share_amount: i128,
        min_try_received: i128,
    ) -> i128 {
        if usdc_share_amount <= 0 {
            panic!("lirashield: amount must be positive");
        }
        if min_try_received < 0 {
            panic!("lirashield: minimum output cannot be negative");
        }
        user.require_auth();
        storage::begin_operation(&env, &user);

        let mut position = storage::read_position(&env, &user);
        if usdc_share_amount > position.usdc_shares {
            panic!("lirashield: insufficient shielded balance");
        }

        let config = storage::read_config(&env);
        let contract_address = env.current_contract_address();
        let expiration_ledger = env.ledger().sequence() + 200;
        let deadline = env.ledger().timestamp() + 300;

        // 1. Withdraw USDC from the DeFindex vault.
        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let mut min_amounts_out: Vec<i128> = Vec::new(&env);
        min_amounts_out.push_back(0);
        authorize_defindex_withdraw(
            &env,
            &config.defindex_vault,
            usdc_share_amount,
            &min_amounts_out,
            &contract_address,
        );
        let amounts_out = vault.withdraw(&usdc_share_amount, &min_amounts_out, &contract_address);
        let usdc_received = amounts_out.get(0).unwrap();

        // 2. Swap USDC -> TRY through the Soroswap router.
        let usdc_client = token::Client::new(&env, &config.usdc_token);
        usdc_client.approve(
            &contract_address,
            &config.soroswap_router,
            &usdc_received,
            &expiration_ledger,
        );
        let router = SoroswapRouterClient::new(&env, &config.soroswap_router);
        let mut swap_path: Vec<Address> = Vec::new(&env);
        swap_path.push_back(config.usdc_token.clone());
        swap_path.push_back(config.try_token.clone());
        let swap_amounts =
            router.swap_exact_tokens_for_tokens(
                &usdc_received,
                &min_try_received,
                &swap_path,
                &contract_address,
                &deadline,
            );
        let try_received = swap_amounts.get(swap_amounts.len() - 1).unwrap();

        // 3. Pay the user in TRY.
        let try_client = token::Client::new(&env, &config.try_token);
        try_client.transfer(&contract_address, &user, &try_received);

        position.usdc_shares -= usdc_share_amount;
        position.total_try_withdrawn += try_received;
        storage::write_position(&env, &user, &position);

        storage::end_operation(&env, &user);
        WithdrawEvent {
            user,
            usdc_share_amount,
            try_received,
        }
        .publish(&env);

        try_received
    }

    /// Burns `usdc_share_amount` of shares and pays the user directly in USDC,
    /// skipping the Soroswap leg — the mirror of `shield_usdc`, for anchors
    /// (like TR Mock Anchor) that convert USDC back to TRY off-chain themselves.
    /// Returns the USDC amount paid to the user.
    pub fn unshield_usdc(env: Env, user: Address, usdc_share_amount: i128) -> i128 {
        if usdc_share_amount <= 0 {
            panic!("lirashield: amount must be positive");
        }
        user.require_auth();
        storage::begin_operation(&env, &user);

        let mut position = storage::read_position(&env, &user);
        if usdc_share_amount > position.usdc_shares {
            panic!("lirashield: insufficient shielded balance");
        }

        let config = storage::read_config(&env);
        let contract_address = env.current_contract_address();

        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let mut min_amounts_out: Vec<i128> = Vec::new(&env);
        min_amounts_out.push_back(0);
        authorize_defindex_withdraw(
            &env,
            &config.defindex_vault,
            usdc_share_amount,
            &min_amounts_out,
            &contract_address,
        );
        let amounts_out = vault.withdraw(&usdc_share_amount, &min_amounts_out, &contract_address);
        let usdc_received = amounts_out.get(0).unwrap();

        let usdc_client = token::Client::new(&env, &config.usdc_token);
        usdc_client.transfer(&contract_address, &user, &usdc_received);

        position.usdc_shares -= usdc_share_amount;
        storage::write_position(&env, &user, &position);

        storage::end_operation(&env, &user);
        UnshieldEvent {
            user,
            usdc_share_amount,
            usdc_received,
        }
        .publish(&env);

        usdc_received
    }

    /// Burns shares and pays the resulting USDC to `recipient`. This keeps the
    /// user authorization on the shielded position while allowing the frontend
    /// to send withdrawn BlendUSDC straight to the classic bridge account, so
    /// the rest of the IBAN off-ramp can proceed without extra passkey prompts.
    pub fn unshield_usdc_to(
        env: Env,
        user: Address,
        usdc_share_amount: i128,
        recipient: Address,
    ) -> i128 {
        if usdc_share_amount <= 0 {
            panic!("lirashield: amount must be positive");
        }
        user.require_auth();
        storage::begin_operation(&env, &user);

        let mut position = storage::read_position(&env, &user);
        if usdc_share_amount > position.usdc_shares {
            panic!("lirashield: insufficient shielded balance");
        }

        let config = storage::read_config(&env);
        let contract_address = env.current_contract_address();

        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let mut min_amounts_out: Vec<i128> = Vec::new(&env);
        min_amounts_out.push_back(0);
        authorize_defindex_withdraw(
            &env,
            &config.defindex_vault,
            usdc_share_amount,
            &min_amounts_out,
            &contract_address,
        );
        let amounts_out = vault.withdraw(&usdc_share_amount, &min_amounts_out, &contract_address);
        let usdc_received = amounts_out.get(0).unwrap();

        let usdc_client = token::Client::new(&env, &config.usdc_token);
        usdc_client.transfer(&contract_address, &recipient, &usdc_received);

        position.usdc_shares -= usdc_share_amount;
        storage::write_position(&env, &user, &position);

        storage::end_operation(&env, &user);
        UnshieldEvent {
            user,
            usdc_share_amount,
            usdc_received,
        }
        .publish(&env);

        usdc_received
    }

    /// Read-only view of a user's current shielded position and estimated yield.
    pub fn get_user_position(env: Env, user: Address) -> UserPositionView {
        let position: Position = storage::read_position(&env, &user);
        let config = storage::read_config(&env);
        let vault = DeFindexVaultClient::new(&env, &config.defindex_vault);
        let estimated_usdc_value = if position.usdc_shares > 0 {
            vault
                .get_asset_amounts_per_shares(&position.usdc_shares)
                .get(0)
                .unwrap_or(0)
        } else {
            0
        };

        UserPositionView {
            usdc_shares: position.usdc_shares,
            estimated_usdc_value,
            total_try_deposited: position.total_try_deposited,
            total_try_withdrawn: position.total_try_withdrawn,
        }
    }
}
