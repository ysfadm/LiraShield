"use client";

import { useState } from "react";
import { Fingerprint, Loader2 } from "lucide-react";
import {
  connectWalletSafely,
  getPasskeyKit,
  relaySignedXdr,
  rememberPasskeySession,
} from "@/lib/passkey";

interface PasskeyAuthProps {
  onAuthenticated: (walletAddress: string) => void;
}

/** Passkey entry point: connect to an existing wallet or create a new one explicitly. */
export function PasskeyAuth({ onAuthenticated }: PasskeyAuthProps) {
  const [busyAction, setBusyAction] = useState<"connect" | "create" | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  function formatError(value: unknown, fallback: string) {
    if (!(value instanceof Error)) return fallback;
    const cause = (value as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      return `${value.message}: ${cause.message}`;
    }
    return value.message || fallback;
  }

  async function handleConnect() {
    setBusyAction("connect");
    setError(null);
    try {
      if (!window.isSecureContext) {
        throw new Error(
          "Passkeys need HTTPS or http://localhost. Open the demo at http://localhost:3000.",
        );
      }
      const contractId = await connectWalletSafely();
      onAuthenticated(contractId);
    } catch (err) {
      setError(formatError(err, "Could not connect wallet."));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreate() {
    setBusyAction("create");
    setError(null);
    try {
      if (!window.isSecureContext) {
        throw new Error(
          "Passkeys need HTTPS or http://localhost. Open the demo at http://localhost:3000.",
        );
      }
      const kit = getPasskeyKit();
      const created = await kit.createWallet("LiraShield", "lirashield-user");
      const { hash } = await relaySignedXdr(created.signedTx);
      await kit.confirmWalletCreation(created, hash);
      rememberPasskeySession(created.keyIdBase64, created.contractId);
      onAuthenticated(created.contractId);
    } catch (err) {
      setError(formatError(err, "Could not create wallet."));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleConnect}
        disabled={busyAction !== null}
        className="flex items-center gap-3 rounded-2xl bg-emerald-500 px-8 py-4 text-lg font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
      >
        {busyAction === "connect" ? (
          <Loader2 className="animate-spin" size={22} />
        ) : (
          <Fingerprint size={22} />
        )}
        Connect existing wallet
      </button>
      <button
        onClick={handleCreate}
        disabled={busyAction !== null}
        className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-900 px-8 py-4 font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60"
      >
        {busyAction === "create" ? (
          <Loader2 className="animate-spin" size={20} />
        ) : (
          <Fingerprint size={20} />
        )}
        Create new wallet
      </button>
      {error && (
        <p className="max-w-sm text-center text-sm text-red-400">{error}</p>
      )}
    </div>
  );
}
