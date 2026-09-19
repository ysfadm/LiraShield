"use client";

function Pulse({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-2xl bg-slate-800 ${className}`} />;
}

export function DashboardSkeleton() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Pulse className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Pulse className="h-5 w-32" />
            <Pulse className="h-3 w-48" />
          </div>
        </div>
        <Pulse className="h-10 w-10 rounded-full" />
      </div>

      <Pulse className="h-28 w-full rounded-3xl" />
      <Pulse className="h-64 w-full rounded-3xl" />

      <div className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <Pulse className="h-48 rounded-3xl" />
        <Pulse className="h-48 rounded-3xl" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Pulse className="h-40 rounded-3xl" />
        <Pulse className="h-40 rounded-3xl" />
      </div>
    </main>
  );
}
