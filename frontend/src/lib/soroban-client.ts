import { Client as ContractClient } from "@stellar/stellar-sdk/contract";
import type {
  AssembledTransaction,
  SignTransaction,
} from "@stellar/stellar-sdk/contract";
import {
  LIRASHIELD_VAULT_CONTRACT_ID,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
} from "./stellar";

/**
 * Generic wallet-signing callback, matching the de-facto standard used by
 * Freighter, xBull, and `@stellar/stellar-sdk/contract`'s `Client`. Any
 * wallet adapter — including the passkey bridge in `lib/passkey.ts` — can
 * implement this shape.
 */
export type WalletSigner = SignTransaction;

export interface UserPositionView {
  usdcShares: bigint;
  estimatedUsdcValue: bigint;
  totalTryDeposited: bigint;
  totalTryWithdrawn: bigint;
}

interface RawUserPosition {
  usdc_shares: bigint;
  estimated_usdc_value: bigint;
  total_try_deposited: bigint;
  total_try_withdrawn: bigint;
}

interface VaultMethods {
  deposit_and_shield: (args: {
    user: string;
    try_amount: bigint;
    min_usdc_received: bigint;
  }) => Promise<AssembledTransaction<bigint>>;
  withdraw_to_lira: (args: {
    user: string;
    usdc_share_amount: bigint;
    min_try_received: bigint;
  }) => Promise<AssembledTransaction<bigint>>;
  shield_usdc: (args: {
    user: string;
    usdc_amount: bigint;
  }) => Promise<AssembledTransaction<bigint>>;
  unshield_usdc: (args: {
    user: string;
    usdc_share_amount: bigint;
  }) => Promise<AssembledTransaction<bigint>>;
  unshield_usdc_to: (args: {
    user: string;
    usdc_share_amount: bigint;
    recipient: string;
  }) => Promise<AssembledTransaction<bigint>>;
  get_user_position: (args: {
    user: string;
  }) => Promise<AssembledTransaction<RawUserPosition>>;
}

let cachedClient: (ContractClient & VaultMethods) | null = null;

/** Lazily fetches the deployed vault's on-chain spec and builds a typed client for it. */
export async function getVaultClient(publicKey?: string) {
  if (!LIRASHIELD_VAULT_CONTRACT_ID) {
    throw new Error(
      "lirashield: NEXT_PUBLIC_LIRASHIELD_VAULT_CONTRACT_ID is not configured",
    );
  }
  if (publicKey) {
    return (await ContractClient.from({
      contractId: LIRASHIELD_VAULT_CONTRACT_ID,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      rpcUrl: SOROBAN_RPC_URL,
      publicKey,
    })) as ContractClient & VaultMethods;
  }
  if (!cachedClient) {
    cachedClient = (await ContractClient.from({
      contractId: LIRASHIELD_VAULT_CONTRACT_ID,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      rpcUrl: SOROBAN_RPC_URL,
    })) as ContractClient & VaultMethods;
  }
  return cachedClient;
}

/** Builds (simulates) a deposit call without signing it — used by the passkey flow, which signs separately. */
export async function buildDepositAndShieldTx(
  userAddress: string,
  tryAmountScaled: bigint,
  minUsdcReceivedScaled: bigint,
) {
  const client = await getVaultClient();
  return client.deposit_and_shield({
    user: userAddress,
    try_amount: tryAmountScaled,
    min_usdc_received: minUsdcReceivedScaled,
  });
}

/** Builds (simulates) a withdraw call without signing it — used by the passkey flow, which signs separately. */
export async function buildWithdrawToLiraTx(
  userAddress: string,
  usdcShareAmountScaled: bigint,
  minTryReceivedScaled: bigint,
) {
  const client = await getVaultClient();
  return client.withdraw_to_lira({
    user: userAddress,
    usdc_share_amount: usdcShareAmountScaled,
    min_try_received: minTryReceivedScaled,
  });
}

/** Builds a deposit call for USDC the user already holds (e.g. swept in from an anchor) — skips the Soroswap leg. */
export async function buildShieldUsdcTx(
  userAddress: string,
  usdcAmountScaled: bigint,
  publicKey?: string,
) {
  const client = await getVaultClient(publicKey);
  return client.shield_usdc({
    user: userAddress,
    usdc_amount: usdcAmountScaled,
  });
}

/** Builds a withdraw call that pays the user directly in USDC — skips the Soroswap leg. */
export async function buildUnshieldUsdcTx(
  userAddress: string,
  usdcShareAmountScaled: bigint,
) {
  const client = await getVaultClient();
  return client.unshield_usdc({
    user: userAddress,
    usdc_share_amount: usdcShareAmountScaled,
  });
}

