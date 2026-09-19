"use client";

import { ExternalLink, ShieldCheck } from "lucide-react";
import {
  DEFINDEX_VAULT_CONTRACT_ID,
  LIRASHIELD_VAULT_CONTRACT_ID,
  SOROSWAP_ROUTER_CONTRACT_ID,
  stellarExpertContractUrl,
  stellarExpertTxUrl,
} from "@/lib/stellar";

interface ProofPanelProps {
  lastTxHash: string | null;
}

function shorten(id: string): string {
  if (!id) return "Not set";
  return `${id.slice(0, 6)}…${id.slice(-6)}`;
}

interface ProofRowProps {
  label: string;
  value: string;
  href: string | null;
}

function ProofRow({ label, value, href }: ProofRowProps) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-slate-400">{label}</span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs font-medium text-emerald-300 transition hover:border-emerald-400/50"
        >
          {shorten(value)}
          <ExternalLink size={12} />
        </a>
      ) : (
        <span className="rounded-full border border-slate-800 bg-slate-950 px-3 py-1 text-xs text-slate-500">
          Not set
        </span>
      )}
    </div>
  );
}

/** Real testnet addresses + explorer links — proves the demo is live on-chain, not simulated. */
export function ProofPanel({ lastTxHash }: ProofPanelProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="mb-3 flex items-center gap-2">
        <ShieldCheck className="text-emerald-300" size={18} />
        <div>
          <h2 className="font-semibold text-white">On-chain proof</h2>
          <p className="text-sm text-slate-500">
            Real Stellar Testnet contracts for the dollar shield — verify on
            Stellar Expert.
          </p>
        </div>
      </div>
      <div className="divide-y divide-slate-800">
        <ProofRow
          label="Vault contract"
          value={LIRASHIELD_VAULT_CONTRACT_ID}
          href={
            LIRASHIELD_VAULT_CONTRACT_ID
              ? stellarExpertContractUrl(LIRASHIELD_VAULT_CONTRACT_ID)
              : null
          }
        />
        <ProofRow
          label="USD vault (DeFindex)"
          value={DEFINDEX_VAULT_CONTRACT_ID}
          href={
            DEFINDEX_VAULT_CONTRACT_ID
              ? stellarExpertContractUrl(DEFINDEX_VAULT_CONTRACT_ID)
              : null
          }
        />
        <ProofRow
          label="Soroswap router"
          value={SOROSWAP_ROUTER_CONTRACT_ID}
          href={
            SOROSWAP_ROUTER_CONTRACT_ID
              ? stellarExpertContractUrl(SOROSWAP_ROUTER_CONTRACT_ID)
              : null
          }
        />
        <ProofRow
          label="Last transaction"
          value={lastTxHash ?? ""}
          href={lastTxHash ? stellarExpertTxUrl(lastTxHash) : null}
        />
      </div>
    </section>
  );
}
