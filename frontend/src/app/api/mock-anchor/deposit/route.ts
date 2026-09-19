import { NextRequest, NextResponse } from "next/server";
import {
  Address,
  Contract,
  Keypair,
  nativeToScVal,
  TransactionBuilder,
  BASE_FEE,
} from "@stellar/stellar-sdk";
import {
  getSorobanServer,
  STELLAR_NETWORK_PASSPHRASE,
  numberToScaledAmount,
} from "@/lib/stellar";

const configuredMaxMockTryAmount = Number(
  process.env.MOCK_ANCHOR_MAX_TRY_AMOUNT,
);
const MAX_MOCK_TRY_AMOUNT =
  Number.isFinite(configuredMaxMockTryAmount) && configuredMaxMockTryAmount > 0
    ? configuredMaxMockTryAmount
    : 1_000_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const requestLog = new Map<string, number[]>();

/**
 * Simulates the bank/FAST leg of a deposit by transferring configured mock
 * USDC straight to the user's Stellar address. The issuer secret never leaves
 * this server-only route.
 */
export async function POST(request: NextRequest) {
  const { userAddress, tryAmount } = await request.json();

  const clientKey =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const recent = (requestLog.get(clientKey) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    return NextResponse.json(
      { error: "too many mock deposit requests" },
      { status: 429 },
    );
  }
  recent.push(now);
  requestLog.set(clientKey, recent);

  if (typeof userAddress !== "string" || typeof tryAmount !== "string") {
    return NextResponse.json(
      { error: "userAddress and tryAmount are required" },
      { status: 400 },
    );
  }

  const amount = Number(tryAmount);
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_MOCK_TRY_AMOUNT) {
    return NextResponse.json(
      { error: "tryAmount is outside the permitted range" },
      { status: 400 },
    );
  }

  const issuerSecret = process.env.MOCK_USDC_ISSUER_SECRET;
  const usdcTokenContractId = process.env.MOCK_USDC_TOKEN_CONTRACT_ID;
  if (!issuerSecret || !usdcTokenContractId) {
    return NextResponse.json(
      { error: "mock anchor is not configured with a USDC issuer" },
      { status: 503 },
    );
  }

  try {
    const issuer = Keypair.fromSecret(issuerSecret);
    const server = getSorobanServer();
    const issuerAccount = await server.getAccount(issuer.publicKey());
    const scaledAmount = numberToScaledAmount(amount / 34.5);

    const transaction = new TransactionBuilder(issuerAccount, {
      fee: BASE_FEE,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    })
      .addOperation(
        new Contract(usdcTokenContractId).call(
          "transfer",
          new Address(issuer.publicKey()).toScVal(),
          new Address(userAddress).toScVal(),
          nativeToScVal(scaledAmount, { type: "i128" }),
        ),
      )
      .setTimeout(60)
      .build();

    const prepared = await server.prepareTransaction(transaction);
    prepared.sign(issuer);
    const sendResult = await server.sendTransaction(prepared);

    if (sendResult.status === "ERROR") {
      throw new Error(sendResult.errorResult?.toString() ?? "unknown error");
    }

    return NextResponse.json({
      transactionId: sendResult.hash,
      status: "completed",
      usdcAmount: scaledAmount.toString(),
    });
  } catch (error) {
    console.error("mock-anchor deposit failed", error);
    return NextResponse.json(
      { error: "lirashield: mock FAST deposit failed" },
      { status: 502 },
    );
  }
}
