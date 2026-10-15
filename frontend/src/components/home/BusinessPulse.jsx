import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import StatStrip from "./StatStrip";
import { vendorAPI } from "@/lib/api";
import { num } from "@/lib/formatters";
import { useAuthStore } from "@/stores/authStore";
import { useStockStore } from "@/stores/stockStore";

/**
 * BUSINESS PULSE — how the vendor's own business is doing, in one compact row.
 *
 * This used to be a full-width band of four boxed cards sitting *above* the
 * marketplace, which made a live trade feed open on accountancy. v3.2 keeps the
 * numbers and the same honesty rules, and moves the whole thing down into the
 * "your business" band, with the shop it belongs to:
 *
 *   · every figure is the vendor's own record — listings from the shelf that
 *     was actually read, trades from the movements that are actually open,
 *     links and fulfilment from the vendor row itself;
 *   · a figure that has not loaded says `—` and says why. Nothing is estimated,
 *     and neither the rate nor the counts are ever dressed up as a score;
 *   · each figure is a door into the screen that owns it (shelf, Orders, the
 *     network, analytics), so the row explains and routes at the same time.
 */
export const OPEN_TRADE_STATUSES = ["pending", "confirmed", "shipped", "in_transit"];

export default function BusinessPulse({ headingId = "business-pulse-title", className }) {
  const vendor = useAuthStore((s) => s.vendor);
  const mine = useStockStore((s) => s.mine);
  const mineLoaded = useStockStore((s) => s.mineLoaded);
  const movements = useStockStore((s) => s.movements);
  const fetchMine = useStockStore((s) => s.fetchMine);
  const [connections, setConnections] = useState(null);

  useEffect(() => {
    if (mineLoaded || mine.length) return;
    fetchMine?.().catch(() => {});
  }, [fetchMine, mine.length, mineLoaded]);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data } = await vendorAPI.connections();
        if (live) setConnections(Array.isArray(data) ? data.length : data?.connections?.length ?? 0);
      } catch {
        if (live) setConnections(null);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const shelfKnown = mineLoaded || mine.length > 0;
  const visible = mine.filter((item) => item.visible_to_network).length;
  const openTrades = movements.filter((movement) => OPEN_TRADE_STATUSES.includes(movement.status)).length;
  const fulfilment = vendor?.fulfillment_rate == null ? null : `${Math.round(Number(vendor.fulfillment_rate))}%`;

  const stats = [
    {
      key: "listings",
      label: "Listings live",
      value: shelfKnown ? num(visible) : "—",
      note: !shelfKnown
        ? "reading your shelf"
        : mine.length === 0
          ? "nothing on your shelf yet"
          : `of ${num(mine.length)} on your shelf`,
      to: "/stock",
    },
    {
      key: "trades",
      label: "Open trades",
      value: num(openTrades),
      note: openTrades === 0 ? "nothing waiting on you" : "moving through Orders",
      to: "/orders",
    },
    {
      key: "links",
      label: "Supplier links",
      value: connections == null ? "—" : num(connections),
      note: "recorded connections",
      to: "/network",
    },
    {
      key: "fulfilment",
      label: "Fulfilment",
      value: fulfilment ?? "—",
      note: fulfilment ? "from completed movements" : "no completed trades yet",
      to: "/analytics",
    },
  ];

  return (
    // A landmark with a name, so the row can be reached and announced as "your
    // business today" rather than as four loose numbers in the page flow.
    <div role="region" aria-labelledby={headingId} className={className}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-700 dark:text-brand-300">
            Business pulse
          </p>
          <h2 id={headingId} className="mt-1 text-base font-bold tracking-tight text-ink-1 sm:text-lg">
            Your business today
          </h2>
        </div>
        <Link
          to="/growth"
          className="inline-flex shrink-0 items-center gap-1 rounded px-1 py-0.5 text-micro font-bold text-brand-700 hover:underline underline-offset-2 dark:text-brand-400"
        >
          Growth planner
          <ArrowRight size={11} aria-hidden="true" />
        </Link>
      </div>

      <StatStrip stats={stats} className="mt-3.5" />
    </div>
  );
}
