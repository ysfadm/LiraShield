/** Compact TRY display used in previews, drawers and account copy. */
export function formatTry(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const safe = Number.isFinite(value) ? value : 0;
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(safe % 1) > 0 ? 2 : 0,
  }).format(safe);
  return `₺${formatted}`;
}

export function formatUsd(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(safe);
}

export function shortenAddress(value: string, head = 6, tail = 4): string {
  if (!value) return "Not set";
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function depositRouteLabel(): string {
  return "FAST → USDC → DeFindex";
}

export function withdrawRouteLabel(): string {
  return "DeFindex → USDC → IBAN";
}
