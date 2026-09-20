"use client";

import { useState } from "react";
import { Loader2, ShieldCheck, X } from "lucide-react";
import {
  getFastWithdrawBridgeAddress,
  runFastWithdraw,
  signAndSendBridgeCall,
} from "@/lib/anchor-sep";
import {
  buildUnshieldUsdcTx,
  buildUnshieldUsdcToTx,
  getSacBalance,
  getUserPosition,
  type UserPositionView,
} from "@/lib/soroban-client";
import {
  MAX_TRANSACTION_AMOUNT,
  scaledAmountToNumber,
  stellarExpertTxUrl,
  USDC_TOKEN_CONTRACT_ID,
} from "@/lib/stellar";
import { MOCK_TRY_PER_USDC_RATE } from "@/lib/anchor-sep";
import { createTransactionHistoryItem } from "@/lib/transaction-history";
import type { TransactionHistoryItem } from "@/lib/transaction-history";
import { ImpactPreview } from "@/components/ImpactPreview";

interface FastWithdrawModalProps {
  open: boolean;
  onClose: () => void;
  userAddress: string;
  protectedTryBalance: number;
  position: UserPositionView | null;
  onWithdrawn: (item: TransactionHistoryItem) => void;
}

type Step = "form" | "confirm" | "processing" | "done";

/** Demo IBAN for hackathon flows — valid TR checksum, no real bank account. */
const DEMO_IBAN = "TR330006100519786457841326";

const withdrawTimeline = [
  "Unlocked from USD vault",
  "Converted to anchor USDC",
  "Sent to bank rail",
  "FAST payment completed",
];

