import { AlertTriangle } from "lucide-react";

const DISCLOSURES = [
  "Testnet demo — no real money at risk",
  "Product claim today: inflation shield (USD) + FAST/IBAN on-ramp — not yield",
  "No APY is shown or implied; DeFindex holds the position for future real yield",
  "Bank/KYC side of the anchor rail is simulated; the Stellar side is real testnet",
  "The DeFindex vault is a third-party protocol; LiraShield does not audit it",
  "Not investment advice — hackathon demo only",
];

/** Small, professional disclosure panel establishing trust/maturity for a financial-product demo. */
export function RiskDisclosurePanel() {
  return (
    <section className="rounded-3xl border border-amber-500/20 bg-amber-500/5 p-5">
      <div className="mb-3 flex items-center gap-2">
        <AlertTriangle className="text-amber-300" size={18} />
        <div>
          <h2 className="font-semibold text-white">Risk and transparency</h2>
          <p className="text-sm text-slate-500">
            What we claim today: dollar shield + bank rail — not fake APY.
          </p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {DISCLOSURES.map((item) => (
          <li
            key={item}
            className="flex items-start gap-2 text-sm text-slate-300"
          >
            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-amber-300" />
            {item}
          </li>
        ))}
      </ul>
    </section>
  );
}
