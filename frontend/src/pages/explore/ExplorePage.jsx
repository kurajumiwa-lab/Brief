import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChevronDown, Compass, MapPin, RefreshCw, SlidersHorizontal, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SearchInput from "@/components/ui/SearchInput";
import Skeleton from "@/components/ui/Skeleton";
import ContentCard from "@/components/outside/ContentCard";
import LocationBar from "@/components/outside/LocationBar";
import MarketsAround from "@/components/markets/MarketsAround";
import CategoryTiles from "@/components/explore/CategoryTiles";
import { RADII, locationLabel, useOutsideStore } from "@/stores/outsideStore";
import { cn } from "@/lib/utils";

/**
 * EXPLORE — one search across every content type, and almost none of it chrome.
 *
 * The screen used to open with a three-line introduction, a large location card
 * and two rows of identical pills: roughly 400 px of controls before a single
 * result, on a phone. Nothing was wrong with the *functionality* — it was all
 * real, it all worked — and that is exactly why the fix is presentation:
 *
 *   · **One line of identity.** "Explore" and the place you are looking around,
 *     on the same row, as a pill you can press. The full location controls
 *     (GPS, typed area, layer, sharing) still exist — behind that pill, so they
 *     cost nothing until someone wants them.
 *   · **Radius on one line**, not a row of four large buttons.
 *   · **Categories get colour**, so the selector reads at a glance instead of
 *     being scanned word by word. Seven tiles, wrapping, never a carousel: a
 *     hidden category is a missing destination.
 *   · **What a person is doing** (Available, Wanted, Scheduled…) stays a quiet
 *     chip row, because it is a secondary axis, not the main one.
 *   · **Time and price** move behind "More filters", carrying a count when
 *     something is on. No filter was removed — only demoted.
 *
 * Search state still lives in the URL (`?q=`, `?kind=`, `?when=`, `?price=`,
 * `?radius=` via the location store), so Back still restores the results.
 */

