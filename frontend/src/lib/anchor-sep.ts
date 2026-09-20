import {
  Asset,
  Horizon,
  Keypair,
  Memo,
  Operation,
  BASE_FEE,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import type { SignTransaction } from "@stellar/stellar-sdk/contract";
import { getOrCreateBridgeKeypair } from "./bridge-account";
import {
  getSorobanServer,
  BLEND_USDC_ISSUER,
  HORIZON_URL,
  SOROSWAP_ROUTER_CONTRACT_ID,
  STELLAR_NETWORK_PASSPHRASE,
  USDC_TOKEN_CONTRACT_ID,
} from "./stellar";
import {
  buildShieldUsdcTx,
  buildRouterSwapTx,
  buildSacApproveTx,
  buildSacTransferTx,
  getRouterAmountsOut,
} from "./soroban-client";

/** Ledger/timestamp headroom given to the one-off approve + Soroswap-router swap around shield/unshield. */
const SWAP_LEDGER_BUMP = 200;
const SWAP_DEADLINE_SECONDS = 300;
const SWAP_MIN_OUTPUT_BPS = 9_900;

function minimumSwapOutput(quotedOutput: bigint): bigint {
  return (quotedOutput * BigInt(SWAP_MIN_OUTPUT_BPS)) / BigInt(10_000);
}

/** Soroban `Result<Vec<i128>>` returns arrive as an `Ok { value }` wrapper; normalize to a plain array. */
function unwrapVec(result: unknown): bigint[] {
  if (Array.isArray(result)) return result as bigint[];
  if (result && typeof (result as { unwrap?: unknown }).unwrap === "function") {
    return (result as { unwrap: () => bigint[] }).unwrap();
  }
  if (result && Array.isArray((result as { value?: unknown }).value)) {
    return (result as { value: bigint[] }).value;
  }
  return [];
}

/** Runs a deposit/withdraw stage, surfacing which step failed and the underlying reason. */
async function stage<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    console.error(`lirashield: ${label} failed`, err);
    const reason =
      err instanceof Error && err.message ? err.message : String(err);
    throw new Error(`lirashield: ${label} failed — ${reason}`);
  }
}

async function currentExpirationLedger(): Promise<number> {
  const { sequence } = await getSorobanServer().getLatestLedger();
  return sequence + SWAP_LEDGER_BUMP;
}

function currentDeadline(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS);
}

function scaledUsdcToAmount(amountScaled: bigint): string {
  const scale = BigInt(10_000_000);
  const whole = amountScaled / scale;
  const fraction = (amountScaled % scale).toString().padStart(7, "0");
  return `${whole}.${fraction}`;
}

/**
 * SEP-6 transfer servers (and this demo rail) accept at most 2 decimal places.
 * Quotes from SEP-38 / scaled stroops often return 7+ digits — round before
 * sending deposit, deposit-exchange, or withdraw amounts.
 */
function formatSep6Amount(amount: string | number): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("lirashield: invalid amount for SEP-6");
  }
  return (Math.round(value * 100) / 100).toFixed(2);
}

/** Signs a plain XDR transaction with a classic Ed25519 keypair (the anchor bridge account). */
function classicSignTransaction(keypair: Keypair): SignTransaction {
  return async (xdr: string) => {
    const tx = TransactionBuilder.fromXDR(xdr, STELLAR_NETWORK_PASSPHRASE);
    if ("sign" in tx) {
      tx.sign(keypair);
    }
    return { signedTxXdr: tx.toXDR() };
  };
}

async function submitClassicUsdcPaymentWithMemo(
  keypair: Keypair,
  destination: string,
  usdcIssuer: string,
  amountScaled: bigint,
  memoId?: string,
): Promise<string> {
  const horizon = new Horizon.Server(HORIZON_URL);
  const account = await horizon.loadAccount(keypair.publicKey());
  const builder = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({
        destination,
        asset: new Asset("USDC", usdcIssuer),
        amount: scaledUsdcToAmount(amountScaled),
      }),
    )
    .setTimeout(60);

  if (memoId) {
    builder.addMemo(Memo.id(memoId));
  }

  const tx = builder.build();
  tx.sign(keypair);
  const response = await horizon.submitTransaction(tx);
  return response.hash;
}

