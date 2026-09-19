"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import { runFastDepositAndShield } from "@/lib/anchor-sep";
import { MAX_TRANSACTION_AMOUNT, stellarExpertTxUrl } from "@/lib/stellar";
import { createTransactionHistoryItem } from "@/lib/transaction-history";
import type { TransactionHistoryItem } from "@/lib/transaction-history";
import { ImpactPreview } from "@/components/ImpactPreview";

interface FastDepositModalProps {
  open: boolean;
  onClose: () => void;
  userAddress: string;
  currentTryBalance: number;
  onDeposited: (item: TransactionHistoryItem) => void;
}

type Step = "amount" | "confirm" | "processing" | "done";

const depositTimeline = [
  "FAST payment received",
  "Converted to USDC",
  "Deposited into USD vault",
  "Dollar shield active",
];

/** Deposit flow: FAST deposit simulation -> automatic DeFindex shielding. */
export function FastDepositModal({
  open,
  onClose,
  userAddress,
  currentTryBalance,
  onDeposited,
}: FastDepositModalProps) {
  const [amount, setAmount] = useState("");
  const [step, setStep] = useState<Step>("amount");
  const [estimatedUsdc, setEstimatedUsdc] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setAmount("");
    setStep("amount");
    setEstimatedUsdc(null);
    setTxHash(null);
    setError(null);
  }

  async function handleContinue() {
    setError(null);
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value > MAX_TRANSACTION_AMOUNT
    ) {
      setError("Enter a valid amount.");
      return;
    }
    try {
      // SEP-6 rails accept at most 2 decimal places.
      setAmount(value.toFixed(2));
      setEstimatedUsdc(value.toFixed(2));
      setStep("confirm");
    } catch (err) {
      console.error("lirashield: exchange quote failed", err);
      setError("Could not get a rate. Please try again.");
    }
  }

  async function handleConfirm() {
    setStep("processing");
    setError(null);
    try {
      const { txHash } = await runFastDepositAndShield(amount);
      setTxHash(txHash ?? null);
      setStep("done");
      onDeposited(
        createTransactionHistoryItem(
          "deposit",
          amount,
          `Protected via FAST: ${userAddress.slice(0, 6)}…${userAddress.slice(-4)}`,
          txHash ?? null,
        ),
      );
    } catch (err) {
      console.error("lirashield: deposit failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Transaction could not be completed.",
      );
      setStep("confirm");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-6">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            Deposit and protect
          </h2>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-slate-400 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {step === "amount" && (
          <div className="space-y-4">
            <label className="block text-sm text-slate-400">
              Amount to deposit (TRY)
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                placeholder="1,000"
              />
            </label>
            <p className="text-xs text-slate-500">
              After you confirm, TRY is collected via FAST and converted into a
              USD-protected on-chain balance. The live demo rail accepts up to
              300 USDC per transaction (about ₺10,000). No APY is claimed.
            </p>
            <ImpactPreview
              kind="deposit"
              amount={Number(amount)}
              currentBalance={currentTryBalance}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleContinue}
              className="w-full rounded-xl bg-emerald-500 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
            >
              Continue
            </button>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <ImpactPreview
              kind="deposit"
              amount={Number(amount)}
              currentBalance={currentTryBalance}
            />
            <div className="rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
              <div className="flex justify-between py-1">
                <span>Deposit amount</span>
                <span className="font-semibold text-white">
                  ≈ {estimatedUsdc} TRY
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span>Transfer method</span>
                <span className="font-semibold text-white">FAST (instant)</span>
              </div>
            </div>
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleConfirm}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 py-3 font-semibold text-slate-950 hover:bg-emerald-400"
            >
              <ShieldCheck size={18} /> Confirm and protect
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-5 py-4 text-slate-300">
            <div className="flex items-center gap-3">
              <Loader2 className="animate-spin text-emerald-300" size={24} />
              <div>
                <p className="font-medium text-white">
                  Protecting your deposit
                </p>
                <p className="text-sm text-slate-500">
                  Coordinating the FAST rail, Soroswap bridge, and USD vault.
                </p>
              </div>
            </div>
            <div className="space-y-3 rounded-2xl bg-slate-950 p-4">
              {depositTimeline.map((label, index) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-400/10 text-xs font-semibold text-emerald-300">
                    {index + 1}
                  </span>
                  <span className="text-slate-300">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <ShieldCheck className="text-emerald-400" size={40} />
            <p className="text-white">
              Done. {amount} TRY is now protected.
            </p>
            <div className="mt-2 w-full rounded-2xl bg-slate-950 p-4 text-left">
              {depositTimeline.map((label) => (
                <div
                  key={label}
                  className="flex items-center gap-3 py-1 text-sm"
                >
                  <ShieldCheck className="text-emerald-300" size={16} />
                  <span className="text-slate-300">{label}</span>
                </div>
              ))}
            </div>
            {txHash && (
              <a
                href={stellarExpertTxUrl(txHash)}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-sky-400 underline decoration-dotted underline-offset-4 hover:text-sky-300"
              >
                View transaction on Stellar Expert
              </a>
            )}
            <button
              onClick={() => {
                reset();
                onClose();
              }}
              className="mt-2 rounded-xl bg-slate-800 px-6 py-2 text-sm text-slate-200 hover:bg-slate-700"
            >
              Close
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
