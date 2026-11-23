import { ChevronDown, SlidersHorizontal, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const SORT_OPTIONS = [
  { value: "popular", label: "Popular" },
  { value: "price_low", label: "Price: low to high" },
  { value: "price_high", label: "Price: high to low" },
  { value: "newest", label: "Newest first" },
];

/**
 * SHOP ALL PRODUCTS — the control deck above the grid.
 *
 * The live search lives in the sticky bar above; this is the shelf itself:
 * category, sort, the count and the one counted Filters door. Every control
 * writes to the URL (except sort, which is a local ordering of the page already
 * fetched), so Back restores what was on screen.
 */
export default function ShopToolbar({
  title = "Shop all products",
  eyebrow = "Brief marketplace",
  query,
  categories = [],
  category,
  onCategory,
  sort,
  onSort,
  onReset,
  filtersOpen,
  onToggleFilters,
  hiddenFilterCount = 0,
  countText,
  children,
  trustControl = null,
  showFilters = true,
}) {
  const dirty = Boolean(query || category || hiddenFilterCount || sort !== "popular");

  return (
    <section aria-labelledby="shop-all-heading" data-testid="discover-shop-toolbar" className="space-y-3">
      <div className="text-center">
        <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">{eyebrow}</p>
        <h2 id="shop-all-heading" className="mt-1 scroll-mt-[10.5rem] text-2xl font-black tracking-tight text-mk-ink">{title}</h2>
      </div>

      <div className="soft-card rounded-2xl bg-mk-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-2xs font-semibold text-mk-ink-soft" data-testid="explore-count">{countText}</p>
          <div className="flex items-center gap-2">
            {trustControl}
            {dirty && (
              <button
                type="button"
                onClick={onReset}
                className="text-2xs font-extrabold text-mk-orange hover:underline"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-2xs font-extrabold uppercase tracking-[0.08em] text-mk-ink-soft">Category</span>
            <span className="relative block">
              <select
                value={category || ""}
                onChange={(event) => onCategory(event.target.value)}
                aria-label="Filter by category"
                className="h-10 w-full appearance-none rounded-lg border border-mk-line bg-mk-cream px-2.5 pr-8 text-xs font-bold text-mk-ink"
              >
                {categories.map((option) => (
                  <option key={option.value || "all"} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mk-ink-soft" aria-hidden="true" />
            </span>
          </label>

          <label className="block">
            <span className="mb-1 block text-2xs font-extrabold uppercase tracking-[0.08em] text-mk-ink-soft">Sort</span>
            <span className="relative block">
              <select
                value={sort}
                onChange={(event) => onSort(event.target.value)}
                aria-label="Sort products"
                className="h-10 w-full appearance-none rounded-lg border border-mk-line bg-mk-cream px-2.5 pr-8 text-xs font-bold text-mk-ink"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mk-ink-soft" aria-hidden="true" />
            </span>
          </label>
        </div>

        {showFilters && (
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            data-testid="explore-more-filters"
            className={cn(
              "mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border px-3 text-2xs font-extrabold transition-colors",
              filtersOpen || hiddenFilterCount
                ? "border-mk-ink bg-mk-ink text-mk-cream"
                : "border-mk-line bg-mk-cream text-mk-ink hover:border-mk-ink/40",
            )}
          >
            <SlidersHorizontal size={13} aria-hidden="true" />
            Filters
            {hiddenFilterCount > 0 && (
              <span className="rounded-full bg-mk-orange px-1.5 text-2xs text-white">{hiddenFilterCount}</span>
            )}
            <ChevronDown size={12} aria-hidden="true" className={cn("transition-transform", filtersOpen && "rotate-180")} />
          </button>
        )}

        {showFilters && filtersOpen && (
          <div className="mt-3 space-y-2 border-t border-mk-line pt-3" data-testid="explore-filter-panel">
            {children}
          </div>
        )}
      </div>

      <p className="flex items-center justify-center gap-1 text-2xs font-semibold text-mk-ink-soft">
        <Sparkles size={11} className="text-mk-orange" aria-hidden="true" />
        Every result is a live page. Nothing here is a paid slot.
      </p>
    </section>
  );
}
