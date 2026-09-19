import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { deriveContractAddress, PasskeyClient, PasskeyKit } from "passkey-kit";
import { IndexedDBStorage } from "passkey-kit/storage";
import {
  getSorobanServer,
  SOROBAN_RPC_URL,
  STELLAR_NETWORK_PASSPHRASE,
} from "./stellar";

/**
 * Canonical LiraShield smart-wallet WASM hash. Override via
 * NEXT_PUBLIC_WALLET_WASM_HASH once the hackathon's deployed hash is known.
 */
const WALLET_WASM_HASH =
  process.env.NEXT_PUBLIC_WALLET_WASM_HASH ??
  "97ce047884106b1c6c3bb40b8973cc48db1c4dad95c9e20462bf2c701daa764e";

const PASSKEY_KEY_ID_STORAGE_KEY = "lirashield.passkeyKeyId";

let kit: PasskeyKit | null = null;
let lastRelayedTxHash: string | null = null;

/** Hash of the most recently confirmed relayed transaction, for surfacing an explorer link. */
export function getLastRelayedTxHash(): string | null {
  return lastRelayedTxHash;
}

/** Lazily-created singleton so the connected wallet state survives across component renders. */
export function getPasskeyKit(): PasskeyKit {
  if (typeof window === "undefined") {
    throw new Error("lirashield: passkey kit is only available in the browser");
  }
  if (!kit) {
    kit = new PasskeyKit({
      rpcUrl: SOROBAN_RPC_URL,
      networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
      walletWasmHash: WALLET_WASM_HASH,
      storage: new IndexedDBStorage(),
    });
  }
  return kit;
}

/** Submits a fully-built XDR (e.g. the wallet deploy transaction) through our server relay. */
export async function relaySignedXdr(
  signedXdr: string,
): Promise<{ hash: string }> {
  const response = await fetch("/api/passkey/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xdr: signedXdr, purpose: "wallet-create" }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "lirashield: relay submission failed");
  }
  return data;
}

/**
 * Reconnects the passkey wallet if the in-memory kit lost its connection
 * (e.g. after a page reload, where login state is only in localStorage).
 * Safe to call before every signature; it no-ops once connected for the session.
 */
export async function ensureWalletConnected(): Promise<void> {
  const walletKit = getPasskeyKit();
  if (walletKit.wallet && walletKit.keyId) return;

  const storedKeyId = window.localStorage.getItem(PASSKEY_KEY_ID_STORAGE_KEY);
  const storedAddress = window.localStorage.getItem("lirashield.walletAddress");
  if (storedKeyId && storedAddress) {
    attachWallet(storedKeyId, storedAddress);
    return;
  }

  await connectWalletSafely();
}

/** Binds the kit to a known wallet without the (buggy) ownership re-verification. */
function attachWallet(keyIdBase64: string, contractId: string): void {
  const walletKit = getPasskeyKit();
  // passkey-kit 0.19.1's connectWallet() crashes on signers without an
  // expiration (null > bigint). Attach directly; possession is still proven by
  // the WebAuthn prompt at signing time.
  walletKit.wallet = new PasskeyClient({
    contractId,
    rpcUrl: SOROBAN_RPC_URL,
    networkPassphrase: STELLAR_NETWORK_PASSPHRASE,
  });
  walletKit.keyId = keyIdBase64;
  rememberPasskeySession(keyIdBase64, contractId);
}

function toBase64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Connects an existing wallet by letting the user pick a passkey via WebAuthn,
 * then resolving its wallet address from the kit's local records or the
 * deterministic derivation. Bypasses passkey-kit's connectWallet() entirely.
 */
export async function connectWalletSafely(): Promise<string> {
  const walletKit = getPasskeyKit();
  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);
  const credential = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: window.location.hostname,
      userVerification: "preferred",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error("lirashield: passkey authentication was cancelled");
  }

  const keyIdBase64 = toBase64Url(credential.rawId);
  const stored = await new IndexedDBStorage().get(keyIdBase64);
  const storedAddress = window.localStorage.getItem("lirashield.walletAddress");
  const contractId =
    stored?.contractId ??
    storedAddress ??
    deriveContractAddress(
      Buffer.from(new Uint8Array(credential.rawId)),
      walletKit.deployerPublicKey,
      STELLAR_NETWORK_PASSPHRASE,
    );

  attachWallet(keyIdBase64, contractId);
  return contractId;
}

/** Persists what is needed to re-attach the wallet after a reload. */
export function rememberPasskeySession(
  keyIdBase64: string,
  contractId: string,
): void {
  window.localStorage.setItem(PASSKEY_KEY_ID_STORAGE_KEY, keyIdBase64);
  window.localStorage.setItem("lirashield.walletAddress", contractId);
}

/**
 * Signs an already-simulated contract call with the connected passkey, then
 * hands it to our server relay for fee-sponsored submission (the relayer API
 * key never reaches the browser). Defaults to the LiraShield vault contract;
 * pass `contractId` to relay a call against a different contract (e.g. a SAC).
 */
export async function signAndRelayVaultCall<T>(
  assembled: AssembledTransaction<T>,
  contractId?: string,
): Promise<T> {
  const walletKit = getPasskeyKit();
  await ensureWalletConnected();
  await walletKit.sign(assembled);

  const response = await fetch("/api/passkey/relay", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assembledJson: assembled.toJSON(), contractId }),
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "lirashield: relay submission failed");
  }
  if (typeof data.hash !== "string") {
    throw new Error("lirashield: relay did not return a transaction hash");
  }
  lastRelayedTxHash = data.hash;
  let confirmed = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const transaction = await getSorobanServer().getTransaction(data.hash);
    if (transaction.status === "SUCCESS") {
      confirmed = true;
      break;
    }
    if (transaction.status === "FAILED") {
      throw new Error("lirashield: relayed transaction failed on-chain");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!confirmed) {
    throw new Error("lirashield: timed out waiting for relayed transaction");
  }
  return assembled.result;
}
