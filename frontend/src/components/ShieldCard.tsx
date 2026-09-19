import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface ShieldCardProps {
  icon: LucideIcon;
  label: string;
  value: string;
  helper?: ReactNode;
  accent?: "emerald" | "sky";
}

/** A single stat card for the dashboard (protected balance, dollar shield, etc.). */
export function ShieldCard({
  icon: Icon,
  label,
  value,
  helper,
  accent = "emerald",
}: ShieldCardProps) {
  const accentClasses =
    accent === "emerald"
      ? "bg-emerald-500/10 text-emerald-400"
      : "bg-sky-500/10 text-sky-400";

  return (
    <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg">
      <div
        className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-2xl ${accentClasses}`}
      >
        <Icon size={22} />
      </div>
      <p className="text-sm text-slate-400">{label}</p>
      <p className="mt-1 text-3xl font-semibold text-white">{value}</p>
      {helper && <p className="mt-2 text-sm text-slate-500">{helper}</p>}
    </div>
  );
}