/**
 * Real SEP-1 / SEP-10 / SEP-6 integration against TR Mock Anchor
 * (tr-mock-anchor.fly.dev): a live, SDF anchor-tests-verified TRY <-> USDC
 * sandbox anchor. The bank/KYC legs are simulated by the anchor itself; the
 * Stellar leg (USDC payment/claimable balance, on-chain detection) is real.
 *
 * Because SEP-10 requires a classic Ed25519 signature and the anchor can only
 * pay a classic G/M address, a per-browser "bridge" keypair (see
 * `bridge-account.ts`) stands in for the user's passkey smart wallet during
 * the anchor leg; USDC is swept into/out of the real wallet immediately after.
 *
 * Two modes:
 *  - "live" (default): talks to the real TR Mock Anchor.
 *  - "mock": falls back to our own `/api/mock-anchor/*` routes if the anchor
 *    is unreachable during a demo (e.g. no internet at the venue).
 */
export type AnchorMode = "live" | "mock";

export const ANCHOR_MODE: AnchorMode =
  (process.env.NEXT_PUBLIC_ANCHOR_MODE as AnchorMode | undefined) ?? "live";

export const ANCHOR_HOME_DOMAIN =
  process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN || "tr-mock-anchor.fly.dev";

/** Fallback TRY-per-USDC rate used only when ANCHOR_MODE=mock. */
export const MOCK_TRY_PER_USDC_RATE = 34.5;

/** Demo IBAN that passes the mock anchor's TR checksum check. Not a real account. */
export const DEMO_TRY_IBAN = "TR330006100519786457841326";

const ANCHOR_POLL_ATTEMPTS = 90;
const ANCHOR_POLL_INTERVAL_MS = 2000;

interface AnchorEndpoints {
  webAuthEndpoint: string;
  transferServer: string;
  kycServer?: string;
  usdcIssuer: string;
  usdcSacContractId: string;
}

let cachedEndpoints: AnchorEndpoints | null = null;

function readTomlValue(toml: string, key: string): string | undefined {
  return toml.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"))?.[1];
}

/** Discovers the anchor's SEP-10/6 endpoints and its USDC issuer from stellar.toml (SEP-1). */
async function getAnchorEndpoints(): Promise<AnchorEndpoints> {
  if (cachedEndpoints) return cachedEndpoints;

  const response = await fetch(
    `https://${ANCHOR_HOME_DOMAIN}/.well-known/stellar.toml`,
  );
  if (!response.ok) {
    throw new Error(
      `lirashield: anchor stellar.toml fetch failed (${response.status})`,
    );
  }
  const toml = await response.text();

  const webAuthEndpoint = readTomlValue(toml, "WEB_AUTH_ENDPOINT");
  const transferServer = readTomlValue(toml, "TRANSFER_SERVER");
  const kycServer = readTomlValue(toml, "KYC_SERVER");
  const issuerMatch = toml.match(
    /code\s*=\s*"USDC"[\s\S]*?issuer\s*=\s*"([^"]+)"/,
  );
  if (!webAuthEndpoint || !transferServer || !issuerMatch) {
    throw new Error(
      "lirashield: anchor stellar.toml is missing required SEP-1 fields",
    );
  }

  cachedEndpoints = {
    webAuthEndpoint,
    transferServer,
    kycServer,
    usdcIssuer: issuerMatch[1],
    usdcSacContractId: new Asset("USDC", issuerMatch[1]).contractId(
      STELLAR_NETWORK_PASSPHRASE,
    ),
  };
  return cachedEndpoints;
}

async function readAnchorErrorBody(response: Response): Promise<string> {
  const raw = await response.text();
  if (!raw) return `${response.status}`;
  try {
    const body = JSON.parse(raw) as {
      error?: string;
      message?: string;
      type?: string;
    };
    return body.error ?? body.message ?? body.type ?? raw;
  } catch {
    return raw;
  }
}

async function throwIfAnchorFailed(
  label: string,
  response: Response,
): Promise<void> {
  if (response.ok) return;
  const detail = await readAnchorErrorBody(response);
  throw new Error(`lirashield: ${label} — ${detail}`);
}

interface UsdcTransferLimits {
  minAmount: number;
  maxAmount: number;
}

