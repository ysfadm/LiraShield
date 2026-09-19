import { Keypair } from "@stellar/stellar-sdk";

/**
 * TR Mock Anchor requires a classic Ed25519 keypair for SEP-10 login and as
 * the delivery address for USDC (contract/passkey addresses can't sign a SEP-10
 * challenge or receive a classic payment/claimable balance). This module
 * manages a per-session "anchor bridge" keypair, generated and kept client-side
 * only, then swept into the user's real smart wallet after each deposit.
 *
 * The user never sees a seed phrase: it's presented in the UI as the IBAN-linked
 * account, and only ever used to sign anchor traffic. The secret is kept
 * only for the current browser tab so interrupted testnet flows can resume.
 */
let bridgeKeypair: Keypair | null = null;
const BRIDGE_SECRET_KEY = "lirashield.anchorBridgeSecret";

export function getOrCreateBridgeKeypair(): Keypair {
  if (typeof window === "undefined") {
    throw new Error(
      "lirashield: bridge keypair is only available in the browser",
    );
  }
  if (!bridgeKeypair) {
    const storedSecret = window.sessionStorage.getItem(BRIDGE_SECRET_KEY);
    if (storedSecret) {
      try {
        bridgeKeypair = Keypair.fromSecret(storedSecret);
      } catch {
        window.sessionStorage.removeItem(BRIDGE_SECRET_KEY);
      }
    }
    if (!bridgeKeypair) {
      bridgeKeypair = Keypair.random();
      window.sessionStorage.setItem(BRIDGE_SECRET_KEY, bridgeKeypair.secret());
    }
  }
  return bridgeKeypair;
}
