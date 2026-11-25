import { useId } from "react";
import { Link } from "react-router-dom";
import {
  BadgePercent, CalendarDays, Heart, LayoutGrid, Package, Truck, Wrench,
} from "lucide-react";
import { categoryCounts } from "@/lib/regionMetrics";
import { cn } from "@/lib/utils";

/**
 * CATEGORY NAVIGATION — one shape, one size, one count.
 *
 * The old strip was a row of tall picture tiles: a photographic background
 * borrowed from whatever item happened to match, a gradient that meant
 * something different on every tile, a "Saved" tile that looked like a
 * category but was a device-local shortcut, and a horizontal scroll that hid
 * half of them on a phone. The review called it crowded and inconsistent, and
 * it was both.
 *
 * What replaced it is deliberately plain:
 *
 *   · ONE card shape. Same padding, same radius, same icon plate, same label
 *     position, for every category. The only thing that changes is the accent
 *     ring on the selected one.
 *   · A WRAPPING GRID, not a carousel. Every category is visible without a
 *     swipe, which is what a person scanning for "rentals" needs.
 *   · COUNTS THAT ARE TRUE. A card shows how many of the loaded records are
 *     its kind — and shows nothing at all when the results have not loaded, so
 *     a quiet region never reads as an empty one.
 */
const CATEGORIES = [
  { key: "all", label: "All", value: "", Icon: LayoutGrid, tone: "brand" },
  { key: "goods", label: "Goods", value: "listing", Icon: Package, tone: "goods" },
  { key: "services", label: "Services", value: "service", Icon: Truck, tone: "services" },
  { key: "rentals", label: "Rentals", value: "rental", Icon: Wrench, tone: "rentals" },
  { key: "rounds", label: "Rounds", value: "rounds", Icon: CalendarDays, tone: "rounds" },
  { key: "spotted", label: "Spotted", value: "spotted", Icon: BadgePercent, tone: "spotted" },
];

const TONES = {
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
  goods: "bg-cat-goods/15 text-cat-goods-text",
  services: "bg-cat-services/15 text-cat-services-text",
  rentals: "bg-cat-rentals/15 text-cat-rentals-text",
  rounds: "bg-cat-events/15 text-cat-events-text",
  spotted: "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-300",
};

export default function CategoryNav({
  value,
  onSelect,
  savedCount = 0,
  savedActive = false,
  items = [],
  countsKnown = false,
  className,
}) {
  const counts = countsKnown ? categoryCounts(items) : null;
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <ul
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className={cn("grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6", className)}
    >
      {CATEGORIES.map(({ key, label, value: categoryValue, Icon, tone }) => {
        const active = (value || "") === categoryValue;
        const count = counts ? counts[key] : null;
        const countId = `${idBase}-count-${key}`;
        return (
          <li key={key} className="min-w-0">
            <button
              type="button"
              aria-pressed={active}
              aria-describedby={count != null && count > 0 ? countId : undefined}
              onClick={() => onSelect(active ? "" : categoryValue)}
              data-testid={
                categoryValue && categoryValue !== "rounds" && categoryValue !== "spotted"
                  ? `explore-kind-${categoryValue}`
                  : `discover-category-${key}`
              }
              data-category={key}
              className={cn(
                "group flex h-full min-h-[92px] w-full flex-col items-start gap-2 rounded-2xl border bg-mk-card p-3 text-left transition-colors",
                active
                  ? "border-mk-orange ring-2 ring-mk-orange/40"
                  : "border-mk-line hover:border-mk-ink/30",
              )}
            >
              <span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", TONES[tone])}>
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </span>
              <span className="flex w-full items-baseline justify-between gap-1">
                <span className="truncate text-xs font-extrabold text-mk-ink">{label}</span>
                {count != null && count > 0 && (
                  <span
                    aria-hidden="true"
                    data-testid={`explore-category-count-${key}`}
                    className="shrink-0 text-2xs font-bold tabular-nums text-mk-ink-soft"
                  >
                    {count}
                  </span>
                )}
              </span>
            </button>
            {count != null && count > 0 && (
              <span id={countId} className="sr-only">
                {count} of the loaded results
              </span>
            )}
          </li>
        );
      })}

      <li className="min-w-0">
        <Link
          to="/discover/favorites"
          aria-current={savedActive ? "page" : undefined}
          data-testid="discover-saved-pill"
          className={cn(
            "group flex h-full min-h-[92px] w-full flex-col items-start gap-2 rounded-2xl border bg-mk-card p-3 text-left transition-colors",
            savedActive ? "border-mk-orange ring-2 ring-mk-orange/40" : "border-mk-line hover:border-mk-ink/30",
          )}
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-mk-warm text-mk-ink-soft">
            <Heart size={16} strokeWidth={2} aria-hidden="true" />
          </span>
          <span className="flex w-full items-baseline justify-between gap-1">
            <span className="truncate text-xs font-extrabold text-mk-ink">Saved</span>
            {savedCount > 0 && (
              <span
                data-testid="discover-saved-count"
                className="shrink-0 text-2xs font-bold tabular-nums text-mk-ink-soft"
              >
                {savedCount}
              </span>
            )}
          </span>
        </Link>
      </li>
    </ul>
  );
}
