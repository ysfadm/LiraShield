import { NextRequest, NextResponse } from "next/server";

/**
 * Simulates the bank/FAST leg of a SEP-24 withdrawal: the on-chain TRY has
 * already left the user's wallet via the vault's `withdraw_to_lira` call; this
 * route only represents the anchor's off-chain IBAN payout confirmation,
 * since that leg is never itself an on-chain operation.
 */
export async function POST(request: NextRequest) {
  const { userAddress, tryAmount, iban } = await request.json();

  if (
    typeof userAddress !== "string" ||
    typeof tryAmount !== "string" ||
    typeof iban !== "string"
  ) {
    return NextResponse.json(
      { error: "userAddress, tryAmount and iban are required" },
      { status: 400 },
    );
  }

  if (!/^TR\d{24}$/.test(iban.replace(/\s+/g, ""))) {
    return NextResponse.json({ error: "invalid IBAN format" }, { status: 400 });
  }

  return NextResponse.json({
    transactionId: `mock-withdraw-${Date.now()}`,
    status: "completed",
  });
}
