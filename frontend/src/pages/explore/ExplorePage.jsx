import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Compass, MapPin, RefreshCw, X } from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SearchInput from "@/components/ui/SearchInput";
import Skeleton from "@/components/ui/Skeleton";
import ContentCard from "@/components/outside/ContentCard";
import LocationBar from "@/components/outside/LocationBar";
import { useOutsideStore } from "@/stores/outsideStore";
import { cn } from "@/lib/utils";

/**
 * EXPLORE — one search across every content type.
 *
 * The point of this screen is that a person does not need to know which
 * database holds what. One box, one set of filters, and every result rendered
 * as the card its own type deserves — an event is never flattened into a
 * generic listing just because search found it.
 *
 * Search state lives in the URL (`?q=`, `?kind=`, `?when=`, `?radius=`), so
 * opening a result and pressing back returns you to the same results rather
 * than starting again. That is a real requirement, not a nicety: the whole
 * screen is built around leaving and coming back.
 */

const KIND_FILTERS = [
  { value: "", label: "Everything" },
  { value: "post", label: "Posts" },
  { value: "event", label: "Events" },
  { value: "opportunity", label: "Opportunities" },
  { value: "community", label: "Communities" },
  { value: "collection", label: "Collections" },
  { value: "listing", label: "Goods" },
  { value: "service", label: "Services" },
  { value: "rental", label: "Rentals" },
  { value: "person", label: "People" },
];

const WHEN_FILTERS = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

export default function ExplorePage() {
  const [params, setParams] = useSearchParams();
  const q = params.get("q") || "";
  const kind = params.get("kind") || "";
  const when = params.get("when") || "";
  const price = params.get("price") || "";

  const [submitted, setSubmitted] = useState(false);

  const items = useOutsideStore((s) => s.items);
  const status = useOutsideStore((s) => s.status);
  const cursor = useOutsideStore((s) => s.cursor);
  const error = useOutsideStore((s) => s.error);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const loadMore = useOutsideStore((s) => s.loadMore);
  const toggleReaction = useOutsideStore((s) => s.toggleReaction);
  const location = useOutsideStore((s) => s.location);

  const sentinel = useRef(null);

  const kinds = useMemo(() => (kind ? [kind] : null), [kind]);

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
    setSubmitted(true);
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

  const hasFilters = Boolean(kind || when || price);

  return (
    <div className="space-y-s5">
      <header className="space-y-1">
        <p className="text-micro font-bold uppercase tracking-[0.14em] text-ink-4">Explore</p>
        <h1 className="text-title-page font-bold text-ink-1">What's around you</h1>
        <p className="text-sm text-ink-3">
          Events, people, communities, requests and things for sale — one search, whatever it is.
        </p>
      </header>

      <LocationBar />

      <div role="search" className="space-y-3">
        <SearchInput
          value={q}
          onChange={onSearch}
          placeholder="Search events, people, services, requests…"
          aria-label="Search everything"
        />

        <div className="flex flex-wrap gap-1.5">
          {KIND_FILTERS.map((option) => (
            <Chip
              key={option.value || "all"}
              active={kind === option.value}
              onClick={() => patchParams({ kind: option.value })}
              data-testid={`explore-kind-${option.value || "all"}`}
            >
              {option.label}
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
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
          <span className="mx-1 h-4 w-px bg-edge-2" aria-hidden="true" />
          <Chip size="sm" active={price === "free"} onClick={() => patchParams({ price: price === "free" ? "" : "free" })}>
            No price
          </Chip>
          <Chip size="sm" active={price === "priced"} onClick={() => patchParams({ price: price === "priced" ? "" : "priced" })}>
            Priced
          </Chip>
          {hasFilters && (
            <button
              type="button"
              onClick={() => patchParams({ kind: "", when: "", price: "" })}
              className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-2xs font-semibold text-ink-4 hover:text-ink-1"
            >
              <X size={12} aria-hidden="true" /> Clear filters
            </button>
          )}
        </div>
      </div>

      {/* ── results ─────────────────────────────────────────────────────── */}
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
              {location?.radius_km ? ` within ${Math.round(location.radius_km)} km` : ""}
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

      {!submitted && null}
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

export { KIND_FILTERS, WHEN_FILTERS };
