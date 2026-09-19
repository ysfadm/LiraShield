import { DollarSign } from "lucide-react";
import { formatUsd } from "@/lib/format";

interface YieldEstimateCardProps {
  usdValue: number;
  loading?: boolean;
  active: boolean;
}

/** Shows the dollar equivalent of the protected position — never a made-up APY. */
export function YieldEstimateCard({
  usdValue,
  loading = false,
  active,
}: YieldEstimateCardProps) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex items-center justify-between">
        <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
          Dollar shield
        </p>
        <DollarSign className="text-sky-300" size={18} />
      </div>
      {loading ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded-xl bg-slate-800" />
      ) : (
        <p className="mt-2 text-2xl font-semibold text-white">
          {active ? formatUsd(usdValue) : "—"}
        </p>
      )}
      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p>
          {active
            ? "USD value of your protected TRY"
            : "No protected balance yet"}
        </p>
        <p>Inflation shield via USDC — not an APY or yield estimate</p>
        <p>On-chain vault position; real yield only when mainnet data is wired</p>
      </div>
    </div>
  );
}
