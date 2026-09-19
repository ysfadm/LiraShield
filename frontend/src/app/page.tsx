"use client";

import { useRouter } from "next/navigation";
import {
  ArrowRight,
  CircleCheck,
  Landmark,
  ShieldCheck,
  Vault,
  WalletCards,
} from "lucide-react";

const flowSteps = [
  { label: "TRY", detail: "FAST on-ramp" },
  { label: "USDC", detail: "Dollar shield" },
  { label: "Vault", detail: "On-chain position" },
  { label: "IBAN", detail: "FAST off-ramp" },
];

const proofPoints = [
  "Passkey sign-in",
  "Soroban vault contract",
  "FAST / IBAN rail",
  "USD-protected balance",
];

export default function LandingPage() {
  const router = useRouter();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <ShieldCheck size={24} />
          </div>
          <div>
            <p className="text-lg font-semibold text-white">LiraShield</p>
            <p className="text-xs text-slate-500">
              Inflation shield + bank on-ramp
            </p>
          </div>
        </div>
        <button
          onClick={() => router.push("/login")}
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
        >
          Sign in <ArrowRight size={16} />
        </button>
      </header>

      <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.1fr_0.9fr]">
        <div>
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300">
            <CircleCheck size={16} /> Live testnet demo · no fake APY
          </div>
          <h1 className="max-w-3xl text-5xl font-semibold leading-tight text-white sm:text-6xl">
            Keep your TRY safe in dollars. Deposit and withdraw like a bank.
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-400">
            LiraShield is an inflation shield and on-ramp: send TRY via FAST, see
            a USD-protected balance, withdraw to your IBAN when you need cash.
            Behind the scenes, Stellar moves funds into USDC — we never invent
            a yield rate for the demo.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              onClick={() => router.push("/login")}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-6 py-4 font-semibold text-slate-950 transition hover:bg-emerald-300"
            >
              Open a protected account <ArrowRight size={18} />
            </button>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
          <div className="mb-6 flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-400">Protected balance</p>
              <p className="mt-1 text-4xl font-semibold text-white">₺1,000</p>
              <p className="mt-1 text-sm text-emerald-300/90">
                Held as USD on-chain — not a yield promise
              </p>
            </div>
            <div className="rounded-2xl bg-emerald-400/10 p-3 text-emerald-300">
              <WalletCards size={28} />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <Landmark className="mb-3 text-emerald-300" size={22} />
              <p className="font-medium text-white">Bank on-ramp</p>
              <p className="mt-1 text-sm text-slate-500">TRY in, IBAN out</p>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <Vault className="mb-3 text-sky-300" size={22} />
              <p className="font-medium text-white">Dollar shield</p>
              <p className="mt-1 text-sm text-slate-500">USDC on Stellar</p>
            </div>
          </div>

          <div className="mt-6 rounded-2xl bg-slate-950 p-4">
            <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              Protection route
            </p>
            <div className="grid gap-3 sm:grid-cols-4">
              {flowSteps.map((step, index) => (
                <div key={step.label}>
                  <div className="mb-2 flex h-7 w-7 items-center justify-center rounded-full bg-emerald-400/10 text-xs font-semibold text-emerald-300">
                    {index + 1}
                  </div>
                  <p className="text-sm font-medium text-white">{step.label}</p>
                  <p className="text-xs text-slate-500">{step.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-3 pb-10 sm:grid-cols-4">
        {proofPoints.map((point) => (
          <div
            key={point}
            className="rounded-2xl border border-slate-800 bg-slate-900/70 px-4 py-3 text-sm text-slate-300"
          >
            <CircleCheck className="mb-2 text-emerald-300" size={16} />
            {point}
          </div>
        ))}
      </section>
    </main>
  );
}
