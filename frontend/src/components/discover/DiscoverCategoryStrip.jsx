import { Link } from "react-router-dom";
import { BadgePercent, CalendarDays, Heart, LayoutGrid, Package, Truck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SHOP BY DEPARTMENT.
 *
 * One row of tall picture tiles, not a sentence of pills. Each tile borrows the
 * photograph of a real item already in the feed; when there is no photograph it
 * keeps the category's own icon and tint rather than inventing art. The row
 * scrolls so the first results stay above the fold, and every tile keeps a
 * 44px+ target.
 *
 * The Saved tile is pinned first and is a route, not a filter: saved cards live
 * on this device and never become a public signal.
 */
const CATEGORIES = [
  { key: "all", label: "All", value: "", Icon: LayoutGrid, tone: "from-[#2A1F3D] to-[#4B3568]" },
  { key: "goods", label: "Goods", value: "listing", Icon: Package, tone: "from-[#8A3B22] to-[#D06A3C]", match: (i) => i.kind === "listing" || i.meta?.primary_category === "goods" },
  { key: "services", label: "Services", value: "service", Icon: Truck, tone: "from-[#1F5C4D] to-[#3D9C7C]", match: (i) => ["service", "provider"].includes(i.kind) || i.meta?.primary_category === "service" },
  { key: "rentals", label: "Rentals", value: "rental", Icon: Wrench, tone: "from-[#3E4A57] to-[#75899B]", match: (i) => i.kind === "rental" || i.meta?.primary_category === "rental" },
  { key: "rounds", label: "Rounds", value: "rounds", Icon: CalendarDays, tone: "from-[#6B4B18] to-[#B8862F]", match: (i) => ["scheduled", "event"].includes(i.kind) },
  { key: "spotted", label: "Spotted", value: "spotted", Icon: BadgePercent, tone: "from-[#8A2E0D] to-[#E8552F]", match: (i) => i.feed_kind === "SPOTTED_DEAL" },
];

function photoFor(match, items) {
  if (!match) return null;
  return (items || []).find((item) => match(item) && item.image)?.image || null;
}

export default function DiscoverCategoryStrip({ value, onSelect, savedCount = 0, savedActive = false, items = [] }) {
  return (
    <div
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className="no-scrollbar -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0"
    >
      <Link
        to="/discover/favorites"
        aria-current={savedActive ? "page" : undefined}
        data-testid="discover-saved-pill"
        className="group flex w-[104px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-mk-line bg-mk-card text-center transition-transform hover:-translate-y-0.5"
      >
        <span className={cn(
          "relative flex h-[74px] items-center justify-center bg-gradient-to-br",
          savedActive ? "from-mk-orange to-[#FF9C6E]" : "from-[#F3E7DA] to-[#E8D3BF]",
        )}>
          <span className={cn("grid h-10 w-10 place-items-center rounded-full bg-white/85 shadow-sm", savedActive ? "text-mk-orange" : "text-mk-ink")}>
            <Heart size={18} strokeWidth={2} aria-hidden="true" />
          </span>
          {savedCount > 0 && (
            <span className="absolute right-2 top-2 rounded-full bg-mk-ink px-1.5 py-0.5 text-[10px] font-extrabold text-mk-cream">
              {savedCount}
            </span>
          )}
        </span>
        <span className="px-2 py-2 text-[11px] font-extrabold leading-tight text-mk-ink">
          Saved<span className="sr-only">{savedCount > 0 ? ` ${savedCount} items` : ""}</span>
        </span>
      </Link>

      {CATEGORIES.map(({ key, label, value: categoryValue, Icon, tone, match }) => {
        const active = (value || "") === categoryValue;
        const image = photoFor(match, items);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : categoryValue)}
            data-testid={categoryValue && categoryValue !== "rounds" && categoryValue !== "spotted" ? `explore-kind-${categoryValue}` : `discover-category-${key}`}
            data-category={key}
            className={cn(
              "group flex w-[104px] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border bg-mk-card text-center transition-transform hover:-translate-y-0.5",
              active ? "border-mk-orange ring-2 ring-mk-orange/25" : "border-mk-line",
            )}
          >
            <span className={cn("relative flex h-[74px] items-center justify-center overflow-hidden bg-gradient-to-br", tone)}>
              {image ? (
                <>
                  <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover" />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/45 via-black/10 to-transparent" aria-hidden="true" />
                </>
              ) : null}
              <span className="relative grid h-9 w-9 place-items-center rounded-full bg-white/90 text-mk-ink shadow-sm">
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
              </span>
            </span>
            <span className={cn("px-2 py-2 text-[11px] font-extrabold leading-tight", active ? "text-mk-orange" : "text-mk-ink")}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
