import { Link } from "react-router-dom";
import { BadgePercent, Briefcase, ChevronRight, Network, Store } from "lucide-react";

/**
 * The four doors into the town-wide network.
 *
 * They sit under the receipt card on Home because each one starts from something
 * the person already did: paid a shop, introduced someone, claimed local work,
 * or runs a shop. None of them is a separate feed.
 */
const DOORS = [
  {
    to: "/receipt-rewards",
    label: "Receipt rewards",
    hint: "Scan in the first 15 minutes. Points are shop-funded, never cash.",
    icon: BadgePercent,
    tint: "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-300",
  },
  {
    to: "/referral-index",
    label: "Referrals",
    hint: "Ride-hailing, coach and local codes. Proof first; sponsored slots are labelled.",
    icon: Network,
    tint: "bg-accent-50 text-accent-700 dark:bg-accent-600/15 dark:text-accent-300",
  },
  {
    to: "/scout",
    label: "Find work",
    hint: "Acquisition, shop checks, delivery and QR jobs. The shop pays you directly.",
    icon: Briefcase,
    tint: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  },
  {
    to: "/merchant",
    label: "For shop owners",
    hint: "Prepaid credit, reward rate, redemptions and demand.",
    icon: Store,
    tint: "bg-brand-100 text-brand-800 dark:bg-brand-500/15 dark:text-brand-300",
  },
];

export default function TownDoors() {
  return (
    <section aria-labelledby="town-doors-heading" className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="town-doors-heading" className="text-sm font-extrabold text-ink-1">Explore your town</h2>
        <span className="text-2xs font-semibold uppercase tracking-wide text-ink-3">Shop-funded</span>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {DOORS.map(({ to, label, hint, icon: Icon, tint }) => (
          <Link
            key={to}
            to={to}
            className="soft-card group rounded-2xl bg-surface-1 p-3 transition-colors hover:bg-surface-2"
          >
            <span className={`grid h-8 w-8 place-items-center rounded-xl ${tint}`}>
              <Icon size={15} aria-hidden="true" />
            </span>
            <p className="mt-2 flex items-center gap-1 text-xs font-extrabold text-ink-1">
              {label}
              <ChevronRight size={12} className="text-ink-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </p>
            <p className="mt-0.5 text-2xs leading-relaxed text-ink-3">{hint}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