async function getUsdcTransferLimits(): Promise<UsdcTransferLimits> {
  const { transferServer } = await getAnchorEndpoints();
  const response = await fetch(`${transferServer}/info`);
  await throwIfAnchorFailed("SEP-6 info request failed", response);
  const info = (await response.json()) as {
    "deposit-exchange"?: { USDC?: { min_amount?: number; max_amount?: number } };
    deposit?: { USDC?: { min_amount?: number; max_amount?: number } };
  };
  const deposit = info["deposit-exchange"]?.USDC ?? info.deposit?.USDC;
  return {
    minAmount: Number(deposit?.min_amount ?? 0.5),
    maxAmount: Number(deposit?.max_amount ?? 300),
  };
}

async function ensureSep12Customer(
  kycServer: string | undefined,
  token: string,
  iban?: string,
): Promise<void> {
  if (!kycServer) return;
  const response = await fetch(`${kycServer}/customer`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      first_name: "Lira",
      last_name: "Shield",
      email_address: "demo@lirashield.app",
      bank_account_number: iban ?? DEMO_TRY_IBAN,
    }),
  });
  if (!response.ok && response.status !== 202) {
    console.warn(
      "lirashield: SEP-12 customer update skipped",
      await readAnchorErrorBody(response),
    );
  }
}

/** SEP-10: fetches a challenge transaction, signs it with the bridge keypair, and trades it for a JWT. */
async function sep10Login(keypair: Keypair): Promise<string> {
  const { webAuthEndpoint } = await getAnchorEndpoints();

  const challengeResponse = await fetch(
    `${webAuthEndpoint}?account=${keypair.publicKey()}`,
  );
  if (!challengeResponse.ok) {
    throw new Error("lirashield: SEP-10 challenge request failed");
  }
  const { transaction } = await challengeResponse.json();

  const challengeTx = TransactionBuilder.fromXDR(
    transaction,
    STELLAR_NETWORK_PASSPHRASE,
  );
  if (!("sign" in challengeTx)) {
    throw new Error("lirashield: unexpected SEP-10 challenge transaction type");
  }
  challengeTx.sign(keypair);

  const tokenResponse = await fetch(webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: challengeTx.toXDR() }),
  });
  if (!tokenResponse.ok) {
    throw new Error("lirashield: SEP-10 verification failed");
  }
  const { token } = await tokenResponse.json();
  return token as string;
}

/** Funds the bridge account (friendbot) and opens a USDC trustline the first time it's used. */
async function ensureBridgeAccountReady(
  keypair: Keypair,
  usdcIssuer: string,
): Promise<void> {
  const horizon = new Horizon.Server(HORIZON_URL);

  let account;
  try {
    account = await horizon.loadAccount(keypair.publicKey());
  } catch {
    const fundResponse = await fetch(
      `https://friendbot.stellar.org?addr=${keypair.publicKey()}`,
    );
    if (!fundResponse.ok) {
      throw new Error(
        "lirashield: could not fund the bridge account via friendbot",
      );
    }
    account = await horizon.loadAccount(keypair.publicKey());
  }

  const issuers = [...new Set([usdcIssuer, BLEND_USDC_ISSUER])];
  for (const issuer of issuers) {
    const hasTrustline = account.balances.some(
      (balance) =>
        balance.asset_type !== "native" &&
        "asset_code" in balance &&
        balance.asset_code === "USDC" &&
        balance.asset_issuer === issuer,
    );
    if (hasTrustline) continue;

    const trustTx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(Operation.changeTrust({ asset: new Asset("USDC", issuer) }))
      .setTimeout(60)
      .build();
    trustTx.sign(keypair);
    try {
      await horizon.submitTransaction(trustTx);
    } catch (error) {
      let confirmed = false;
      for (let attempt = 0; attempt < 15; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        account = await horizon.loadAccount(keypair.publicKey());
        confirmed = account.balances.some(
          (balance) =>
            balance.asset_type !== "native" &&
            "asset_code" in balance &&
            balance.asset_code === "USDC" &&
            balance.asset_issuer === issuer,
        );
        if (confirmed) break;
      }
      if (!confirmed) throw error;
    }
    account = await horizon.loadAccount(keypair.publicKey());
  }
}

export interface Sep38Quote {
  sellAmount: string;
  buyAmount: string;
  price: string;
  expiresAt: string;
}

