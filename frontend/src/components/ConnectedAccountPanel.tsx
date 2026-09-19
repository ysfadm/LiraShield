"use client";

import { useState } from "react";
import { Copy, Fingerprint, ShieldCheck, Wallet } from "lucide-react";
import { shortenAddress } from "@/lib/format";
import { stellarExpertAccountUrl } from "@/lib/stellar";

interface ConnectedAccountPanelProps {
  walletAddress: string;
  vaultAddress: string | null;
  passkeyConnected: boolean;
  protectedActive: boolean;
}

export function ConnectedAccountPanel({
  walletAddress,
  vaultAddress,
  passkeyConnected,
  protectedActive,
}: ConnectedAccountPanelProps) {
  const [copied, setCopied] = useState<string | null>(null);

  async function copy(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(
        () => setCopied((current) => (current === label ? null : current)),
        1600,
      );
    } catch {
      setCopied(null);
    }
  }

  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-white">Connected account</h2>
          <p className="text-sm text-slate-500">
            Passkey wallet and dollar-shield vault ID
          </p>
        </div>
        {copied && (
          <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
            {copied} copied
          </span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
            <Wallet size={13} /> Account ID
          </div>
          <p className="break-all font-mono text-sm text-white">
            {shortenAddress(walletAddress, 8, 6)}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => copy("Account ID", walletAddress)}
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-900"
            >
              <Copy size={12} /> Copy
            </button>
            <a
              href={stellarExpertAccountUrl(walletAddress)}
              target="_blank"
              rel="noreferrer"
              className="rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-400 hover:text-emerald-300"
            >
              Open in explorer
            </a>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
            <Fingerprint size={13} /> Passkey status
          </div>
          <p className="text-lg font-semibold text-white">
            {passkeyConnected ? "Connected" : "Not connected"}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Sign-in uses your device identity
          </p>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
          <div className="mb-3 flex items-center gap-2 text-xs uppercase tracking-[0.16em] text-slate-500">
            <ShieldCheck size={13} /> Dollar shield
          </div>
          <p className="text-lg font-semibold text-white">
            {protectedActive ? "Active" : "Ready"}
          </p>
          {vaultAddress ? (
            <button
              onClick={() => copy("Vault ID", vaultAddress)}
              className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-slate-800 px-3 py-1 text-xs text-slate-300 hover:bg-slate-900"
            >
              <Copy size={12} /> Copy vault
            </button>
          ) : (
            <p className="mt-3 text-xs text-slate-500">Vault is preparing</p>
          )}
        </div>
      </div>
    </section>
  );
}
