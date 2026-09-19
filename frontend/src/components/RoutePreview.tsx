"use client";

interface RoutePreviewProps {
  steps: string[];
  compact?: boolean;
}

export function RoutePreview({ steps, compact = false }: RoutePreviewProps) {
  return (
    <div
      className={`flex flex-wrap items-center ${compact ? "gap-1.5" : "gap-2"}`}
    >
      {steps.map((step, index) => (
        <div key={step} className="flex items-center gap-1.5">
          <span
            className={`rounded-full border border-emerald-400/30 bg-emerald-400/10 font-medium text-emerald-200 ${
              compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"
            }`}
          >
            {step}
          </span>
          {index < steps.length - 1 && (
            <span className="text-slate-600" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