/** Indicative TRY <-> USDC rate. Uses the anchor's live SEP-38 price in "live" mode. */
export async function getExchangeQuote(
  sellAsset: "TRY" | "USDC",
  amount: string,
): Promise<Sep38Quote> {
  const sellAmount = formatSep6Amount(amount);
  if (ANCHOR_MODE === "mock") {
    const rate =
      sellAsset === "TRY" ? 1 / MOCK_TRY_PER_USDC_RATE : MOCK_TRY_PER_USDC_RATE;
    return {
      sellAmount,
      buyAmount: formatSep6Amount(Number(sellAmount) * rate),
      price: rate.toFixed(6),
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  const buyAsset = sellAsset === "TRY" ? "USDC" : "TRY";
  const sellAssetId =
    sellAsset === "TRY"
      ? "iso4217:TRY"
      : `stellar:USDC:${(await getAnchorEndpoints()).usdcIssuer}`;
  const buyAssetId =
    buyAsset === "TRY"
      ? "iso4217:TRY"
      : `stellar:USDC:${(await getAnchorEndpoints()).usdcIssuer}`;
  const { transferServer } = await getAnchorEndpoints();
  const quoteServer = transferServer.replace(/\/sep6$/, "/sep38");
  const priceUrl = new URL(`${quoteServer}/price`);
  priceUrl.searchParams.set("sell_asset", sellAssetId);
  priceUrl.searchParams.set("buy_asset", buyAssetId);
  priceUrl.searchParams.set("sell_amount", sellAmount);
  priceUrl.searchParams.set("context", "sep6");

  let response: Response | null = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    response = await fetch(priceUrl.toString(), { cache: "no-store" });
    if (response.ok) break;
    if (attempt < 2) {
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  if (!response?.ok) {
    console.warn(
      `lirashield: SEP-38 quote unavailable (${response?.status ?? "network"}); using indicative fallback`,
    );
    const rate =
      sellAsset === "TRY" ? 1 / MOCK_TRY_PER_USDC_RATE : MOCK_TRY_PER_USDC_RATE;
    return {
      sellAmount,
      buyAmount: formatSep6Amount(Number(sellAmount) * rate),
      price: rate.toFixed(6),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
  }
  const data = await response.json();
  return {
    sellAmount: formatSep6Amount(data.sell_amount ?? sellAmount),
    buyAmount: formatSep6Amount(data.buy_amount),
    price: data.price,
    expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

async function classicUsdcBalance(
  publicKey: string,
  usdcIssuer: string,
): Promise<bigint> {
  const horizon = new Horizon.Server(HORIZON_URL);
  try {
    const account = await horizon.loadAccount(publicKey);
    const line = account.balances.find(
      (balance) =>
        balance.asset_type !== "native" &&
        "asset_code" in balance &&
        balance.asset_code === "USDC" &&
        balance.asset_issuer === usdcIssuer,
    );
    if (!line || !("balance" in line)) return BigInt(0);
    return BigInt(Math.round(Number(line.balance) * 10 ** 7));
  } catch {
    return BigInt(0);
  }
}

interface Sep6Transaction {
  status?: string;
  message?: string;
  amount_out?: string;
  stellar_transaction_id?: string;
}

interface CompletedSep6Transaction {
  status: string;
  amount_out: string;
  message?: string;
  stellar_transaction_id?: string;
}

function requireCompletedSep6(
  transaction: Sep6Transaction,
): CompletedSep6Transaction {
  if (!transaction.amount_out) {
    throw new Error("lirashield: anchor transaction is missing amount_out");
  }
  return {
    status: transaction.status ?? "completed",
    amount_out: transaction.amount_out,
    message: transaction.message,
    stellar_transaction_id: transaction.stellar_transaction_id,
  };
}

interface PollSep6Options {
  publicKey?: string;
  usdcIssuer?: string;
  startingUsdcScaled?: bigint;
}

async function pollSep6Transaction(
  transferServer: string,
  token: string,
  id: string,
  options: PollSep6Options = {},
): Promise<CompletedSep6Transaction> {
  let lastStatus = "unknown";
  let lastMessage = "";
  let lastTransaction: Sep6Transaction | null = null;

  for (let attempt = 0; attempt < ANCHOR_POLL_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(`${transferServer}/transaction?id=${id}`, {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (response.ok) {
        const body = (await response.json()) as { transaction?: Sep6Transaction };
        const transaction = body.transaction;
        if (transaction) {
          lastTransaction = transaction;
          lastStatus = transaction.status ?? lastStatus;
          lastMessage = transaction.message ?? lastMessage;
          if (transaction.status === "completed") {
            return requireCompletedSep6(transaction);
          }
          if (transaction.status === "error") {
            throw new Error(
              `lirashield: anchor transaction failed (${transaction.message ?? "unknown error"})`,
            );
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("lirashield:")) {
        throw err;
      }
    }

    if (
      options.publicKey &&
      options.usdcIssuer &&
      options.startingUsdcScaled !== undefined
    ) {
      const current = await classicUsdcBalance(
        options.publicKey,
        options.usdcIssuer,
      );
      if (current > options.startingUsdcScaled) {
        const credited = current - options.startingUsdcScaled;
        return {
          status: "completed",
          amount_out:
            lastTransaction?.amount_out ?? scaledUsdcToAmount(credited),
          stellar_transaction_id: lastTransaction?.stellar_transaction_id,
          message: lastTransaction?.message,
        } satisfies CompletedSep6Transaction;
      }
    }

    await new Promise((resolve) =>
      setTimeout(resolve, ANCHOR_POLL_INTERVAL_MS),
    );
  }

  const detail = lastMessage ? `${lastStatus} — ${lastMessage}` : lastStatus;
  throw new Error(
    `lirashield: timed out waiting for the anchor transaction (${detail})`,
  );
}

export interface FastDepositResult {
  usdcAmountScaled: bigint;
  txHash?: string;
}

async function getReadyBridgeKeypair(): Promise<Keypair> {
  const keypair = getOrCreateBridgeKeypair();
  const { usdcIssuer } = await getAnchorEndpoints();
  await ensureBridgeAccountReady(keypair, usdcIssuer);
  return keypair;
}

export async function getFastBridgeAddress(): Promise<string> {
  return (await getReadyBridgeKeypair()).publicKey();
}

export async function signAndSendBridgeCall<T>(assembled: {
  sign: (opts: { signTransaction: SignTransaction }) => Promise<void>;
  send: () => Promise<{ result: T }>;
}): Promise<T> {
  const keypair = await getReadyBridgeKeypair();
  await assembled.sign({ signTransaction: classicSignTransaction(keypair) });
  const sent = await assembled.send();
  return sent.result;
}

/** Same as {@link signAndSendBridgeCall} but also returns the submitted transaction hash, used for the on-chain proof panel. */
export async function signAndSendBridgeCallWithHash<T>(assembled: {
  sign: (opts: { signTransaction: SignTransaction }) => Promise<void>;
  send: () => Promise<{
    result: T;
    sendTransactionResponse?: { hash: string };
  }>;
}): Promise<{ result: T; txHash?: string }> {
  const keypair = await getReadyBridgeKeypair();
  await assembled.sign({ signTransaction: classicSignTransaction(keypair) });
  const sent = await assembled.send();
  return { result: sent.result, txHash: sent.sendTransactionResponse?.hash };
}

export async function quoteBlendUsdcToTry(
  blendUsdcAmountScaled: bigint,
): Promise<number> {
  if (blendUsdcAmountScaled <= BigInt(0)) return 0;
  if (ANCHOR_MODE === "mock") {
    return (Number(blendUsdcAmountScaled) / 10 ** 7) * MOCK_TRY_PER_USDC_RATE;
  }

  const { usdcSacContractId } = await getAnchorEndpoints();
  const path = [USDC_TOKEN_CONTRACT_ID, usdcSacContractId];
  const amounts = await getRouterAmountsOut(
    SOROSWAP_ROUTER_CONTRACT_ID,
    path,
    blendUsdcAmountScaled,
  );
  const anchorUsdcScaled = amounts[amounts.length - 1];
  if (!anchorUsdcScaled || anchorUsdcScaled <= BigInt(0)) return 0;

  const quote = await getExchangeQuote(
    "USDC",
    scaledUsdcToAmount(anchorUsdcScaled),
  );
  return Number(quote.buyAmount);
}

export async function estimateBlendUsdcForTry(
  tryAmount: number,
): Promise<bigint> {
  if (!Number.isFinite(tryAmount) || tryAmount <= 0) return BigInt(0);
  const oneBlendTryValue = await quoteBlendUsdcToTry(BigInt(10_000_000));
  if (!Number.isFinite(oneBlendTryValue) || oneBlendTryValue <= 0) {
    throw new Error("lirashield: unable to quote withdrawal rate");
  }

  return BigInt(Math.ceil((tryAmount / oneBlendTryValue) * 10 ** 7));
}

/**
 * Runs a full "Deposit and protect" on-ramp: SEP-10 login, SEP-6 deposit, "plays
 * the bank" (this sandbox lets us trigger the TRY arrival ourselves), waits
 * for the anchor to pay real testnet USDC to the bridge account, then sweeps
 * that USDC into the user's actual wallet address. Returns the USDC amount
 * received, scaled to 7 decimals, ready for `shield_usdc`.
 */
export async function runFastDeposit(
  userAddress: string,
  tryAmount: string,
): Promise<FastDepositResult> {
  const tryAmountSep6 = formatSep6Amount(tryAmount);

  if (ANCHOR_MODE === "mock") {
    const response = await fetch("/api/mock-anchor/deposit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userAddress, tryAmount: tryAmountSep6 }),
    });
    if (!response.ok) {
      throw new Error("lirashield: mock FAST deposit simulation failed");
    }
    const quote = await getExchangeQuote("TRY", tryAmountSep6);
    return {
      usdcAmountScaled: BigInt(Math.round(Number(quote.buyAmount) * 10 ** 7)),
    };
  }

  const keypair = getOrCreateBridgeKeypair();
  const { transferServer, kycServer, usdcIssuer, usdcSacContractId } =
    await getAnchorEndpoints();
  await ensureBridgeAccountReady(keypair, usdcIssuer);
  const token = await sep10Login(keypair);
  await ensureSep12Customer(kycServer, token);

  const quote = await getExchangeQuote("TRY", tryAmountSep6);
  const limits = await getUsdcTransferLimits();
  const quotedUsdc = Number(quote.buyAmount);
  if (!Number.isFinite(quotedUsdc) || quotedUsdc < limits.minAmount) {
    throw new Error(
      `lirashield: deposit is below the demo rail minimum (${limits.minAmount} USDC)`,
    );
  }
  if (quotedUsdc > limits.maxAmount) {
    throw new Error(
      `lirashield: this demo rail accepts up to ${limits.maxAmount} USDC per deposit. Try a smaller TRY amount.`,
    );
  }

  // Amount on /deposit is USDC. Sending TRY (e.g. 10000) exceeds the 300 USDC cap.
  // Prefer /deposit-exchange so the bank leg stays in TRY; fall back to /deposit
  // with the quoted USDC amount if the exchange endpoint rejects the request.
  // TR Mock Anchor rejects SEP-38 `stellar:USDC:<issuer>` here and expects `USDC`.
  const depositExchangeAttempts = ["USDC", `stellar:USDC:${usdcIssuer}`];
  let depositResponse: Response | null = null;
  for (const destinationAsset of depositExchangeAttempts) {
    const depositExchangeUrl = new URL(`${transferServer}/deposit-exchange`);
    depositExchangeUrl.searchParams.set("destination_asset", destinationAsset);
    depositExchangeUrl.searchParams.set("source_asset", "iso4217:TRY");
    depositExchangeUrl.searchParams.set("amount", tryAmountSep6);
    depositExchangeUrl.searchParams.set("account", keypair.publicKey());
    depositExchangeUrl.searchParams.set("type", "bank_account");
    depositExchangeUrl.searchParams.set("funding_method", "bank_account");
    depositResponse = await fetch(depositExchangeUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (depositResponse.ok) break;
  }
  if (!depositResponse?.ok) {
    const depositUrl = new URL(`${transferServer}/deposit`);
    depositUrl.searchParams.set("asset_code", "USDC");
    depositUrl.searchParams.set("account", keypair.publicKey());
    depositUrl.searchParams.set("amount", quote.buyAmount);
    depositUrl.searchParams.set("type", "bank_account");
    depositUrl.searchParams.set("funding_method", "bank_account");
    depositResponse = await fetch(depositUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  if (!depositResponse) {
    throw new Error("lirashield: SEP-6 deposit request failed");
  }
  await throwIfAnchorFailed("SEP-6 deposit request failed", depositResponse);
  const { id } = await depositResponse.json();

  const startingUsdcScaled = await classicUsdcBalance(
    keypair.publicKey(),
    usdcIssuer,
  );

  // Sandbox only: a real anchor is triggered by the actual bank transfer landing.
  const simulateResponse = await fetch(
    `${transferServer}/tx/${id}/simulate-bank-transfer`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ amount: tryAmountSep6 }),
    },
  );
  await throwIfAnchorFailed("bank transfer simulation failed", simulateResponse);

  const transaction = await pollSep6Transaction(transferServer, token, id, {
    publicKey: keypair.publicKey(),
    usdcIssuer,
    startingUsdcScaled,
  });
  const anchorUsdcAmountScaled = BigInt(
    Math.round(Number(transaction.amount_out) * 10 ** 7),
  );

  // The anchor pays out its OWN USDC, but the vault deposits into DeFindex's
  // The router deployment pulls the input asset from its `to` address.
  // Swap from the classic bridge account, then move the output to the wallet.
  const bridgeSigner = classicSignTransaction(keypair);
  const expirationLedger = await currentExpirationLedger();
  const approveTx = await buildSacApproveTx(
    usdcSacContractId,
    keypair.publicKey(),
    SOROSWAP_ROUTER_CONTRACT_ID,
    anchorUsdcAmountScaled,
    expirationLedger,
    keypair.publicKey(),
  );
  await stage("bridge approve", async () => {
    await approveTx.sign({ signTransaction: bridgeSigner });
    await approveTx.send();
  });

  const depositPath = [usdcSacContractId, USDC_TOKEN_CONTRACT_ID];
  const quotedDepositAmounts = await stage("swap quote", () =>
    getRouterAmountsOut(
      SOROSWAP_ROUTER_CONTRACT_ID,
      depositPath,
      anchorUsdcAmountScaled,
    ),
  );
  const quotedDepositOutput =
    quotedDepositAmounts[quotedDepositAmounts.length - 1];
  if (!quotedDepositOutput || quotedDepositOutput <= BigInt(0)) {
    throw new Error("lirashield: Soroswap returned no deposit quote");
  }
  const usdcAmountScaled = await stage("bridge swap", async () => {
    const swapTx = await buildRouterSwapTx(
      SOROSWAP_ROUTER_CONTRACT_ID,
      depositPath,
      anchorUsdcAmountScaled,
      minimumSwapOutput(quotedDepositOutput),
      keypair.publicKey(),
      currentDeadline(),
      keypair.publicKey(),
    );
    await swapTx.sign({ signTransaction: bridgeSigner });
    const swapSent = await swapTx.send();
    // swap_exact_tokens_for_tokens returns Result<Vec<i128>>; unwrap to the amounts.
    const swapAmounts = unwrapVec(swapSent.result);
    const output = swapAmounts[swapAmounts.length - 1];
    if (!output || output <= BigInt(0)) {
      throw new Error("Soroswap swap returned no output amount");
    }
    return output;
  });

  if (userAddress !== keypair.publicKey()) {
    const transferTx = await buildSacTransferTx(
      USDC_TOKEN_CONTRACT_ID,
      keypair.publicKey(),
      userAddress,
      usdcAmountScaled,
      keypair.publicKey(),
    );
    await stage("bridge transfer", async () => {
      await transferTx.sign({ signTransaction: bridgeSigner });
      await transferTx.send();
    });
  }

  return { usdcAmountScaled };
}

export async function runFastDepositAndShield(
  tryAmount: string,
): Promise<FastDepositResult> {
  const keypair = await getReadyBridgeKeypair();
  const { usdcAmountScaled } = await runFastDeposit(
    keypair.publicKey(),
    tryAmount,
  );
  const shieldTx = await buildShieldUsdcTx(
    keypair.publicKey(),
    usdcAmountScaled,
    keypair.publicKey(),
  );
  const { txHash } = await signAndSendBridgeCallWithHash(shieldTx);
  return { usdcAmountScaled, txHash };
}

export interface FastWithdrawResult {
  tryAmount: string;
  txHash?: string;
}

export async function getFastWithdrawBridgeAddress(): Promise<string> {
  return getFastBridgeAddress();
}

/**
 * Runs a full "Withdraw to IBAN" off-ramp: opens a SEP-6 withdraw to get the
 * anchor's treasury address + memo, moves the user's already-unshielded
 * BlendUSDC to the bridge, swaps it into anchor USDC from that classic account,
 * then sends a Stellar payment tagged with the SEP-6 memo.
 */
export async function runFastWithdraw(
  userAddress: string,
  usdcAmountScaled: bigint,
  iban?: string,
): Promise<FastWithdrawResult> {
  if (ANCHOR_MODE === "mock") {
    const usdcAmount = (Number(usdcAmountScaled) / 10 ** 7).toString();
    const quote = await getExchangeQuote("USDC", usdcAmount);
    const response = await fetch("/api/mock-anchor/withdraw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userAddress,
        tryAmount: quote.buyAmount,
        iban: iban ?? DEMO_TRY_IBAN,
      }),
    });
    if (!response.ok) {
      throw new Error("lirashield: mock FAST withdraw simulation failed");
    }
    return { tryAmount: quote.buyAmount };
  }

  const keypair = getOrCreateBridgeKeypair();
  const { transferServer, kycServer, usdcIssuer, usdcSacContractId } =
    await getAnchorEndpoints();
  await ensureBridgeAccountReady(keypair, usdcIssuer);
  const token = await sep10Login(keypair);

  await ensureSep12Customer(kycServer, token, iban);

  const withdrawPath = [USDC_TOKEN_CONTRACT_ID, usdcSacContractId];
  const quotedWithdrawAmounts = await getRouterAmountsOut(
    SOROSWAP_ROUTER_CONTRACT_ID,
    withdrawPath,
    usdcAmountScaled,
  );
  const quotedWithdrawOutput =
    quotedWithdrawAmounts[quotedWithdrawAmounts.length - 1];
  if (!quotedWithdrawOutput || quotedWithdrawOutput <= BigInt(0)) {
    throw new Error("lirashield: Soroswap returned no withdrawal quote");
  }

  // Classic Stellar payments use up to 7 decimals; SEP-6 withdraw amount max 2.
  const usdcAmountClassic = scaledUsdcToAmount(quotedWithdrawOutput);
  const usdcAmountSep6 = formatSep6Amount(usdcAmountClassic);
  const withdrawUrl = new URL(`${transferServer}/withdraw`);
  withdrawUrl.searchParams.set("asset_code", "USDC");
  withdrawUrl.searchParams.set("type", "bank_account");
  withdrawUrl.searchParams.set("funding_method", "bank_account");
  withdrawUrl.searchParams.set("amount", usdcAmountSep6);

  const withdrawResponse = await fetch(withdrawUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await throwIfAnchorFailed("SEP-6 withdraw request failed", withdrawResponse);
  const {
    id,
    account_id: treasuryAddress,
    memo,
  } = await withdrawResponse.json();

  // The vault paid out BlendUSDC (unshield_usdc_to's config.usdc_token) to the
  // classic bridge account, so approve + swap + memo payment can happen without
  // extra passkey confirmations.
  const bridgeSigner = classicSignTransaction(keypair);
  const expirationLedger = await currentExpirationLedger();
  const approveTx = await buildSacApproveTx(
    USDC_TOKEN_CONTRACT_ID,
    keypair.publicKey(),
    SOROSWAP_ROUTER_CONTRACT_ID,
    usdcAmountScaled,
    expirationLedger,
    keypair.publicKey(),
  );
  await stage("bridge withdraw approve", async () => {
    await approveTx.sign({ signTransaction: bridgeSigner });
    await approveTx.send();
  });

  const swapAmounts = await stage("bridge withdraw swap", async () => {
    const swapTx = await buildRouterSwapTx(
      SOROSWAP_ROUTER_CONTRACT_ID,
      withdrawPath,
      usdcAmountScaled,
      minimumSwapOutput(quotedWithdrawOutput),
      keypair.publicKey(),
      currentDeadline(),
      keypair.publicKey(),
    );
    await swapTx.sign({ signTransaction: bridgeSigner });
    const swapSent = await swapTx.send();
    return unwrapVec(swapSent.result);
  });
  const anchorUsdcReceived = swapAmounts[swapAmounts.length - 1];
  if (!anchorUsdcReceived || anchorUsdcReceived <= BigInt(0)) {
    throw new Error("lirashield: Soroswap returned no withdrawal output");
  }

  const txHash = await submitClassicUsdcPaymentWithMemo(
    keypair,
    treasuryAddress,
    usdcIssuer,
    anchorUsdcReceived,
    memo,
  );

  const transaction = await pollSep6Transaction(transferServer, token, id);
  return { tryAmount: transaction.amount_out, txHash };
}
