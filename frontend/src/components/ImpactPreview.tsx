"use client";

import { formatTry } from "@/lib/format";

interface ImpactPreviewProps {
  kind: "deposit" | "withdraw";
  amount: number;
  currentBalance: number;
}

export function ImpactPreview({
  kind,
  amount,
  currentBalance,
}: ImpactPreviewProps) {
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const nextBalance =
    kind === "deposit"
      ? currentBalance + amount
      : Math.max(0, currentBalance - amount);
  const route =
    kind === "deposit" ? "FAST → USDC → DeFindex" : "DeFindex → USDC → IBAN";

  return (
    <div className="space-y-3 rounded-2xl border border-slate-800 bg-slate-950 p-4 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">
          {kind === "deposit" ? "You are depositing" : "You are withdrawing"}
        </span>
        <span className="font-semibold text-white">{formatTry(amount)}</span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">
          {kind === "deposit"
            ? "New protected balance"
            : "Remaining protected balance"}
        </span>
        <span className="font-semibold text-emerald-300">
          {formatTry(nextBalance)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3">
        <span className="text-slate-400">Route</span>
        <span className="text-right font-medium text-slate-200">{route}</span>
      </div>
    </div>
  );
}
