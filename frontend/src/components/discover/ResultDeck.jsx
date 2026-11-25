import { ChevronDown, LayoutList, Map as MapIcon, SlidersHorizontal, X } from "lucide-react";
import { SORT_OPTIONS } from "@/components/discover/SortOptions";
import { cn } from "@/lib/utils";

/**
 * THE RESULT DECK — one control surface above the results.
 *
 * The old screen spread its controls across three places: a chip row under the
 * search bar, a category strip further down, and a toolbar with a category
 * select, a sort select and a filters door. Every one of them could change
 * what was on screen, and none of them said how much was on screen. That is
 * the "repeated search/filter surfaces" the review complained about, and it is
 * why the same screen could show a category, a radius and a count all at once
 * without any of them being obviously the truth.
 *
 * This deck has four parts and nothing else:
 *
 *   · THE COUNT, first, and always honest. "12 results in Nyanza", "No
 *     results in Nyanza", "Results couldn't load" — never a number that is
 *     not on the screen.
 *   · ONE filters door that counts what is on and opens every remaining
 *     filter in one panel.
 *   · SORT, which orders the page already fetched.
 *   · LIST / MAP, because the map is a second way to see the same search.
 */
export default function ResultDeck({
  countText,
  countState = "ready",
  sort = "popular",
  onSort,
  dirty = false,
  onReset,
  filtersOpen = false,
  onToggleFilters,
  hiddenFilterCount = 0,
  view = "list",
  onViewChange,
  children,
  className,
}) {
  return (
    <section
      aria-labelledby="result-deck-heading"
      data-testid="discover-shop-toolbar"
      className={cn("space-y-3", className)}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-eyebrow">Results</p>
          <h2 id="result-deck-heading" className="mt-0.5 text-xl font-black tracking-tight text-mk-ink">
            What’s on offer
          </h2>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            data-testid="explore-reset"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-2xs font-extrabold text-mk-ink-soft transition-colors hover:bg-mk-warm hover:text-mk-ink"
          >
            <X size={12} aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      <div className="soft-card rounded-2xl bg-mk-card p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            data-testid="explore-count"
            aria-live="polite"
            className={cn(
              "min-w-0 flex-1 text-2xs font-semibold",
              countState === "error" ? "text-mk-orange" : "text-mk-ink-soft",
            )}
          >
            {countText}
          </p>

          {/* LIST / MAP — the same search, seen from above. */}
          {onViewChange && (
            <div
              role="group"
              aria-label="Result view"
              data-testid="regions-view-switch"
              className="flex shrink-0 items-center rounded-lg border border-mk-line bg-mk-cream p-0.5"
            >
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => onViewChange("list")}
                data-testid="regions-view-list"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-2xs font-extrabold transition-colors",
                  view === "list" ? "bg-mk-ink text-mk-cream" : "text-mk-ink-soft hover:text-mk-ink",
                )}
              >
                <LayoutList size={13} aria-hidden="true" />
                List
              </button>
              <button
                type="button"
                aria-pressed={view === "map"}
                onClick={() => onViewChange("map")}
                data-testid="regions-view-map"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-2xs font-extrabold transition-colors",
                  view === "map" ? "bg-mk-ink text-mk-cream" : "text-mk-ink-soft hover:text-mk-ink",
                )}
              >
                <MapIcon size={13} aria-hidden="true" />
                Map
              </button>
            </div>
          )}
        </div>

        <div className="mt-2.5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onToggleFilters}
            aria-expanded={filtersOpen}
            aria-controls="explore-filter-panel"
            data-testid="explore-more-filters"
            className={cn(
              "inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border px-3 text-2xs font-extrabold transition-colors",
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

          <label className="block">
            <span className="sr-only">Sort results</span>
            <span className="relative block">
              <select
                value={sort}
                onChange={(event) => onSort(event.target.value)}
                aria-label="Sort results"
                data-testid="explore-sort"
                className="h-10 w-full appearance-none rounded-lg border border-mk-line bg-mk-cream px-2.5 pr-8 text-2xs font-extrabold text-mk-ink"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown
                size={12}
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-mk-ink-soft"
              />
            </span>
          </label>
        </div>

        {filtersOpen && (
          <div
            id="explore-filter-panel"
            data-testid="explore-filter-panel"
            className="mt-3 space-y-3 border-t border-mk-line pt-3"
          >
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
