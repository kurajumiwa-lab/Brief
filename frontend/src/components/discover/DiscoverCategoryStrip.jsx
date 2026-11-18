import { Link } from "react-router-dom";
import { BadgePercent, CalendarDays, Heart, LayoutGrid, Package, Truck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * VISUAL CATEGORY STRIP.
 *
 * One row of icon tiles, not a sentence of pills. The row scrolls rather than
 * wraps so the first results keep their place above the fold; every tile keeps
 * a 58x64 px target. The Saved tile is pinned first and is a route, not a
 * filter: saved cards live on this device and never become a public signal.
 */
const CATEGORIES = [
  { key: "all", label: "All", value: "", Icon: LayoutGrid, tone: "bg-surface-2 text-ink-2 dark:bg-surface-3 dark:text-ink-2" },
  { key: "goods", label: "Goods", value: "listing", Icon: Package, tone: "bg-[#E8F2EC] text-[#276A49] dark:bg-[#17332A] dark:text-[#A9D9BF]" },
  { key: "services", label: "Services", value: "service", Icon: Truck, tone: "bg-[#E6EFEA] text-[#2F6650] dark:bg-[#16302A] dark:text-[#A6D3BF]" },
  { key: "rentals", label: "Rentals", value: "rental", Icon: Wrench, tone: "bg-[#F1F3F2] text-[#4A6259] dark:bg-[#202A26] dark:text-[#BDCCC5]" },
  { key: "rounds", label: "Rounds", value: "rounds", Icon: CalendarDays, tone: "bg-[#F6F1E8] text-[#7A5A22] dark:bg-[#2E2718] dark:text-[#E6C98E]" },
  { key: "spotted", label: "Spotted", value: "spotted", Icon: BadgePercent, tone: "bg-hot-soft text-hot" },
];

export default function DiscoverCategoryStrip({ value, onSelect, savedCount = 0, savedActive = false }) {
  return (
    <div
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className="no-scrollbar -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <Link
        to="/discover/favorites"
        aria-current={savedActive ? "page" : undefined}
        data-testid="discover-saved-pill"
        className={cn(
          "flex min-h-[64px] w-[62px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 transition-colors",
          savedActive
            ? "border-brand-700 bg-brand-700 text-white"
            : "border-edge-1 bg-surface-1 text-ink-2 hover:border-edge-3",
        )}
      >
        <span className={cn("grid h-8 w-8 place-items-center rounded-full", savedActive ? "bg-white/15 text-white" : "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300")}>
          <Heart size={15} strokeWidth={2} aria-hidden="true" />
        </span>
        <span className="text-micro font-bold leading-none">Saved{savedCount > 0 ? ` ${savedCount}` : ""}</span>
      </Link>

      {CATEGORIES.map(({ key, label, value: categoryValue, Icon, tone }) => {
        const active = (value || "") === categoryValue;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : categoryValue)}
            data-testid={categoryValue && categoryValue !== "rounds" && categoryValue !== "spotted" ? `explore-kind-${categoryValue}` : `discover-category-${key}`}
            data-category={key}
            className={cn(
              "flex min-h-[64px] w-[62px] shrink-0 snap-start flex-col items-center justify-center gap-1 rounded-xl border px-1 py-1.5 transition-colors",
              active ? "border-brand-700 bg-brand-700 text-white" : "border-edge-1 bg-surface-1 text-ink-2 hover:border-edge-3",
            )}
          >
            <span className={cn("grid h-8 w-8 place-items-center rounded-full", active ? "bg-white/15 text-white" : tone)}>
              <Icon size={15} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="text-micro font-bold leading-none">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