/** Withdraw flow: unwinds shielded USDC back to TRY and pays out via FAST. */
export function FastWithdrawModal({
  open,
  onClose,
  userAddress,
  protectedTryBalance,
  position,
  onWithdrawn,
}: FastWithdrawModalProps) {
  const [amount, setAmount] = useState("");
  const [iban, setIban] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [estimatedTry, setEstimatedTry] = useState<string | null>(null);
  const [usdcNeededScaled, setUsdcNeededScaled] = useState<bigint | null>(null);
  const [targetUsdcScaled, setTargetUsdcScaled] = useState<bigint | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const onChainTryApprox =
    position && position.estimatedUsdcValue > BigInt(0)
      ? scaledAmountToNumber(position.estimatedUsdcValue) * MOCK_TRY_PER_USDC_RATE
      : 0;
  const effectiveTryBalance =
    protectedTryBalance > 0 ? protectedTryBalance : onChainTryApprox;

  function reset() {
    setAmount("");
    setIban("");
    setStep("form");
    setEstimatedTry(null);
    setTargetUsdcScaled(null);
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
    if (!/^TR\d{24}$/.test(iban.replace(/\s+/g, ""))) {
      setError("Enter a valid IBAN (26 characters starting with TR).");
      return;
    }
    try {
      if (
        !position ||
        position.usdcShares <= BigInt(0) ||
        position.estimatedUsdcValue <= BigInt(0)
      ) {
        throw new Error("No protected balance to withdraw.");
      }
      if (effectiveTryBalance <= 0) {
        throw new Error("No protected balance to withdraw.");
      }
      if (value > effectiveTryBalance) {
        throw new Error("This amount exceeds your protected balance.");
      }
      const sharesNeeded =
        (position.usdcShares * BigInt(Math.ceil(value * 100)) +
          BigInt(Math.ceil(effectiveTryBalance * 100)) -
          BigInt(1)) /
        BigInt(Math.ceil(effectiveTryBalance * 100));
      if (sharesNeeded > position.usdcShares) {
        throw new Error("This amount exceeds your protected balance.");
      }
      const usdcNeededScaled =
        (position.estimatedUsdcValue * sharesNeeded +
          position.usdcShares -
          BigInt(1)) /
        position.usdcShares;
      setUsdcNeededScaled(sharesNeeded);
      setTargetUsdcScaled(usdcNeededScaled);
      // SEP-6 rails accept at most 2 decimal places.
      setAmount(value.toFixed(2));
      setEstimatedTry(value.toFixed(2));
      setStep("confirm");
    } catch {
      setError("Could not get a rate. Please try again.");
    }
  }

  async function handleConfirm() {
    setStep("processing");
    setError(null);
    try {
      if (!usdcNeededScaled) {
        throw new Error("lirashield: missing quote");
      }
      if (!targetUsdcScaled) {
        throw new Error("lirashield: missing withdrawal amount");
      }
      const bridgeAddress = await getFastWithdrawBridgeAddress();
      let bridgeUsdc = bridgeAddress
        ? await getSacBalance(USDC_TOKEN_CONTRACT_ID, bridgeAddress)
        : BigInt(0);

      if (bridgeUsdc < targetUsdcScaled) {
        const missingUsdc = targetUsdcScaled - bridgeUsdc;
        const currentPosition = await getUserPosition(userAddress);
        if (
          currentPosition.usdcShares <= BigInt(0) ||
          currentPosition.estimatedUsdcValue <= BigInt(0)
        ) {
          throw new Error("No protected balance to withdraw.");
        }
        const sharesNeeded =
          (missingUsdc * currentPosition.usdcShares +
            currentPosition.estimatedUsdcValue -
            BigInt(1)) /
          currentPosition.estimatedUsdcValue;
        if (sharesNeeded > currentPosition.usdcShares) {
          throw new Error("This amount exceeds your protected balance.");
        }
        const tx = bridgeAddress
          ? await buildUnshieldUsdcToTx(
              userAddress,
              sharesNeeded,
              bridgeAddress,
              bridgeAddress,
            )
          : await buildUnshieldUsdcTx(userAddress, sharesNeeded);
        bridgeUsdc += await signAndSendBridgeCall(tx);
      }
      if (bridgeUsdc < targetUsdcScaled) {
        throw new Error("Unlocked USDC is below the quoted amount.");
      }
      const { tryAmount, txHash } = await runFastWithdraw(
        userAddress,
        targetUsdcScaled,
        iban.replace(/\s+/g, ""),
      );
      setEstimatedTry(Number(amount).toFixed(2));
      setTxHash(txHash ?? null);
      setStep("done");
      onWithdrawn(
        createTransactionHistoryItem(
          "withdraw",
          Number(amount).toFixed(2),
          `Paid to: ${iban.replace(/\s+/g, "").slice(0, 6)}…${iban.replace(/\s+/g, "").slice(-4)} (${Number(tryAmount).toFixed(2)} TRY)`,
          txHash ?? null,
        ),
      );
    } catch (err) {
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
          <h2 className="text-lg font-semibold text-white">Withdraw to IBAN</h2>
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

        {step === "form" && (
          <div className="space-y-4">
            <label className="block text-sm text-slate-400">
              Amount to withdraw (TRY)
              <input
                type="number"
                min="0"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                placeholder="500"
              />
            </label>
            <label className="block text-sm text-slate-400">
              Destination IBAN
              <input
                type="text"
                value={iban}
                onChange={(event) => setIban(event.target.value)}
                className="mt-2 w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-3 text-white outline-none focus:border-emerald-500"
                placeholder="TR00 0000 0000 0000 0000 0000 00"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                setIban(DEMO_IBAN);
                setError(null);
              }}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-4 py-2.5 text-left text-sm text-slate-300 transition hover:border-sky-500/40 hover:bg-slate-900"
            >
              <span className="font-medium text-sky-300">Use demo IBAN</span>
              <span className="mt-0.5 block font-mono text-xs text-slate-500">
                {DEMO_IBAN}
              </span>
            </button>
            <ImpactPreview
              kind="withdraw"
              amount={Number(amount)}
              currentBalance={effectiveTryBalance}
            />
            {error && <p className="text-sm text-red-400">{error}</p>}
            <button
              onClick={handleContinue}
              className="w-full rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 hover:bg-sky-400"
            >
              Continue
            </button>
          </div>
        )}

        {step === "confirm" && (
          <div className="space-y-4">
            <ImpactPreview
              kind="withdraw"
              amount={Number(amount)}
              currentBalance={effectiveTryBalance}
            />
            <div className="rounded-2xl bg-slate-950 p-4 text-sm text-slate-300">
              <div className="flex justify-between gap-3 py-1">
                <span>Destination IBAN</span>
                <span className="break-all text-right font-semibold text-white">
                  {iban}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span>Payout amount</span>
                <span className="font-semibold text-white">
                  ≈ {estimatedTry} TRY
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 hover:bg-sky-400"
            >
              <ShieldCheck size={18} /> Confirm and withdraw
            </button>
          </div>
        )}

        {step === "processing" && (
          <div className="space-y-5 py-4 text-slate-300">
            <div className="flex items-center gap-3">
              <Loader2 className="animate-spin text-sky-300" size={24} />
              <div>
                <p className="font-medium text-white">Processing withdrawal</p>
                <p className="text-sm text-slate-500">
                  Moving your protected vault position back to the bank rail.
                </p>
              </div>
            </div>
            <div className="space-y-3 rounded-2xl bg-slate-950 p-4">
              {withdrawTimeline.map((label, index) => (
                <div key={label} className="flex items-center gap-3 text-sm">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-400/10 text-xs font-semibold text-sky-300">
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
              Done. {amount} TRY was sent to your IBAN.
            </p>
            <div className="mt-2 w-full rounded-2xl bg-slate-950 p-4 text-left">
              {withdrawTimeline.map((label) => (
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
