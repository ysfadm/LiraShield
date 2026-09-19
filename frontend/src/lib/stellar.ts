import { Networks, rpc } from "@stellar/stellar-sdk";

/**
 * Central Stellar Testnet configuration shared by every LiraShield module.
 * Kept in one place so switching networks (e.g. for a live demo) is a one-line change.
 */
export const STELLAR_NETWORK_PASSPHRASE = Networks.TESTNET;

export const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ??
  "https://soroban-testnet.stellar.org";

export const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const LIRASHIELD_VAULT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_LIRASHIELD_VAULT_CONTRACT_ID ?? "";

export const TRY_TOKEN_CONTRACT_ID =
  process.env.NEXT_PUBLIC_TRY_TOKEN_CONTRACT_ID ?? "";
export const USDC_TOKEN_CONTRACT_ID =
  process.env.NEXT_PUBLIC_USDC_TOKEN_CONTRACT_ID ?? "";
export const BLEND_USDC_ISSUER =
  process.env.NEXT_PUBLIC_BLEND_USDC_ISSUER ??
  "GATALTGTWIOT6BUDBCZM3Q4OQ4BO2COLOAZ7IYSKPLC2PMSOPPGF5V56";

/**
 * Soroswap Router, used directly (outside the vault contract) to bridge
 * between the anchor's own USDC asset and the vault's configured USDC
 * (BlendUSDC on testnet — DeFindex's only whitelisted testnet USDC strategy
 * asset). See lib/anchor-sep.ts for the swap steps around shield/unshield.
 */
export const SOROSWAP_ROUTER_CONTRACT_ID =
  process.env.NEXT_PUBLIC_SOROSWAP_ROUTER_CONTRACT_ID ?? "";

/** DeFindex vault that holds the USD-protected position (config.defindex_vault on-chain). Yield is optional later — not claimed on testnet. */
export const DEFINDEX_VAULT_CONTRACT_ID =
  process.env.NEXT_PUBLIC_DEFINDEX_VAULT_CONTRACT_ID ?? "";

export const MAX_TRANSACTION_AMOUNT = 1_000_000;

let server: rpc.Server | null = null;

/** Lazily-created singleton RPC client for reading ledger/contract state. */
export function getSorobanServer(): rpc.Server {
  if (!server) {
    server = new rpc.Server(SOROBAN_RPC_URL, {
      allowHttp: SOROBAN_RPC_URL.startsWith("http://"),
    });
  }
  return server;
}

/** Converts raw stroops-scaled i128 amounts (7 decimals) to a display-friendly number. */
export function scaledAmountToNumber(
  amount: bigint | number,
  decimals = 7,
): number {
  const value =
    typeof amount === "bigint" ? amount : BigInt(Math.trunc(amount));
  return Number(value) / 10 ** decimals;
}

/** Converts a human-entered decimal amount into the contract's scaled i128 representation. */
export function numberToScaledAmount(value: number, decimals = 7): bigint {
  return BigInt(Math.round(value * 10 ** decimals));
}

/** Public testnet explorer link for a transaction hash, used to prove on-chain execution during a demo. */
export function stellarExpertTxUrl(hash: string): string {
  return `https://stellar.expert/explorer/testnet/tx/${hash}`;
}

/** Public testnet explorer link for a contract or account id. */
export function stellarExpertContractUrl(contractId: string): string {
  return `https://stellar.expert/explorer/testnet/contract/${contractId}`;
}

/** Public testnet explorer link for a classic G-address or smart wallet C-address. */
export function stellarExpertAccountUrl(address: string): string {
  return `https://stellar.expert/explorer/testnet/account/${address}`;
}
