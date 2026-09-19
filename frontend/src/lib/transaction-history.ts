export type TransactionHistoryType = "deposit" | "withdraw";

export interface TransactionHistoryItem {
  id: string;
  type: TransactionHistoryType;
  tryAmount: string;
  detail: string;
  createdAt: string;
  txHash?: string | null;
  /** Per-protocol-step receipts (FAST rail, Soroswap route, USD vault, anchor payout). */
  steps?: string[];
}

/** Default step receipts recorded for a completed deposit flow. */
export const DEPOSIT_STEP_RECEIPTS = [
  "FAST on-ramp completed",
  "Soroswap route completed",
  "USD vault deposit completed",
];

/** Default step receipts recorded for a completed withdraw flow. */
export const WITHDRAW_STEP_RECEIPTS = [
  "USD vault unlock completed",
  "Soroswap route completed",
  "IBAN / FAST payout completed",
];

function historyKey(walletAddress: string): string {
  return `lirashield.txHistory.${walletAddress}`;
}

export function loadTransactionHistory(
  walletAddress: string,
): TransactionHistoryItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(historyKey(walletAddress));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveTransactionHistory(
  walletAddress: string,
  items: TransactionHistoryItem[],
): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(historyKey(walletAddress), JSON.stringify(items));
}

export function clearTransactionHistory(walletAddress: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(historyKey(walletAddress));
}

export function createTransactionHistoryItem(
  type: TransactionHistoryType,
  tryAmount: string,
  detail: string,
  txHash?: string | null,
  steps?: string[],
): TransactionHistoryItem {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    tryAmount,
    detail,
    txHash,
    steps:
      steps ??
      (type === "deposit" ? DEPOSIT_STEP_RECEIPTS : WITHDRAW_STEP_RECEIPTS),
    createdAt: new Date().toISOString(),
  };
}

export function protectedTryBalanceFromHistory(
  items: TransactionHistoryItem[],
): number {
  return items.reduce((balance, item) => {
    const amount = Number(item.tryAmount);
    if (!Number.isFinite(amount)) return balance;
    return item.type === "deposit" ? balance + amount : balance - amount;
  }, 0);
}
