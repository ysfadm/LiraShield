import { Keypair } from "@stellar/stellar-sdk";

/**
 * TR Mock Anchor requires a classic Ed25519 keypair for SEP-10 login and as
 * the delivery address for USDC (contract/passkey addresses can't sign a SEP-10
 * challenge or receive a classic payment/claimable balance). This module
 * manages a per-tab "anchor bridge" keypair in sessionStorage.
 *
 * On the current testnet demo path, vault `shield_usdc` / `unshield_*` calls are
 * also signed by this bridge account — so on-chain positions are keyed to the
 * bridge G-address, not the passkey smart wallet C-address. Production should
 * move the bridge to a limited backend operator (see README roadmap).
 *
 * The user never sees a seed phrase: the UI labels this as the FAST bridge
 * account. The secret lives only for the current browser tab so interrupted
 * testnet flows can resume, and clears when the tab closes.
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
