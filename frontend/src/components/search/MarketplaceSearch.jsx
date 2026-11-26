import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { CATEGORY_TINTS, EXPLORE_CATEGORIES } from "@/config/categoryTints";
import Media from "@/components/ui/Media";
import { photoUrl } from "@/lib/photos";
import { debounce, cn } from "@/lib/utils";

/**
 * THE MARKETPLACE SEARCH — one field, one filter control, five categories.
 *
 * The brief asks for one reusable search experience on Home and Explore, with
 * one input, one contextual filter control, and the categories built into it.
 *
 * Before this there were two search implementations (the header's scoped
 * `GlobalSearch` and Explore's `SearchInput`), a seven-tile category grid, a
 * chip row under the search bar, a posting-type row, and a four-item grid on
 * Home. Five surfaces answering "what am I looking for?", each slightly
 * different. That is what "repeated search areas" meant.
 *
 * So this component IS the search. It has three parts:
 *
 *   1. ONE INPUT. Debounced, so typing filters the feed in place, and
 *      submitting goes to the dedicated results experience.
 *   2. ONE CONTEXTUAL FILTER CONTROL, where there is something to filter —
 *      time, price and standing live behind a single button that counts what
 *      is on. They are never permanently on screen: a screen showing five
 *      filter chips at all times shows none of them clearly.
 *   3. THE CATEGORIES: All, Goods, Services, Rentals, Events, in a wrapping
 *      grid that is never a carousel. The colour a category has here is the
 *      colour the result wears.
 *
 * The categories can be drawn two ways, and both come from the same list:
 * as compact chips on Explore, where they narrow a list that is already on
 * screen, and as an image-led grid on Home, where they are doors into the
 * results. One vocabulary, two presentations, never two sets.
 */

/**
 * The compact category row. One list, wrapping, never scrolling sideways: a
 * category hidden behind a swipe is a secret, and a discovery screen cannot
 * afford secret destinations.
 */
