import { Link } from "react-router-dom";
import { BadgePercent, CalendarDays, Heart, LayoutGrid, Package, Truck, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";
import { photoUrl } from "@/lib/photos";

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
  { key: "all", label: "All", value: "", Icon: LayoutGrid, tone: "from-brand-700 to-brand-500", subject: "banner-street" },
  { key: "goods", label: "Goods", value: "listing", Icon: Package, tone: "from-cat-goods-text to-cat-goods", match: (i) => i.kind === "listing" || i.meta?.primary_category === "goods" , subject: "commerce-street" },
  { key: "services", label: "Services", value: "service", Icon: Truck, tone: "from-cat-services-text to-cat-services", match: (i) => ["service", "provider"].includes(i.kind) || i.meta?.primary_category === "service" , subject: "work-technician" },
  { key: "rentals", label: "Rentals", value: "rental", Icon: Wrench, tone: "from-cat-rentals-text to-cat-rentals", match: (i) => i.kind === "rental" || i.meta?.primary_category === "rental" , subject: "commerce-city" },
  { key: "rounds", label: "Rounds", value: "rounds", Icon: CalendarDays, tone: "from-cat-events-text to-cat-events", match: (i) => ["scheduled", "event"].includes(i.kind) , subject: "culture-conference" },
  { key: "spotted", label: "Spotted", value: "spotted", Icon: BadgePercent, tone: "from-accent-700 to-accent-400", match: (i) => i.feed_kind === "SPOTTED_DEAL" , subject: "commerce-traffic" },
];

/**
 * A real photograph of a real item in this category wins; the library subject is
 * the fallback. `null` only when neither exists, and then the tile keeps its
 * category tint and icon.
 */
function photoFor(match, items, subject) {
  const real = match ? (items || []).find((item) => match(item) && item.image)?.image : null;
  return real || photoUrl(subject);
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
        className={cn(
          "group relative flex h-[118px] w-[104px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-3 text-left shadow-[0_16px_32px_-26px_rgba(15,10,24,0.55)] transition-transform hover:-translate-y-0.5",
          savedActive ? "from-accent-700 to-accent-400" : "from-brand-50 to-surface-3",
          savedActive && "ring-2 ring-mk-orange ring-offset-2 ring-offset-mk-cream",
        )}
      >
        <span className={cn(
          "absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/85 shadow-sm backdrop-blur",
          savedActive ? "text-accent-700" : "text-ink-1",
        )}>
          <Heart size={17} strokeWidth={2} aria-hidden="true" />
        </span>
        {savedCount > 0 && (
          <span className="absolute right-2.5 top-2.5 rounded-full bg-ink-1/85 px-1.5 py-0.5 text-2xs font-extrabold text-surface-0">
            {savedCount}
          </span>
        )}
        <span className={cn("relative text-[12px] font-extrabold leading-tight", savedActive ? "text-white" : "text-ink-1")}>
          Saved<span className="sr-only">{savedCount > 0 ? ` ${savedCount} items` : ""}</span>
        </span>
      </Link>

      {CATEGORIES.map(({ key, label, value: categoryValue, Icon, tone, match, subject }) => {
        const active = (value || "") === categoryValue;
        const image = photoFor(match, items, subject);
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(active ? "" : categoryValue)}
            data-testid={categoryValue && categoryValue !== "rounds" && categoryValue !== "spotted" ? `explore-kind-${categoryValue}` : `discover-category-${key}`}
            data-category={key}
            className={cn(
              "group relative flex h-[118px] w-[104px] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-2xl bg-gradient-to-br p-3 text-left shadow-[0_16px_32px_-26px_rgba(15,10,24,0.55)] transition-transform hover:-translate-y-0.5",
              tone,
              active && "ring-2 ring-mk-orange ring-offset-2 ring-offset-mk-cream",
            )}
          >
            {image ? (
              <img src={image} alt="" loading="lazy" className="absolute inset-0 h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.04]" />
            ) : null}
            <span className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" aria-hidden="true" />
            <span className="absolute left-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink-1 shadow-sm backdrop-blur">
              <Icon size={16} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className={cn("relative text-[12px] font-extrabold leading-tight text-white", active && "text-amber-300")}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
