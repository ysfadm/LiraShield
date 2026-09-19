import { NextRequest, NextResponse } from "next/server";
import { PasskeyServer } from "passkey-kit/server";
import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Client as ContractClient } from "@stellar/stellar-sdk/contract";
import {
  LIRASHIELD_VAULT_CONTRACT_ID,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
} from "@/lib/stellar";

function positiveEnvNumber(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const MAX_BODY_LENGTH = positiveEnvNumber("RELAYER_MAX_BODY_BYTES", 200_000);
const RATE_LIMIT_WINDOW_MS = positiveEnvNumber(
  "RELAYER_RATE_LIMIT_WINDOW_MS",
  60_000,
);
const RATE_LIMIT_MAX_REQUESTS = positiveEnvNumber(
  "RELAYER_RATE_LIMIT_MAX_REQUESTS",
  30,
);
const MAX_TRACKED_CLIENTS = 10_000;
const requestLog = new Map<string, number[]>();
const WALLET_WASM_HASH = (
  process.env.NEXT_PUBLIC_WALLET_WASM_HASH ??
  "97ce047884106b1c6c3bb40b8973cc48db1c4dad95c9e20462bf2c701daa764e"
).toLowerCase();

function enforceRequestLimit(request: NextRequest) {
  const key =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const now = Date.now();
  const recent = (requestLog.get(key) ?? []).filter(
    (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) return false;
  recent.push(now);
  requestLog.set(key, recent);
  for (const [storedKey, timestamps] of requestLog) {
    const active = timestamps.filter(
      (timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS,
    );
    if (active.length === 0) requestLog.delete(storedKey);
    else requestLog.set(storedKey, active);
  }
  if (requestLog.size > MAX_TRACKED_CLIENTS) {
    requestLog.delete(requestLog.keys().next().value as string);
  }
  return true;
}

function isAllowedContract(contractId: string) {
  const configured =
    process.env.RELAYER_ALLOWED_CONTRACT_IDS?.split(",")
      .map((value) => value.trim())
      .filter(Boolean) ?? [];
  return [LIRASHIELD_VAULT_CONTRACT_ID, ...configured].includes(contractId);
}

function validateWalletCreationXdr(signedXdr: string) {
  let transaction;
  try {
    transaction = TransactionBuilder.fromXDR(
      signedXdr,
      STELLAR_NETWORK_PASSPHRASE,
    );
  } catch {
    throw new Error("lirashield: invalid wallet creation transaction");
  }

  if (!("operations" in transaction)) {
    throw new Error("lirashield: fee-bump transactions are not allowed");
  }
  const operations = transaction.operations;
  if (operations.length !== 1 || operations[0].type !== "invokeHostFunction") {
    throw new Error(
      "lirashield: wallet creation must contain one Soroban deploy operation",
    );
  }

  const operation = operations[0] as unknown as {
    func?: {
      switch?: () => { name?: string };
      createContractV2?: () => {
        executable?: () => {
          switch?: () => { name?: string };
          wasmHash?: () => Buffer;
        };
      };
    };
  };
  const hostFunction = operation.func;
  if (hostFunction?.switch?.()?.name !== "hostFunctionTypeCreateContractV2") {
    throw new Error("lirashield: wallet creation must use createContractV2");
  }
  const executable = hostFunction.createContractV2?.()?.executable?.();
  if (executable?.switch?.()?.name !== "contractExecutableWasm") {
    throw new Error("lirashield: wallet creation must deploy WASM code");
  }
  const wasmHash = executable.wasmHash?.()?.toString("hex").toLowerCase();
  if (wasmHash !== WALLET_WASM_HASH) {
    throw new Error("lirashield: wallet WASM hash is not approved");
  }

  const expectedSource = process.env.PASSKEY_DEPLOYER_PUBLIC_KEY;
  if (expectedSource) {
    const source = (transaction as unknown as { source: string }).source;
    if (source !== expectedSource) {
      throw new Error("lirashield: wallet deployer is not approved");
    }
    Keypair.fromPublicKey(source);
  }
}

function requireRelayerServer() {
  const baseUrl = process.env.RELAYER_BASE_URL;
  const apiKey = process.env.RELAYER_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "lirashield: relayer is not configured (RELAYER_BASE_URL / RELAYER_API_KEY)",
    );
  }
  return new PasskeyServer({
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
    rpcUrl: SOROBAN_RPC_URL,
    relayer: { baseUrl, apiKey },
  });
}

/**
 * Server-only relay for passkey-signed transactions: submits through the
 * OpenZeppelin Relayer Channels service so the browser (and its passkey
 * wallet, which holds no XLM) never needs to touch a fee-paying secret.
 */
export async function POST(request: NextRequest) {
  try {
    if (!enforceRequestLimit(request)) {
      return NextResponse.json(
        { error: "too many relay requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(RATE_LIMIT_WINDOW_MS / 1000)),
          },
        },
      );
    }

    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: "relay request is too large" },
        { status: 413 },
      );
    }
    let body: {
      xdr?: unknown;
      assembledJson?: unknown;
      contractId?: unknown;
      purpose?: unknown;
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
    }

    const server = requireRelayerServer();

    if (typeof body.xdr === "string") {
      if (
        process.env.ALLOW_WALLET_CREATION_RELAY !== "true" ||
        body.purpose !== "wallet-create"
      ) {
        return NextResponse.json(
          { error: "xdr relay is limited to wallet creation" },
          { status: 403 },
        );
      }
      validateWalletCreationXdr(body.xdr);
      const result = await server.send(body.xdr);
      if (!result.success) {
        return NextResponse.json(
          { error: `[${result.error.code}] ${result.error.message}` },
          { status: 502 },
        );
      }
      return NextResponse.json({ hash: result.hash });
    }

    if (typeof body.assembledJson === "string") {
      const contractId =
        typeof body.contractId === "string"
          ? body.contractId
          : LIRASHIELD_VAULT_CONTRACT_ID;
      if (!contractId || !isAllowedContract(contractId)) {
        return NextResponse.json(
          { error: "contract is not allowed for relay" },
          { status: 403 },
        );
      }
      const client = await ContractClient.from({
        contractId,
        networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
        rpcUrl: SOROBAN_RPC_URL,
      });
      const assembled = client.txFromJSON(body.assembledJson);
      const result = await server.send(assembled);
      if (!result.success) {
        return NextResponse.json(
          { error: `[${result.error.code}] ${result.error.message}` },
          { status: 502 },
        );
      }
      return NextResponse.json({ hash: result.hash });
    }

    return NextResponse.json(
      { error: "xdr or assembledJson is required" },
      { status: 400 },
    );
  } catch (error) {
    console.error("passkey relay failed", error);
    const message =
      error instanceof Error ? error.message : "lirashield: relay failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
