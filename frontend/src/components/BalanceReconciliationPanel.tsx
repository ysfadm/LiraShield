"use client";

import { Scale } from "lucide-react";

interface BalanceReconciliationPanelProps {
  protectedTryDisplay: string;
  onChainUsdDisplay: string;
  vaultConfigured: boolean;
  positionActive: boolean;
  loading: boolean;
  lastSyncedAt: Date | null;
}

interface ReconciliationRowProps {
  label: string;
  value: string;
  hint?: string;
  tone?: "emerald" | "sky" | "slate";
}

function ReconciliationRow({
  label,
  value,
  hint,
  tone = "slate",
}: ReconciliationRowProps) {
  const toneClass =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "sky"
        ? "text-sky-300"
        : "text-slate-300";
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0">
        <span className="text-sm text-slate-400">{label}</span>
        {hint ? <p className="text-xs text-slate-600">{hint}</p> : null}
      </div>
      <span className={`shrink-0 text-sm font-medium ${toneClass}`}>{value}</span>
    </div>
  );
}

/** Reconciles the demo's UI-tracked TRY ledger against the real on-chain DeFindex estimate. */
export function BalanceReconciliationPanel({
  protectedTryDisplay,
  onChainUsdDisplay,
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
            Activity-history TRY vs on-chain USD estimate — two different ledgers.
          </p>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        <ReconciliationRow
          label="Protected TRY (UI)"
          hint="From this browser's activity history"
          value={protectedTryDisplay}
          tone="emerald"
        />
        <ReconciliationRow
          label="On-chain USD estimate"
          hint="DeFindex shares via get_user_position"
          value={loading ? "Syncing" : onChainUsdDisplay}
          tone={positionActive ? "sky" : "slate"}
        />
        <ReconciliationRow
          label="Bridge / FAST account"
          value={
            loading
              ? "Syncing"
              : vaultConfigured
                ? "Ready"
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
