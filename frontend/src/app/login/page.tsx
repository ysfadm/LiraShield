"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import {
  PasskeyAuth,
  type PasskeyAuthAction,
} from "@/components/PasskeyAuth";

export default function LoginPage() {
  const router = useRouter();

  function handleAuthenticated(
    walletAddress: string,
    action: PasskeyAuthAction,
  ) {
    window.localStorage.setItem("lirashield.walletAddress", walletAddress);
    window.sessionStorage.setItem(
      "lirashield.authToast",
      action === "create"
        ? "New wallet created. You are signed in."
        : "Wallet connected. You are signed in.",
    );
    router.push("/dashboard");
  }

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 py-8">
      <header className="flex items-center justify-between">
        <button
          onClick={() => router.push("/")}
          className="inline-flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-4 py-2 text-sm text-slate-300 transition hover:bg-slate-800"
        >
          <ArrowLeft size={16} /> Back
        </button>
        <div className="inline-flex items-center gap-2 rounded-full bg-emerald-400/10 px-4 py-2 text-sm font-medium text-emerald-300">
          <ShieldCheck size={16} /> Protected with passkey
        </div>
      </header>

      <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1fr_0.9fr]">
        <div>
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.22em] text-emerald-300">
            LiraShield account sign-in
          </p>
          <h1 className="max-w-xl text-4xl font-semibold leading-tight text-white sm:text-5xl">
            Sign in once. Shield TRY in dollars and move cash via IBAN.
          </h1>
          <p className="mt-5 max-w-xl text-slate-400">
            Passkey unlocks your account. FAST deposits, USD protection, and
            IBAN withdrawals run through one flow — no fake yield rates.
          </p>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/80 p-6 shadow-2xl shadow-black/20">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-white">Continue</h2>
            <p className="mt-2 text-sm text-slate-400">
              Connect an existing passkey wallet or create a new demo wallet.
            </p>
          </div>
          <PasskeyAuth onAuthenticated={handleAuthenticated} />
        </div>
      </section>
    </main>
  );
}
