//! Minimal client interfaces for the external protocols LiraShield composes with.
//!
//! These traits mirror the public entrypoints of the deployed Soroswap Router and
//! DeFindex Vault testnet contracts. `#[contractclient]` generates a typed `Client`
//! that invokes the given contract `Address` at runtime, no WASM import needed.
use soroban_sdk::{contractclient, Address, Env, Val, Vec};

#[contractclient(name = "SoroswapRouterClient")]
#[allow(dead_code)]
pub trait SoroswapRouterInterface {
    /// Swaps an exact amount of the input token for as much of the output token
    /// as possible along `path`, reverting if the output is below `amount_out_min`.
    /// Returns the amount received at each hop of `path`.
    fn swap_exact_tokens_for_tokens(
        env: Env,
        amount_in: i128,
        amount_out_min: i128,
        path: Vec<Address>,
        to: Address,
        deadline: u64,
    ) -> Vec<i128>;
}

#[contractclient(name = "DeFindexVaultClient")]
#[allow(dead_code)]
pub trait DeFindexVaultInterface {
    /// Deposits `amounts_desired` of the vault's underlying asset(s) on behalf of
    /// `from` and mints vault shares. Returns (amounts actually deposited, shares
    /// minted, optional investment allocations — opaque `Val`, unused by LiraShield).
    fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        invest: bool,
    ) -> (Vec<i128>, i128, Val);

    /// Burns `withdraw_shares` of `from`'s vault shares and returns the underlying
    /// asset amount(s) withdrawn.
    fn withdraw(
        env: Env,
        withdraw_shares: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Vec<i128>;

    /// Current share balance held by `from`.
    fn balance(env: Env, from: Address) -> i128;

    /// Underlying asset amount(s) represented by `vault_shares`, one entry per
    /// vault asset (LiraShield's vaults are single-asset, so index 0 is USDC).
    fn get_asset_amounts_per_shares(env: Env, vault_shares: i128) -> Vec<i128>;
}
