"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDownToLine,
  ArrowUpRight,
  BanknoteArrowDown,
  ChevronRight,
  CircleCheck,
  Landmark,
  Settings,
  ShieldCheck,
  Vault,
} from "lucide-react";
import { FastDepositModal } from "@/components/FastDepositModal";
import { FastWithdrawModal } from "@/components/FastWithdrawModal";
import { ProofPanel } from "@/components/ProofPanel";
import { RiskDisclosurePanel } from "@/components/RiskDisclosurePanel";
import { BalanceReconciliationPanel } from "@/components/BalanceReconciliationPanel";
import { YieldEstimateCard } from "@/components/YieldEstimateCard";
import { SettingsMenu } from "@/components/SettingsMenu";
import { ActivityDrawer } from "@/components/ActivityDrawer";
import { ConnectedAccountPanel } from "@/components/ConnectedAccountPanel";
import { DashboardSkeleton } from "@/components/DashboardSkeleton";
import { RoutePreview } from "@/components/RoutePreview";
import { useToast } from "@/components/ToastProvider";
import { getUserPosition, type UserPositionView } from "@/lib/soroban-client";
import {
  ANCHOR_MODE,
  getFastBridgeAddress,
  MOCK_TRY_PER_USDC_RATE,
} from "@/lib/anchor-sep";
import { formatTry, formatUsd } from "@/lib/format";
import { scaledAmountToNumber } from "@/lib/stellar";
import {
  clearTransactionHistory,
  loadTransactionHistory,
  protectedTryBalanceFromHistory,
  saveTransactionHistory,
  type TransactionHistoryItem,
} from "@/lib/transaction-history";