/** Builds a withdraw call that pays the resulting USDC to a bridge/recipient address. */
export async function buildUnshieldUsdcToTx(
  userAddress: string,
  usdcShareAmountScaled: bigint,
  recipientAddress: string,
  publicKey?: string,
) {
  const client = await getVaultClient(publicKey);
  return client.unshield_usdc_to({
    user: userAddress,
    usdc_share_amount: usdcShareAmountScaled,
    recipient: recipientAddress,
  });
}

/** Builds a plain Stellar Asset Contract `transfer` call against any SAC. */
export async function buildSacTransferTx(
  sacContractId: string,
  fromAddress: string,
  toAddress: string,
  amountScaled: bigint,
  publicKey?: string,
) {
  const client = (await ContractClient.from({
    contractId: sacContractId,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    ...(publicKey ? { publicKey } : {}),
  })) as ContractClient & {
    transfer: (
      args: { from: string; to: string; amount: bigint },
      options?: { simulate?: boolean },
    ) => Promise<AssembledTransaction<null>>;
  };

  return client.transfer({
    from: fromAddress,
    to: toAddress,
    amount: amountScaled,
  });
}

/** Builds a SEP-41 `approve` call against any token SAC, needed before a Soroswap router swap can pull funds. */
export async function buildSacApproveTx(
  sacContractId: string,
  fromAddress: string,
  spenderAddress: string,
  amountScaled: bigint,
  expirationLedger: number,
  publicKey?: string,
) {
  const client = (await ContractClient.from({
    contractId: sacContractId,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    ...(publicKey ? { publicKey } : {}),
  })) as ContractClient & {
    approve: (args: {
      from: string;
      spender: string;
      amount: bigint;
      expiration_ledger: number;
    }) => Promise<AssembledTransaction<null>>;
  };

  return client.approve({
    from: fromAddress,
    spender: spenderAddress,
    amount: amountScaled,
    expiration_ledger: expirationLedger,
  });
}

/** Reads a Stellar Asset Contract balance for a user or contract address. */
export async function getSacBalance(
  sacContractId: string,
  address: string,
): Promise<bigint> {
  const client = (await ContractClient.from({
    contractId: sacContractId,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
  })) as ContractClient & {
    balance: (args: { id: string }) => Promise<AssembledTransaction<bigint>>;
  };

  const assembled = await client.balance({ id: address });
  return assembled.result;
}

/**
 * Builds a Soroswap Router `swap_exact_tokens_for_tokens` call, used outside
 * the vault to bridge between the anchor's own USDC and the vault's
 * configured USDC (BlendUSDC on testnet) around shield/unshield. The caller
 * must already have approved the router for `amountInScaled` of `path[0]`.
 */
export async function buildRouterSwapTx(
  routerContractId: string,
  path: string[],
  amountInScaled: bigint,
  amountOutMinScaled: bigint,
  toAddress: string,
  deadline: bigint,
  publicKey?: string,
) {
  const client = (await ContractClient.from({
    contractId: routerContractId,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    ...(publicKey ? { publicKey } : {}),
  })) as ContractClient & {
    swap_exact_tokens_for_tokens: (
      args: {
        amount_in: bigint;
        amount_out_min: bigint;
        path: string[];
        to: string;
        deadline: bigint;
      },
      options?: { simulate?: boolean },
    ) => Promise<AssembledTransaction<bigint[]>>;
  };

  const args = {
    amount_in: amountInScaled,
    amount_out_min: amountOutMinScaled,
    path,
    to: toAddress,
    deadline,
  };

  return client.swap_exact_tokens_for_tokens(args);
}

/** Returns the deployed router's current output estimate for an exact-input path. */
export async function getRouterAmountsOut(
  routerContractId: string,
  path: string[],
  amountInScaled: bigint,
): Promise<bigint[]> {
  const client = (await ContractClient.from({
    contractId: routerContractId,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
  })) as ContractClient & {
    router_get_amounts_out: (args: {
      amount_in: bigint;
      path: string[];
    }) => Promise<AssembledTransaction<{ unwrap: () => bigint[] }>>;
  };

  const quote = await client.router_get_amounts_out({
    amount_in: amountInScaled,
    path,
  });
  // Spec returns Result<Vec<i128>, SoroswapLibraryError>; unwrap to the vector.
  return quote.result.unwrap();
}

/** Reads the user's current shielded balance and estimated USD value; needs no signature. */
export async function getUserPosition(
  userAddress: string,
): Promise<UserPositionView> {
  const client = await getVaultClient();
  const assembled = await client.get_user_position({ user: userAddress });

  return {
    usdcShares: assembled.result.usdc_shares,
    estimatedUsdcValue: assembled.result.estimated_usdc_value,
    totalTryDeposited: assembled.result.total_try_deposited,
    totalTryWithdrawn: assembled.result.total_try_withdrawn,
  };
}
