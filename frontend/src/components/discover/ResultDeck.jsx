import { ChevronDown, LayoutList, Map as MapIcon, X } from "lucide-react";
import { SORT_OPTIONS } from "@/components/discover/SortOptions";
import { cn } from "@/lib/utils";

/**
 * THE RESULT DECK — one control surface above the results.
 *
 * The old screen spread its controls across three places: a chip row under
 * the search bar, a category strip further down, and a toolbar with a category
 * select, a sort select and a filters door. Every one of them could change
 * what was on screen, and none of them said how much was on screen. That is
 * the "repeated search/filter surfaces" the review complained about.
 *
 * This deck now has three parts and nothing else:
 *
 *   · THE COUNT, first, and always honest. "24 results loaded", "No results
 *     here", "Results couldn't load" — never a number that is not on the
 *     screen, and never a regional total.
 *   · LIST / MAP, because the map is a second way to see the same search.
 *   · SORT, which orders the page already fetched.
 *
 * The FILTERS DOOR IS NOT HERE. It lives in the search block, next to the
 * field it narrows, because that is the only place a person looks for it —
 * and a screen with two filter doors is a screen with no filter door.
 */
export default function ResultDeck({
  countText,
  countState = "ready",
  sort = "popular",
  onSort,
  dirty = false,
  onReset,
  view = "list",
  onViewChange,
  className,
}) {
  return (
    <section
      aria-labelledby="result-deck-heading"
      data-testid="discover-shop-toolbar"
      className={cn("space-y-2", className)}
    >
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="ds-eyebrow">Results</p>
          <h2 id="result-deck-heading" className="mt-0.5 text-title-section font-black tracking-tight text-ink-1">
            What&apos;s on offer
          </h2>
        </div>
        {dirty && (
          <button
            type="button"
            onClick={onReset}
            data-testid="explore-reset"
            className="inline-flex h-9 shrink-0 items-center gap-1 rounded-lg px-2 text-2xs font-bold text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink-1"
          >
            <X size={12} aria-hidden="true" />
            Reset
          </button>
        )}
      </div>

      <div className="soft-card rounded-2xl bg-surface-1 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p
            data-testid="explore-count"
            aria-live="polite"
            className={cn(
              "min-w-0 flex-1 text-2xs font-semibold",
              countState === "error" ? "text-accent-700" : "text-ink-3",
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
              className="flex shrink-0 items-center rounded-lg border border-edge-1 bg-surface-0 p-0.5"
            >
              <button
                type="button"
                aria-pressed={view === "list"}
                onClick={() => onViewChange("list")}
                data-testid="regions-view-list"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-2xs font-bold transition-colors",
                  view === "list" ? "bg-ink-1 text-surface-0" : "text-ink-3 hover:text-ink-1",
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
                  "inline-flex h-8 items-center gap-1 rounded-md px-2.5 text-2xs font-bold transition-colors",
                  view === "map" ? "bg-ink-1 text-surface-0" : "text-ink-3 hover:text-ink-1",
                )}
              >
                <MapIcon size={13} aria-hidden="true" />
                Map
              </button>
            </div>
          )}
        </div>

        {onSort && (
          <label className="mt-2 block">
            <span className="sr-only">Sort results</span>
            <span className="relative block">
              <select
                value={sort}
                onChange={(event) => onSort(event.target.value)}
                aria-label="Sort results"
                data-testid="explore-sort"
                className="h-10 w-full appearance-none rounded-lg border border-edge-1 bg-surface-0 px-2.5 pr-8 text-2xs font-bold text-ink-1"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <ChevronDown
                size={12}
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3"
              />
            </span>
          </label>
        )}
      </div>
    </section>
  );
}