export default function DashboardPage() {
  const router = useRouter();
  const { pushToast } = useToast();
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [vaultAddress, setVaultAddress] = useState<string | null>(null);
  const [walletChecked, setWalletChecked] = useState(false);
  const [passkeyConnected, setPasskeyConnected] = useState(false);
  const [position, setPosition] = useState<UserPositionView | null>(null);
  const [loading, setLoading] = useState(true);
  const [depositOpen, setDepositOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [history, setHistory] = useState<TransactionHistoryItem[]>([]);
  const [selectedActivity, setSelectedActivity] =
    useState<TransactionHistoryItem | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage read after mount, avoids SSR hydration mismatch
    setWalletAddress(window.localStorage.getItem("lirashield.walletAddress"));
    setPasskeyConnected(
      !!window.localStorage.getItem("lirashield.passkeyKeyId") ||
        !!window.localStorage.getItem("lirashield.walletAddress"),
    );
    setWalletChecked(true);

    const authToast = window.sessionStorage.getItem("lirashield.authToast");
    if (authToast) {
      window.sessionStorage.removeItem("lirashield.authToast");
      pushToast(authToast);
    }
  }, [pushToast]);

  useEffect(() => {
    if (walletChecked && !walletAddress) {
      router.replace("/login");
    }
  }, [router, walletChecked, walletAddress]);

  async function refreshPosition(address: string) {
    setLoading(true);
    try {
      const result = await getUserPosition(address);
      setPosition(result);
    } catch {
      setPosition(null);
    } finally {
      setLoading(false);
      setLastSyncedAt(new Date());
    }
  }

  useEffect(() => {
    let cancelled = false;
    if (!walletAddress) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only localStorage history hydration after wallet restore
    setHistory(loadTransactionHistory(walletAddress));
    getFastBridgeAddress()
      .then((address) => {
        if (cancelled) return;
        setVaultAddress(address);
        refreshPosition(address);
      })
      .catch(() => {
        if (!cancelled) {
          setVaultAddress(null);
          setLoading(false);
          setLastSyncedAt(new Date());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  function recordHistory(item: TransactionHistoryItem) {
    if (!walletAddress) return;
    const next = [item, ...history].slice(0, 12);
    setHistory(next);
    saveTransactionHistory(walletAddress, next);
  }

  function handleLogout() {
    window.localStorage.removeItem("lirashield.walletAddress");
    window.localStorage.removeItem("lirashield.passkeyKeyId");
    router.push("/login");
  }

  function handleClearHistory() {
    if (!walletAddress) return;
    clearTransactionHistory(walletAddress);
    setHistory([]);
    setSettingsOpen(false);
    pushToast("Transaction history cleared");
  }

  function handleResetView() {
    setSettingsOpen(false);
    setDepositOpen(false);
    setWithdrawOpen(false);
    if (vaultAddress) refreshPosition(vaultAddress);
  }

  const initialLoading = !walletChecked || (!!walletAddress && lastSyncedAt === null);

  if (initialLoading) {
    return <DashboardSkeleton />;
  }

  if (!walletAddress) {
    return null;
  }

  const tryValue = Math.max(0, protectedTryBalanceFromHistory(history));
  const uiApproxUsd = tryValue / MOCK_TRY_PER_USDC_RATE;
  const onChainUsd =
    position && position.estimatedUsdcValue > BigInt(0)
      ? scaledAmountToNumber(position.estimatedUsdcValue)
      : 0;
  const hasOnChainPosition = !!position && position.usdcShares > BigInt(0);
  const usdValue = hasOnChainPosition ? onChainUsd : uiApproxUsd;
  const usdSource: "on-chain" | "ui-approx" | "none" = hasOnChainPosition
    ? "on-chain"
    : tryValue > 0
      ? "ui-approx"
      : "none";
  const canWithdraw = hasOnChainPosition || tryValue > 0;
  const lastTxHash = history.find((item) => item.txHash)?.txHash ?? null;
  const positionStatus = loading
    ? "Syncing"
    : hasOnChainPosition
      ? "Active"
      : "Ready";
  const routeSteps = ["TRY", "USDC", "Vault", "IBAN"];
  const systemStatus = [
    { label: "Passkey sign-in", value: "Connected" },
    { label: "FAST bridge", value: vaultAddress ? "Ready" : "Preparing" },
    { label: "Soroban vault", value: loading ? "Syncing" : "Live" },
    { label: "Dollar shield", value: positionStatus },
  ];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8 sm:gap-8 sm:px-6 sm:py-10">
      {settingsOpen && (
        <button
          className="fixed inset-0 z-20 bg-black/40"
          onClick={() => setSettingsOpen(false)}
          aria-label="Close settings"
        />
      )}

      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300">
            <ShieldCheck size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-white sm:text-2xl">
              LiraShield
            </h1>
            <p className="truncate text-sm text-slate-400">
              Inflation shield + FAST / IBAN on-ramp
            </p>
          </div>
        </div>
        <div className="relative shrink-0">
          <button
            onClick={() => setSettingsOpen((value) => !value)}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-800 bg-slate-900 text-slate-300 transition hover:bg-slate-800"
            aria-label="Open settings"
          >
            <Settings size={17} />
          </button>
          {settingsOpen && (
            <SettingsMenu
              walletAddress={walletAddress}
              vaultAddress={vaultAddress}
              anchorMode={ANCHOR_MODE}
              hasHistory={history.length > 0}
              onClearHistory={handleClearHistory}
              onResetView={handleResetView}
              onLogout={handleLogout}
            />
          )}
        </div>
      </header>

      <ConnectedAccountPanel
        walletAddress={walletAddress}
        vaultAddress={vaultAddress}
        passkeyConnected={passkeyConnected}
        protectedActive={hasOnChainPosition || tryValue > 0}
      />

      <section className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-2xl shadow-black/20 sm:p-6">
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div>
            <div className="mb-6 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">
              <CircleCheck size={15} /> Dollar shield active
            </div>
            <p className="text-sm text-slate-400">Protected TRY (approx)</p>
            {loading ? (
              <div className="mt-3 h-12 w-48 animate-pulse rounded-2xl bg-slate-800" />
            ) : (
              <p className="mt-2 text-4xl font-semibold text-white sm:text-5xl">
                {formatTry(tryValue)}
              </p>
            )}
            <p className="mt-3 text-sm text-slate-400">
              Dollar shield{" "}
              <span className="font-medium text-white">{formatUsd(usdValue)}</span>
              {usdSource === "on-chain"
                ? " · on-chain DeFindex estimate"
                : usdSource === "ui-approx"
                  ? " · approx from activity history"
                  : ""}
              . Withdraw to IBAN anytime. No APY claimed on testnet.
            </p>
            <p className="mt-1 text-xs text-slate-600">
              TRY figure is from this browser&apos;s activity history; USD prefers
              the live vault position when shares are present.
            </p>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                onClick={() => vaultAddress && setDepositOpen(true)}
                disabled={!vaultAddress}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ArrowDownToLine size={18} /> Deposit TRY
              </button>
              <button
                onClick={() => vaultAddress && setWithdrawOpen(true)}
                disabled={!vaultAddress || !canWithdraw}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl border border-slate-700 bg-slate-950 px-5 py-3 font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <BanknoteArrowDown size={18} /> Withdraw to IBAN
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                On-chain position
              </p>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  {loading ? (
                    <div className="h-8 w-24 animate-pulse rounded-xl bg-slate-800" />
                  ) : (
                    <p className="text-2xl font-semibold text-white">
                      {positionStatus}
                    </p>
                  )}
                  <p className="text-sm text-slate-500">
                    {hasOnChainPosition
                      ? formatUsd(onChainUsd)
                      : "USD vault (DeFindex)"}
                  </p>
                </div>
                <Vault className="text-sky-300" size={28} />
              </div>
            </div>
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-4">
              <p className="text-xs uppercase tracking-[0.16em] text-slate-500">
                Bank rail
              </p>
              <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="text-2xl font-semibold text-white">FAST</p>
                  <p className="text-sm text-slate-500">On / off-ramp</p>
                </div>
                <Landmark className="text-emerald-300" size={28} />
              </div>
            </div>
            <YieldEstimateCard
              usdValue={usdValue}
              source={usdSource}
              loading={loading}
              active={!loading && (hasOnChainPosition || tryValue > 0)}
            />
          </div>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.35fr_1fr]">
        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-semibold text-white">Shield + on-ramp route</h2>
              <p className="text-sm text-slate-500">
                Bank flow in front; USD protection on Stellar behind it.
              </p>
            </div>
            <ArrowUpRight className="shrink-0 text-slate-500" size={18} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {routeSteps.map((step, index) => (
              <div
                key={step}
                className="rounded-2xl border border-slate-800 bg-slate-950 p-4"
              >
                <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/10 text-sm font-semibold text-emerald-300">
                  {index + 1}
                </div>
                <p className="font-semibold text-white">{step}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {index === 0 && "FAST on-ramp"}
                  {index === 1 && "Dollar shield"}
                  {index === 2 && "On-chain position"}
                  {index === 3 && "FAST off-ramp"}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
          <h2 className="font-semibold text-white">Demo status</h2>
          <div className="mt-4 space-y-3">
            {systemStatus.map((item) => (
              <div
                key={item.label}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-sm text-slate-400">{item.label}</span>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-300">
                  {item.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <ProofPanel lastTxHash={lastTxHash} />

      <section className="grid gap-6 lg:grid-cols-2">
        <BalanceReconciliationPanel
          protectedTryDisplay={formatTry(tryValue)}
          onChainUsdDisplay={
            hasOnChainPosition ? formatUsd(onChainUsd) : formatUsd(0)
          }
          vaultConfigured={!!vaultAddress}
          positionActive={hasOnChainPosition}
          loading={loading}
          lastSyncedAt={lastSyncedAt}
        />
        <RiskDisclosurePanel />
      </section>

      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold text-white">Transaction history</h2>
            <p className="text-sm text-slate-500">
              Completed shield and rail flows
            </p>
          </div>
          {history.length > 0 ? (
            <button
              onClick={handleClearHistory}
              className="shrink-0 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400 transition hover:border-red-400/60 hover:text-red-300"
            >
              Clear history
            </button>
          ) : (
            <span className="shrink-0 rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-400">
              Recent activity
            </span>
          )}
        </div>
        {history.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950 p-6">
            <h3 className="text-lg font-semibold text-white">
              Shield your TRY in dollars
            </h3>
            <p className="mt-2 max-w-md text-sm text-slate-400">
              Deposit TRY via FAST; it becomes a USD-protected balance on-chain.
              Withdraw to IBAN when you need cash. We do not claim APY on
              testnet.
            </p>
            <div className="mt-4">
              <RoutePreview steps={["FAST", "USDC", "Vault"]} compact />
            </div>
            <button
              onClick={() => vaultAddress && setDepositOpen(true)}
              disabled={!vaultAddress}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-emerald-400 px-5 py-3 font-semibold text-slate-950 transition hover:bg-emerald-300 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ArrowDownToLine size={18} /> Deposit TRY
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-800">
            {history.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedActivity(item)}
                className="flex w-full flex-col gap-2 py-4 text-left text-sm transition hover:bg-slate-950/80 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div
                    className={
                      item.type === "deposit"
                        ? "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300"
                        : "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-sky-400/10 text-sky-300"
                    }
                  >
                    {item.type === "deposit" ? (
                      <ArrowDownToLine size={18} />
                    ) : (
                      <BanknoteArrowDown size={18} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-white">
                        {item.type === "deposit"
                          ? "TRY deposit protected"
                          : "IBAN withdrawal completed"}
                      </p>
                      <span className="rounded-full bg-emerald-400/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
                        Completed
                      </span>
                    </div>
                    <p className="mt-1 truncate text-slate-500">{item.detail}</p>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 pl-[3.25rem] sm:pl-0">
                  <div className="text-left sm:text-right">
                    <p
                      className={
                        item.type === "deposit"
                          ? "font-semibold text-emerald-400"
                          : "font-semibold text-sky-400"
                      }
                    >
                      {item.type === "deposit" ? "+" : "-"}
                      {formatTry(item.tryAmount)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(item.createdAt).toLocaleTimeString("en-US", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <ChevronRight className="shrink-0 text-slate-600" size={16} />
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      <ActivityDrawer
        item={selectedActivity}
        onClose={() => setSelectedActivity(null)}
      />

      {vaultAddress && (
        <FastDepositModal
          open={depositOpen}
          onClose={() => setDepositOpen(false)}
          userAddress={vaultAddress}
          currentTryBalance={tryValue}
          onDeposited={(item) => {
            recordHistory(item);
            refreshPosition(vaultAddress);
            pushToast("Protected balance updated");
          }}
        />
      )}
      {vaultAddress && (
        <FastWithdrawModal
          open={withdrawOpen}
          onClose={() => setWithdrawOpen(false)}
          userAddress={vaultAddress}
          protectedTryBalance={tryValue}
          position={position}
          onWithdrawn={(item) => {
            recordHistory(item);
            refreshPosition(vaultAddress);
            pushToast("IBAN payout completed");
          }}
        />
      )}
    </main>
  );
}
