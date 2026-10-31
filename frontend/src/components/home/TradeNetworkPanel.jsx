import { Link } from "react-router-dom";
import { ArrowRight, Cpu, Factory, Package, Truck, Wrench } from "lucide-react";

/**
 * EXPLORE THE TRADE NETWORK — the category panel that replaces the shelf.
 * ---------------------------------------------------------------------------
 * What it replaced: a nine-tile strip labelled "Browse the shelves" whose first
 * three tiles read *Online services · Farms · Your category*. Whatever the rest
 * of the product was, that opening line said agricultural platform, and a school
 * looking for an electrician read it as somebody else's website.
 *
 * The five categories below are **doors, not a taxonomy**: each one lands on a
 * results screen that already exists and already has results in it. Nothing is
 * counted, because a count that is wrong is worse than no count.
 *
 * The last line matters as much as the rows: these are *starting* categories.
 * A trade that does not appear here is not excluded — it is a shelf someone has
 * not opened yet, and `/create` lets them open it.
 */

const CATEGORIES = [
  {
    to: "/browse?type=services",
    title: "Technology and digital services",
    body: "IT support, software, electronics, networking and digital solutions.",
    icon: Cpu,
  },
  {
    to: "/browse?type=goods",
    title: "Manufacturing and fabrication",
    body: "Producers, fabricators, workshops and industrial suppliers.",
    icon: Factory,
  },
  {
    to: "/browse?type=people",
    title: "Skilled trades and technical work",
    body: "Electricians, plumbers, mechanics, installers and artisans.",
    icon: Wrench,
  },
  {
    to: "/browse?type=equipment",
    title: "Products and equipment",
    body: "Office equipment, furniture, hardware, tools and supplies.",
    icon: Package,
  },
  {
    to: "/tools",
    title: "Business and operational services",
    body: "Transport, logistics, cleaning, security and maintenance.",
    icon: Truck,
  },
];

export default function TradeNetworkPanel({ className = "" }) {
  return (
    <section
      aria-labelledby="trade-network-heading"
      data-testid="trade-network-panel"
      className={`overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 ${className}`}
    >
      <div className="flex items-baseline justify-between gap-2 px-4 pb-1 pt-4">
        <h2 id="trade-network-heading" className="text-sm font-bold tracking-tight text-ink-1">
          Explore the trade network
        </h2>
        <Link
          to="/explore"
          className="rounded text-micro font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          Everything
        </Link>
      </div>

      <ul className="divide-y divide-edge-1">
        {CATEGORIES.map(({ to, title, body, icon: Icon }) => (
          <li key={title}>
            <Link
              to={to}
              className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2 focus:outline-none focus-visible:bg-surface-2"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
                <Icon size={19} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold leading-tight text-ink-1">{title}</span>
                <span className="mt-0.5 block text-micro leading-snug text-ink-3">{body}</span>
              </span>
              <ArrowRight
                size={15}
                className="shrink-0 text-tech-600 transition-transform group-hover:translate-x-0.5 dark:text-tech-400"
                aria-hidden="true"
              />
            </Link>
          </li>
        ))}
      </ul>

      <p className="border-t border-edge-1 bg-surface-2/60 px-4 py-2.5 text-micro leading-relaxed text-ink-3">
        Starting categories, not restrictions. A trade that is not listed here can still open a
        shelf — that is what{" "}
        <Link to="/create" className="font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400">
          Create
        </Link>{" "}
        is for.
      </p>
    </section>
  );
}
