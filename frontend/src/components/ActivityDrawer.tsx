"use client";

import { ExternalLink, X } from "lucide-react";
import {
  depositRouteLabel,
  formatTry,
  shortenAddress,
  withdrawRouteLabel,
} from "@/lib/format";
import { stellarExpertTxUrl } from "@/lib/stellar";
import type { TransactionHistoryItem } from "@/lib/transaction-history";

interface ActivityDrawerProps {
  item: TransactionHistoryItem | null;
  onClose: () => void;
}

export function ActivityDrawer({ item, onClose }: ActivityDrawerProps) {
  if (!item) return null;

  const route =
    item.type === "deposit" ? depositRouteLabel() : withdrawRouteLabel();
  const explorerUrl = item.txHash ? stellarExpertTxUrl(item.txHash) : null;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end">
      <button
        className="absolute inset-0 bg-black/55"
        onClick={onClose}
        aria-label="Close transaction details"
      />
      <aside className="relative flex h-full w-full max-w-md flex-col border-l border-slate-800 bg-slate-950 shadow-2xl shadow-black/40">
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Account activity
            </p>
            <h2 className="mt-1 text-lg font-semibold text-white">
              {item.type === "deposit"
                ? "TRY deposit protected"
                : "IBAN withdrawal completed"}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-800 p-2 text-slate-400 hover:text-white"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <DetailRow label="Route" value={route} />
          <DetailRow label="Status" value="Completed" accent />
          <DetailRow
            label="Amount"
            value={`${item.type === "deposit" ? "+" : "-"}${formatTry(item.tryAmount)}`}
          />
          <DetailRow
            label="Time"
            value={new Date(item.createdAt).toLocaleString("en-US")}
          />

          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.16em] text-slate-500">
              Technical proof
            </p>
            <div className="space-y-2 rounded-2xl border border-slate-800 bg-slate-900 p-4 text-sm">
              <p className="text-slate-400">{item.detail}</p>
              {item.txHash ? (
                <p className="font-mono text-xs text-slate-300">
                  {shortenAddress(item.txHash, 10, 8)}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  A local receipt was saved for this demo flow.
                </p>
              )}
              {item.steps && item.steps.length > 0 && (
                <ul className="space-y-1.5 pt-1">
                  {item.steps.map((step) => (
                    <li key={step} className="text-slate-300">
                      {step}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {explorerUrl && (
            <a
              href={explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm font-medium text-emerald-300 transition hover:border-emerald-400/60"
            >
              View on Stellar Expert
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-slate-400">{label}</span>
      <span
        className={`text-right text-sm font-medium ${
          accent ? "text-emerald-300" : "text-white"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
