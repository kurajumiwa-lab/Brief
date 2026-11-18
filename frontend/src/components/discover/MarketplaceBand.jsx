import { Link } from "react-router-dom";
import { ArrowRight, Package, Store, Wrench } from "lucide-react";

const DOORS = [
  { Icon: Store, eyebrow: "Sellers", label: "Start selling", to: "/create?type=available&ledger=1" },
  { Icon: Wrench, eyebrow: "Services", label: "Offer a service", to: "/create?type=available&ledger=1" },
  { Icon: Package, eyebrow: "Wholesale", label: "Stock up for less", to: "/regions?kind=listing" },
];

/** The dark conversion band at the foot of the shopfront. */
export default function MarketplaceBand() {
  return (
    <section
      aria-labelledby="discover-band-heading"
      className="relative overflow-hidden rounded-3xl bg-mk-ink px-5 py-8 text-mk-cream sm:py-10"
    >
      <span className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-mk-orange/20 blur-3xl" aria-hidden="true" />
      <p className="text-center text-[10px] font-extrabold uppercase tracking-[0.2em] text-mk-orange">More than a shop</p>
      <h2 id="discover-band-heading" className="mt-2 text-center text-3xl font-black tracking-tight sm:text-4xl">
        Buy. Resell. Supply.
      </h2>
      <div className="mx-auto mt-6 grid max-w-2xl gap-2.5 sm:grid-cols-3">
        {DOORS.map(({ Icon, eyebrow, label, to }) => (
          <Link
            key={label}
            to={to}
            className="group flex items-center gap-3 rounded-2xl border border-white/12 bg-white/5 px-4 py-3 transition-colors hover:border-mk-orange/60 hover:bg-white/10"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-mk-orange/20 text-mk-orange">
              <Icon size={17} aria-hidden="true" />
            </span>
            <span className="min-w-0 text-left">
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.16em] text-mk-cream/55">{eyebrow}</span>
              <span className="block truncate text-sm font-extrabold text-mk-cream">{label}</span>
            </span>
            <ArrowRight size={13} className="ml-auto shrink-0 text-mk-cream/50 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
          </Link>
        ))}
      </div>
    </section>
  );
}
