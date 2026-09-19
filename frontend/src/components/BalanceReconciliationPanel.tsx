"use client";

import { Scale } from "lucide-react";

interface BalanceReconciliationPanelProps {
  protectedTryDisplay: string;
  vaultConfigured: boolean;
  positionActive: boolean;
  loading: boolean;
  lastSyncedAt: Date | null;
}

interface ReconciliationRowProps {
  label: string;
  value: string;
  tone?: "emerald" | "sky" | "slate";
}

function ReconciliationRow({
  label,
  value,
  tone = "slate",
}: ReconciliationRowProps) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "sky"
        ? "text-sky-300"
        : "text-slate-300";
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-slate-400">{label}</span>
      <span className={`text-sm font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Reconciles the demo's UI-tracked TRY ledger value against the real on-chain DeFindex vault position. */
export function BalanceReconciliationPanel({
  protectedTryDisplay,
  vaultConfigured,
  positionActive,
  loading,
  lastSyncedAt,
}: BalanceReconciliationPanelProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-2 flex items-center gap-2">
        <Scale className="text-sky-300" size={18} />
        <div>
          <h2 className="font-semibold text-white">Balance check</h2>
          <p className="text-sm text-slate-500">
            UI dollar shield vs on-chain vault position.
          </p>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        <ReconciliationRow
          label="Protected TRY in UI"
          value={protectedTryDisplay}
          tone="emerald"
        />
        <ReconciliationRow
          label="On-chain vault"
          value={
            loading
              ? "Syncing"
              : vaultConfigured
                ? "Available"
                : "Not set"
          }
          tone={vaultConfigured ? "emerald" : "slate"}
        />
        <ReconciliationRow
          label="USD vault position"
          value={positionActive ? "Active" : "Inactive"}
          tone={positionActive ? "sky" : "slate"}
        />
        <ReconciliationRow
          label="Last sync"
          value={
            lastSyncedAt
              ? lastSyncedAt.toLocaleTimeString("en-US", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : "Not synced yet"
          }
        />
      </div>
    </section>
  );
}
