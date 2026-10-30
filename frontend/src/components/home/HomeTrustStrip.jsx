import { BadgeCheck, FileCheck2, Scale, ShieldCheck } from "lucide-react";

/**
 * THE TRUST STRIP — four facts, in a row, under the hero.
 *
 * Both reference designs open with a band of icon-and-label assurances
 * ("Verified Experts · Genuine Parts · Upfront Pricing…"). It works because it
 * answers the question a first-time buyer actually has before they will search
 * anything: *who am I dealing with, and what happens if it goes wrong?*
 *
 * The rule here is that **every claim has to be true of this product right
 * now**, and each one is already stated somewhere in Brief:
 *
 *   · Verified businesses — `vendors.is_verified` and the verification routes.
 *   · Prices the vendor stated — prices are vendor-declared, never estimated.
 *   · A record for every trade — the order/ledger model.
 *   · Money that never sits with us — non-custodial settlement.
 *
 * No numbers, no "10K+ happy customers", no star ratings pulled from nothing.
 * An assurance band that inflates is worse than no assurance band: it is the
 * first thing a person catches you lying about.
 */

const FACTS = [
  { icon: BadgeCheck, label: "Verified businesses" },
  { icon: Scale, label: "Prices the vendor stated" },
  { icon: FileCheck2, label: "A record for every trade" },
  { icon: ShieldCheck, label: "Payments stay yours" },
];

export default function HomeTrustStrip({ className = "" }) {
  return (
    <ul
      aria-label="What this network guarantees"
      data-testid="home-trust-strip"
      className={`grid grid-cols-2 gap-x-2 gap-y-2 rounded-2xl border border-edge-1 bg-surface-1 px-2.5 py-2.5 sm:grid-cols-4 ${className}`}
    >
      {FACTS.map(({ icon: Icon, label }) => (
        <li key={label} className="flex items-center gap-1.5 px-1">
          <Icon size={13} className="shrink-0 text-brand-700 dark:text-brand-400" aria-hidden="true" />
          <span className="text-micro font-semibold leading-tight text-ink-2">{label}</span>
        </li>
      ))}
    </ul>
  );
}