export function CategoryRow({ value = "all", onSelect, className }) {
  return (
    <div
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className={cn("grid grid-cols-3 gap-1.5 sm:grid-cols-5", className)}
    >
      {EXPLORE_CATEGORIES.map(({ key, kind }) => {
        const tint = CATEGORY_TINTS[key];
        const Icon = tint.icon;
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(active ? "all" : key)}
            data-testid={`explore-kind-${kind || "all"}`}
            data-category={key}
            data-kind={kind}
            className={cn(
              "group flex flex-col items-center justify-center gap-1 rounded-xl border px-1 py-2 transition-colors",
              "min-h-[56px] focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50",
              tint.wash,
              tint.ink,
              active
                ? "border-transparent ring-2 ring-inset ring-current"
                : "border-transparent hover:brightness-[0.98] dark:hover:brightness-110",
            )}
          >
            <Icon size={16} strokeWidth={1.9} aria-hidden="true" />
            <span className="text-micro font-semibold leading-none">{tint.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The image-led category grid — the same five categories, as doors.
 *
 * Two columns on a phone, because a phone is narrow and a single column of
 * five tiles is a scroll before the first listing. Each tile wears its
 * category's own colour and a photograph of the category, so a person can
 * find "Rentals" by shape before they read it.
 */
export function CategoryTiles({ value = "all", onSelect, categoryHref = null, className }) {
  return (
    <div
      role="group"
      aria-label="Browse by category"
      data-testid="explore-categories"
      className={cn("grid grid-cols-2 gap-3 sm:grid-cols-3", className)}
    >
      {EXPLORE_CATEGORIES.map(({ key, kind }) => {
        const tint = CATEGORY_TINTS[key];
        const Icon = tint.icon;
        const active = value === key;
        const body = (
          <>
            <span className="relative block aspect-[16/10] overflow-hidden bg-surface-3">
              <Media
                src={photoUrl(CATEGORY_PHOTO[key])}
                alt=""
                className="h-full w-full object-cover transition-transform duration-3 group-hover:scale-[1.03]"
                fallback={<span className={cn("block h-full w-full", tint.wash)} aria-hidden="true" />}
              />
              <span
                className={cn(
                  "absolute left-2 top-2 grid h-8 w-8 place-items-center rounded-lg bg-surface-1/95 shadow-sm",
                  tint.wash,
                  tint.ink,
                )}
              >
                <Icon size={15} aria-hidden="true" />
              </span>
            </span>
            <span className="block p-2.5">
              <span className="block text-sm font-bold text-ink-1">{tint.label}</span>
              <span className="block text-2xs leading-snug text-ink-4">{CATEGORY_HINT[key]}</span>
            </span>
          </>
        );

        if (categoryHref) {
          return (
            <Link
              key={key}
              to={categoryHref(key)}
              data-testid={`explore-kind-${kind || "all"}`}
              data-category={key}
              data-kind={kind}
              className="group overflow-hidden rounded-2xl border border-edge-1 bg-surface-1 transition-colors hover:border-edge-2 focus-visible:ring-2 focus-visible:ring-brand-500"
            >
              {body}
            </Link>
          );
        }

        return (
          <button
            key={key}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect?.(active ? "all" : key)}
            data-testid={`explore-kind-${kind || "all"}`}
            data-category={key}
            data-kind={kind}
            className={cn(
              "group overflow-hidden rounded-2xl border text-left transition-colors focus-visible:ring-2 focus-visible:ring-brand-500",
              active ? "border-brand-500 ring-2 ring-inset ring-brand-500/40" : "border-edge-1 bg-surface-1",
            )}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/** A real photograph per category, so the door looks like the thing behind it. */
const CATEGORY_PHOTO = {
  all: "commerce-goods",
  goods: "commerce-goods",
  services: "work-technician",
  rentals: "rental-tools",
  events: "culture-conference",
};

const CATEGORY_HINT = {
  all: "Everything on offer",
  goods: "Produce, stock, wares",
  services: "Trades and professionals",
  rentals: "Tools, rooms, vans",
  events: "Rounds and meetups",
};

export default function MarketplaceSearch({
  value = "",
  onChange,
  onSubmit,
  category = "all",
  onCategoryChange,
  categoryHref = null,
  categoryVariant = "chips",
  filtersOpen = false,
  onToggleFilters,
  filterCount = 0,
  filterLabel = "Filters",
  filterSummary = "",
  children,
  variant = "hero",
  placeholder = "Search goods, services, rentals and events",
  ariaLabel = "Search everything",
  idPrefix = "marketplace-search-",
  className = "",
  showCategories = true,
  enableShortcut = false,
}) {
  const [text, setText] = useState(value);
  const inputRef = useRef(null);
  const inputId = `${idPrefix}${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  useEffect(() => setText(value), [value]);

  // ⌘K / Ctrl-K focuses the field from anywhere. It is opt-in, because a
  // screen with two search fields must not have two shortcuts fighting.
  useEffect(() => {
    if (!enableShortcut) return undefined;
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enableShortcut]);

  const emit = useMemo(() => debounce((v) => onChange?.(v), 300), [onChange]);
  useEffect(() => () => emit.cancel(), [emit]);

  const update = (next) => {
    setText(next);
    emit(next);
  };

  const submit = (event) => {
    event.preventDefault();
    const term = text.trim();
    if (!term) {
      inputRef.current?.focus();
      return;
    }
    onSubmit?.(term);
  };

  const tall = variant === "hero";

  return (
    <div className={cn("space-y-2.5", className)}>
      <form role="search" onSubmit={submit} className="space-y-2.5">
        <div
          className={cn(
            "relative flex items-stretch overflow-hidden rounded-xl border border-edge-2 bg-surface-1 shadow-xs",
            "focus-within:border-brand-500 focus-within:ring-4 focus-within:ring-brand-500/15 transition-[border-color,box-shadow] duration-1",
            tall ? "h-12" : "h-11",
          )}
        >
          <label htmlFor={inputId} className="sr-only">
            {ariaLabel}
          </label>
          <Search
            size={tall ? 18 : 16}
            className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-4"
            aria-hidden="true"
          />
          <input
            id={inputId}
            ref={inputRef}
            data-testid="marketplace-search-input"
            type="search"
            role="searchbox"
            value={text}
            onChange={(event) => update(event.target.value)}
            placeholder={placeholder}
            aria-label={ariaLabel}
            className={cn(
              "min-w-0 flex-1 bg-transparent pl-10 pr-8 text-ink-1 placeholder:text-ink-4 focus:outline-none",
              tall ? "text-base" : "text-sm",
            )}
          />
          {text && (
            <button
              type="button"
              onClick={() => {
                emit.cancel();
                setText("");
                onChange?.("");
              }}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1 text-ink-4 hover:bg-surface-2 hover:text-ink-1"
            >
              <X size={14} aria-hidden="true" />
            </button>
          )}

          {onToggleFilters && (
            <button
              type="button"
              onClick={onToggleFilters}
              aria-expanded={filtersOpen}
              aria-controls="marketplace-filter-panel"
              data-testid="explore-more-filters"
              className={cn(
                "flex shrink-0 items-center gap-1.5 border-l border-edge-1 px-3 text-2xs font-semibold transition-colors",
                filtersOpen
                  ? "bg-brand-50 text-brand-800 dark:bg-brand-500/15 dark:text-brand-200"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink-1",
              )}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span className="hidden sm:inline">{filterLabel}</span>
              {filterCount > 0 && (
                <span
                  data-testid="explore-filter-count"
                  className="grid h-4 min-w-4 place-items-center rounded-full bg-brand-600 px-1 text-micro font-bold tabular-nums text-white"
                >
                  {filterCount}
                </span>
              )}
              {/* The control says what is on, not only how much: a filter that
                  is hidden behind a number is a filter nobody can find. */}
              {filterSummary && (
                <span
                  data-testid="explore-filter-summary"
                  className="max-w-[9rem] truncate text-micro font-semibold text-ink-3 sm:max-w-[12rem]"
                >
                  {filterSummary}
                </span>
              )}
              <ChevronDown
                size={13}
                aria-hidden="true"
                className={cn("transition-transform", filtersOpen && "rotate-180")}
              />
            </button>
          )}
        </div>

        {onToggleFilters && filtersOpen && (
          <div
            id="marketplace-filter-panel"
            data-testid="explore-filter-panel"
            className="rounded-xl border border-edge-1 bg-surface-1 px-3 py-2.5"
          >
            {children}
          </div>
        )}
      </form>

      {showCategories && (onCategoryChange || categoryHref) && (
        categoryVariant === "tiles" ? (
          <CategoryTiles
            value={category}
            onSelect={onCategoryChange}
            categoryHref={categoryHref}
          />
        ) : (
          <CategoryRow value={category} onSelect={onCategoryChange} />
        )
      )}
    </div>
  );
}
