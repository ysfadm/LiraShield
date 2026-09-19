"use client";

import { useState } from "react";
import {
  ChevronDown,
  Copy,
  ExternalLink,
  LogOut,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { shortenAddress } from "@/lib/format";
import {
  DEFINDEX_VAULT_CONTRACT_ID,
  LIRASHIELD_VAULT_CONTRACT_ID,
  SOROSWAP_ROUTER_CONTRACT_ID,
  stellarExpertContractUrl,
} from "@/lib/stellar";

interface SettingsMenuProps {
  walletAddress: string;
  vaultAddress: string | null;
  anchorMode: "live" | "mock";
  hasHistory: boolean;
  onClearHistory: () => void;
  onResetView: () => void;
  onLogout: () => void;
}

export function SettingsMenu({
  walletAddress,
  vaultAddress,
  anchorMode,
  hasHistory,
  onClearHistory,
  onResetView,
  onLogout,
}: SettingsMenuProps) {
  const [message, setMessage] = useState<string | null>(null);
  const [devProofOpen, setDevProofOpen] = useState(false);

  function flash(text: string) {
    setMessage(text);
    setTimeout(
      () => setMessage((current) => (current === text ? null : current)),
      2000,
    );
  }

  async function copyToClipboard(label: string, value: string) {
    if (!value) {
      flash(`${label} is not set`);
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      flash(`${label} copied`);
    } catch {
      flash(`Could not copy ${label}`);
    }
  }

  return (
    <div className="fixed inset-x-4 top-[4.75rem] z-30 max-h-[min(32rem,calc(100vh-6rem))] overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950 p-4 shadow-2xl shadow-black/30 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 sm:w-[22rem]">
      <div className="mb-4">
        <p className="font-semibold text-white">Settings</p>
        <p className="text-xs text-slate-500">Account, network, and demo controls</p>
      </div>

      <Section title="Account">
        <Row label="Account ID" value={shortenAddress(walletAddress)} />
        <Row label="Passkey" value="Connected" accent />
        <button
          onClick={() => copyToClipboard("Account ID", walletAddress)}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-900"
        >
          <Copy size={14} /> Copy account ID
        </button>
      </Section>

      <Section title="Network">
        <Row label="Network" value="Stellar Testnet" />
        <Row
          label="Anchor rail"
          value={anchorMode === "live" ? "Live SEP-6" : "Mock fallback"}
        />
      </Section>

      <Section title="Demo controls">
        <button
          onClick={() => {
            onResetView();
            flash("Demo view reset");
          }}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-900"
        >
          <RotateCcw size={14} /> Reset demo view
        </button>
      </Section>

      <Section title="Protocol addresses">
        <ProtocolRow
          label="LiraShield vault"
          value={LIRASHIELD_VAULT_CONTRACT_ID}
          onCopy={() =>
            copyToClipboard("Vault address", LIRASHIELD_VAULT_CONTRACT_ID)
          }
        />
        <ProtocolRow
          label="USD vault (DeFindex)"
          value={DEFINDEX_VAULT_CONTRACT_ID}
          onCopy={() =>
            copyToClipboard("USD vault address", DEFINDEX_VAULT_CONTRACT_ID)
          }
        />
        <ProtocolRow
          label="Soroswap router"
          value={SOROSWAP_ROUTER_CONTRACT_ID}
          onCopy={() =>
            copyToClipboard("Router address", SOROSWAP_ROUTER_CONTRACT_ID)
          }
        />
        <button
          onClick={() => copyToClipboard("FAST bridge address", vaultAddress ?? "")}
          disabled={!vaultAddress}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Copy size={14} /> Copy FAST bridge address
        </button>
      </Section>

      <Section title="Clear history">
        <button
          onClick={onClearHistory}
          disabled={!hasHistory}
          className="flex w-full items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-left text-sm text-red-300 transition hover:border-red-400/60 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Trash2 size={14} /> Clear transaction history
        </button>
      </Section>

      <button
        onClick={onLogout}
        className="mb-3 flex w-full items-center gap-2 rounded-xl border border-slate-800 px-3 py-2 text-left text-sm text-slate-300 transition hover:bg-slate-900"
      >
        <LogOut size={14} /> Log out
      </button>

      {message && (
        <p className="mb-3 text-center text-xs text-emerald-300">{message}</p>
      )}

      <button
        onClick={() => setDevProofOpen((value) => !value)}
        className="flex w-full items-center justify-between text-sm font-medium text-slate-300"
      >
        Developer proof
        <ChevronDown
          size={16}
          className={`transition ${devProofOpen ? "rotate-180" : ""}`}
        />
      </button>
      {devProofOpen && (
        <div className="mt-3 space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-3 text-xs text-slate-400">
          <p>
            <span className="font-semibold text-slate-200">Instance storage:</span>{" "}
            contract config (admin, tokens, router, DeFindex vault)
          </p>
          <p>
            <span className="font-semibold text-slate-200">
              Persistent storage:
            </span>{" "}
            user positions (DeFindex shares, lifetime deposits/withdrawals)
          </p>
          <p>
            <span className="font-semibold text-slate-200">
              Temporary storage:
            </span>{" "}
            per-user transaction lock (reentrancy)
          </p>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
        {title}
      </p>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={accent ? "font-medium text-emerald-300" : "font-medium text-white"}>
        {value}
      </span>
    </div>
  );
}

function ProtocolRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  const href = value ? stellarExpertContractUrl(value) : null;
  return (
    <div className="rounded-xl border border-slate-800 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopy}
            disabled={!value}
            className="text-slate-400 hover:text-white disabled:opacity-40"
            aria-label={`Copy ${label}`}
          >
            <Copy size={13} />
          </button>
          {href && (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="text-slate-400 hover:text-emerald-300"
              aria-label={`Open ${label} in explorer`}
            >
              <ExternalLink size={13} />
            </a>
          )}
        </div>
      </div>
      <p className="mt-1 font-mono text-[11px] text-slate-300">
        {value ? shortenAddress(value, 8, 6) : "Not set"}
      </p>
    </div>
  );
}