const TYPE_FILTERS = [
  { value: "", label: "Everything" },
  { value: "available", label: "Available" },
  { value: "wanted", label: "Wanted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "opportunity", label: "Opportunities" },
  { value: "post", label: "Posts" },
];

const WHEN_FILTERS = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

/** The full kind inventory, kept exported for anything that still imports it. */
const KIND_FILTERS = [
  { value: "", label: "Everything" },
  { value: "available", label: "Available" },
  { value: "wanted", label: "Wanted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "opportunity", label: "Opportunities" },
  { value: "post", label: "Posts" },
  { value: "event", label: "Events" },
  { value: "community", label: "Communities" },
  { value: "collection", label: "Collections" },
  { value: "listing", label: "Goods" },
  { value: "service", label: "Services" },
  { value: "rental", label: "Rentals" },
  { value: "person", label: "People" },
];

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const kind = params.get("kind") || "";
  const when = params.get("when") || "";
  const price = params.get("price") || "";

  const [placeOpen, setPlaceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const items = useOutsideStore((s) => s.items);
  const status = useOutsideStore((s) => s.status);
  const cursor = useOutsideStore((s) => s.cursor);
  const error = useOutsideStore((s) => s.error);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const loadMore = useOutsideStore((s) => s.loadMore);
  const toggleReaction = useOutsideStore((s) => s.toggleReaction);
  const location = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const setLocation = useOutsideStore((s) => s.setLocation);

  const sentinel = useRef(null);

  const kinds = useMemo(() => (kind ? [kind] : null), [kind]);

  useEffect(() => {
    if (!location) loadLocation();
  }, [location, loadLocation]);

  const patchParams = useCallback((patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: false });
  }, [params, setParams]);

  // Reload whenever the URL state changes — which is also what makes the back
  // button restore the previous results.
  useEffect(() => {
    loadFeed({ kinds, query: q || null });
  }, [kinds, q, loadFeed, location?.radius_km]);

  // Incremental loading: fetch the next page when the sentinel scrolls in.
  useEffect(() => {
    const node = sentinel.current;
    if (!node || !cursor) return undefined;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) loadMore(); },
      { rootMargin: "400px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  // SearchInput debounces and hands back the string itself, so the query goes
  // straight into the URL — which is what makes Back restore the results.
  const onSearch = useCallback((value) => {
    patchParams({ q: (value || "").trim() });
  }, [patchParams]);

  const radius = Math.round(location?.radius_km ?? 15);
  const activeWhen = when ? WHEN_FILTERS.find((o) => o.value === when) : null;
  const activePrice = price === "free" ? "No price" : price === "priced" ? "Priced" : null;
  const hiddenFilterCount = (when ? 1 : 0) + (price ? 1 : 0);
  const hasFilters = Boolean(kind || when || price);

  const clearAll = () => patchParams({ kind: "", when: "", price: "" });

  return (
    <div className="space-y-s3">
      {/* ── one row of identity: the screen and the place ─────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-title-section font-bold tracking-tight text-ink-1">Explore</h1>
        <button
          type="button"
          onClick={() => setPlaceOpen((v) => !v)}
          aria-expanded={placeOpen}
          data-testid="explore-place"
          className="inline-flex h-8 min-w-0 max-w-[60%] items-center gap-1 rounded-full border border-edge-1 bg-surface-1 px-2.5 text-2xs font-semibold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink-1"
        >
          <MapPin size={12} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
          <span className="truncate" data-testid="explore-place-label">{locationLabel(location)}</span>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className={cn("shrink-0 text-ink-4 transition-transform", placeOpen && "rotate-180")}
          />
        </button>
      </div>

      <SearchInput
        value={q}
        onChange={onSearch}
        placeholder="Search goods, people, services…"
        aria-label="Search everything"
      />

      {/* The full location controls, unchanged, one press away. */}
      {placeOpen && (
        <div data-testid="explore-place-panel">
          <LocationBar showRadius={false} className="border-edge-1" />
        </div>
      )}

      {/* ── radius: one line, four choices ────────────────────────────────── */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs text-ink-4">Discovery radius</span>
        <div role="group" aria-label="Discovery radius" className="flex items-center gap-1">
          {RADII.map((option) => {
            const active = radius === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                title={option.hint}
                onClick={() => setLocation({ radius_km: option.value })}
                data-testid={`explore-radius-${option.value}`}
                className={cn(
                  "inline-flex h-6 items-center rounded-full px-2 text-micro font-semibold tabular-nums transition-colors",
                  active
                    ? "bg-brand-600 text-white dark:bg-brand-500"
                    : "text-ink-3 hover:bg-surface-2 hover:text-ink-1",
                )}
              >
                {option.value} km
              </button>
            );
          })}
        </div>
      </div>

      {/* ── what you are doing: the secondary axis, kept quiet ────────────── */}
      <div
        role="group"
        aria-label="Discovery type"
        className="-mt-1 flex flex-wrap items-center gap-1 overflow-visible"
      >
        {TYPE_FILTERS.map((option) => (
          <Chip
            key={option.value || "all"}
            size="sm"
            active={kind === option.value}
            onClick={() => patchParams({ kind: option.value })}
            data-testid={`explore-type-${option.value || "all"}`}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      {/* ── categories, in colour, wrapping into as many rows as needed ───── */}
      <section aria-labelledby="explore-categories-heading" className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-2">
          <h2
            id="explore-categories-heading"
            className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4"
          >
            Browse by category
          </h2>
          {hasFilters && (
            <button
              type="button"
              onClick={clearAll}
              data-testid="explore-clear"
              className="inline-flex items-center gap-1 text-micro font-semibold text-ink-4 hover:text-ink-1"
            >
              <X size={11} aria-hidden="true" /> Clear
            </button>
          )}
        </div>
        <CategoryTiles value={kind} onSelect={(value) => patchParams({ kind: value })} />
      </section>

      {/* ── everything else, behind one control that counts what is on ────── */}
      <div className="rounded-xl border border-edge-1 bg-surface-1">
        <button
          type="button"
          onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          data-testid="explore-more-filters"
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-2xs font-semibold text-ink-2"
        >
          <SlidersHorizontal size={13} className="text-ink-4" aria-hidden="true" />
          More filters
          {hiddenFilterCount > 0 && (
            <span className="rounded-full bg-brand-600 px-1.5 text-micro font-bold text-white dark:bg-brand-500">
              {hiddenFilterCount}
            </span>
          )}
          {hiddenFilterCount > 0 && (
            <span className="truncate font-normal text-ink-4">
              {[activeWhen?.label, activePrice].filter(Boolean).join(" · ")}
            </span>
          )}
          <ChevronDown
            size={13}
            aria-hidden="true"
            className={cn("ml-auto shrink-0 text-ink-4 transition-transform", filtersOpen && "rotate-180")}
          />
        </button>

        {filtersOpen && (
          <div className="space-y-2 border-t border-edge-1 px-3 py-2.5" data-testid="explore-filter-panel">
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 w-12 shrink-0 text-micro text-ink-4">Time</span>
              {WHEN_FILTERS.map((option) => (
                <Chip
                  key={option.value || "anytime"}
                  size="sm"
                  active={when === option.value}
                  onClick={() => patchParams({ when: option.value })}
                >
                  {option.label}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <span className="mr-1 w-12 shrink-0 text-micro text-ink-4">Price</span>
              <Chip
                size="sm"
                active={price === "free"}
                onClick={() => patchParams({ price: price === "free" ? "" : "free" })}
              >
                No price
              </Chip>
              <Chip
                size="sm"
                active={price === "priced"}
                onClick={() => patchParams({ price: price === "priced" ? "" : "priced" })}
              >
                Priced
              </Chip>
            </div>
          </div>
        )}
      </div>

      {/* ── markets, before the feed: a place to walk into ──────────────────
          One market, not three. It is a preview — proof that there is a
          physical place behind the listings — and every extra card here is a
          card of actual results pushed below the fold. */}
      <MarketsAround limit={1} showWiden={false} className="-mt-0.5" />

      {/* ── results ───────────────────────────────────────────────────────── */}
      <section aria-live="polite" aria-busy={status === "loading"} className="space-y-3">
        {status === "loading" && !items.length ? (
          <FeedSkeleton />
        ) : status === "error" ? (
          <ErrorPanel onRetry={() => loadFeed({ kinds, query: q || null, force: true })} message={error} />
        ) : items.length === 0 ? (
          <EmptyPanel query={q} />
        ) : (
          <>
            <p className="text-2xs text-ink-4" data-testid="explore-count">
              {items.length} {items.length === 1 ? "thing" : "things"}
              {q ? ` matching “${q}”` : ""}
              {location?.radius_km ? ` within ${radius} km` : ""}
            </p>
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <li key={`${item.kind}:${item.id}`}>
                  <ContentCard item={item} onReact={toggleReaction} className="h-full" />
                </li>
              ))}
            </ul>
            <div ref={sentinel} className="h-4" aria-hidden="true" />
            {status === "loading_more" && <p className="py-3 text-center text-2xs text-ink-4">Loading more…</p>}
            {!cursor && items.length > 4 && (
              <p className="py-3 text-center text-2xs text-ink-4">That's everything in this radius.</p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

function FeedSkeleton() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading results">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <li key={i} className="overflow-hidden rounded-card border border-edge-1 bg-surface-1">
          <Skeleton className="aspect-[4/3] w-full rounded-none" />
          <div className="space-y-2 p-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function ErrorPanel({ onRetry, message }) {
  return (
    <div
      data-testid="explore-error"
      className="rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center shadow-xs"
    >
      <p className="text-sm font-semibold text-ink-1">{message || "That didn't load."}</p>
      <p className="mt-1 text-xs text-ink-3">The rest of the app is fine — this is just this list.</p>
      <Button className="mt-4" variant="secondary" icon={RefreshCw} onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * An empty result is an invitation, not a dead end. The two doors that
 * actually help are widen the radius and publish something — because on a
 * discovery network the fix for "nothing here" is usually you.
 */
function EmptyPanel({ query }) {
  return (
    <div
      data-testid="explore-empty"
      className={cn(
        "rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center shadow-xs sm:p-8",
      )}
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink-4">
        <Compass size={22} aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-title-section font-semibold text-ink-1">
        {query ? `Nothing matches “${query}” yet` : "Nothing here yet"}
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        {query
          ? "Try a shorter word, or widen your radius — a specialist might serve the whole town."
          : "This area is quiet right now. Widen the radius, or be the first to post something."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Link to="/create">
          <Button>Post something</Button>
        </Link>
        <Link to="/explore">
          <Button variant="secondary" icon={MapPin}>
            Widen the area
          </Button>
        </Link>
      </div>
    </div>
  );
}

export { KIND_FILTERS, TYPE_FILTERS, WHEN_FILTERS };
