import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ChevronDown, Compass, MapPin, RefreshCw, ShieldCheck, SlidersHorizontal, X,
} from "lucide-react";
import Button from "@/components/ui/Button";
import Chip from "@/components/ui/Chip";
import SearchInput from "@/components/ui/SearchInput";
import Skeleton from "@/components/ui/Skeleton";
import ContentCard from "@/components/outside/ContentCard";
import LocationBar from "@/components/outside/LocationBar";
import MarketStrip from "@/components/explore/MarketStrip";
import CategoryTiles from "@/components/explore/CategoryTiles";
import RegionPicker from "@/components/regions/RegionPicker";
import RegionsGrid from "@/components/regions/RegionsGrid";
import { SpotDealModal } from "@/components/spotted/SpottedDealUI";
import { serviceProviderAPI, spottedDealAPI } from "@/lib/api";
import {
  DEFAULT_REGION, REGION_BY_SLUG, regionFromPlace, regionLabel, regionPath,
} from "@/config/regions";
import { RADII, locationLabel, useOutsideStore } from "@/stores/outsideStore";
import { ownerLevel } from "@/lib/standing";
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

/** Regions browse by intent, not by the API's kind names. */
export const REGION_INTENTS = [
  { value: "", label: "All", kinds: null },
  { value: "offers", label: "Offers", kinds: ["available", "listing", "service", "rental"] },
  { value: "wanted", label: "Wanted", kinds: ["wanted", "opportunity"] },
];

const REGION_CATEGORIES = [
  { value: "", label: "All", kinds: null },
  { value: "listing", label: "Goods", kinds: ["listing"] },
  { value: "service", label: "Services", kinds: ["service", "available"] },
  { value: "person", label: "People", kinds: ["person"] },
  { value: "rental", label: "Rentals", kinds: ["rental"] },
  { value: "rounds", label: "Rounds & Events", kinds: ["scheduled", "event"] },
  { value: "spotted", label: "Spotted Sales", kinds: [] },
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

const FILTER_KIND = {
  goods: "listing",
  people: "person",
  services: "service",
  equipment: "rental",
};

const REGION_KEY = "brief-discovery-region";

export default function ExplorePage({ regionAware = false, demo = null }) {
  const [params, setParams] = useSearchParams();
  // Search scopes call it `search`; the field calls it `q`. Both land here.
  const q = params.get("q") || params.get("search") || "";
  const kind =
    params.get("kind") ||
    (regionAware ? FILTER_KIND[params.get("filter")] : "") ||
    "";
  const when = params.get("when") || "";
  const price = params.get("price") || "";
  const intent = params.get("intent") || "";
  const trust = params.get("trust") || "";
  // Services are people, not countable goods. That door gets its own read.
  const isServices = regionAware && kind === "service";

  const [spotted, setSpotted] = useState([]);
  const spottedRequest = useRef(0);
  const [spottedError, setSpottedError] = useState("");
  const [providers, setProviders] = useState([]);
  const [providerStatus, setProviderStatus] = useState("idle");
  const [providerError, setProviderError] = useState("");
  const [providerReload, setProviderReload] = useState(0);
  const [spottedOpen, setSpottedOpen] = useState(false);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedRegion, setSavedRegion] = useState(() => {
    try { return localStorage.getItem(REGION_KEY); } catch { return null; }
  });

  // `demo` is the dev-only preview path: the real screen, with fixture data and
  // no network. Every other caller leaves it null and gets the live stores.
  const liveItems = useOutsideStore((s) => s.items);
  const liveStatus = useOutsideStore((s) => s.status);
  const liveCursor = useOutsideStore((s) => s.cursor);
  const liveError = useOutsideStore((s) => s.error);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const loadMore = useOutsideStore((s) => s.loadMore);
  const toggleReaction = useOutsideStore((s) => s.toggleReaction);
  const liveLocation = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const setLocation = useOutsideStore((s) => s.setLocation);

  const items = demo ? demo.items : liveItems;
  const status = demo || (regionAware && kind === "spotted") ? "ready" : liveStatus;
  const cursor = demo ? null : liveCursor;
  const error = demo ? null : liveError;
  const location = demo ? demo.location : liveLocation;

  const sentinel = useRef(null);

  const kinds = useMemo(() => {
    if (isServices) return null;
    if (!regionAware) return kind ? [kind] : null;
    const category = REGION_CATEGORIES.find((option) => option.value === kind);
    const base = category?.kinds ?? (kind ? [kind] : null);
    const intentKinds = REGION_INTENTS.find((option) => option.value === intent)?.kinds || null;
    if (base && intentKinds) return base.filter((value) => intentKinds.includes(value));
    return base || intentKinds;
  }, [kind, regionAware, intent, isServices]);

  useEffect(() => {
    if (!demo && !location) loadLocation();
  }, [demo, location, loadLocation]);

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
    if (!demo && !isServices && (!kinds || kinds.length)) loadFeed({ kinds, query: q || null });
  }, [demo, isServices, kinds, q, loadFeed, location?.radius_km]);

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

  // The knob is a region, not a market. Precedence: the URL (shareable) →
  // the last region this device chose → the region the GPS label belongs to →
  // the largest corridor we serve. A market name is never the answer.
  const region = useMemo(() => {
    if (!regionAware) return null;
    const slug = params.get("region") || savedRegion;
    return REGION_BY_SLUG[slug] || demo?.region || regionFromPlace(location?.label) || DEFAULT_REGION;
  }, [regionAware, params, savedRegion, demo?.region, location?.label]);

  const loadSpotted = useCallback(async () => {
    if (!regionAware || demo || !region?.slug) return;
    const request = ++spottedRequest.current;
    setSpotted([]);
    try { const { data } = await spottedDealAPI.list(region.slug, q); if (request === spottedRequest.current) { setSpotted(data); setSpottedError(""); } }
    catch { if (request === spottedRequest.current) { setSpotted([]); setSpottedError("Spotted sales could not be loaded."); } }
  }, [regionAware, demo, region?.slug, q]);
  useEffect(() => { loadSpotted(); }, [loadSpotted]);

  // The Services door: one card per provider, filtered by the same corridor
  // and search text. It never falls back to the mixed feed, because that is
  // exactly the clutter this door exists to remove.
  useEffect(() => {
    if (!isServices || demo) {
      setProviders([]);
      setProviderStatus("idle");
      setProviderError("");
      return undefined;
    }
    let live = true;
    setProviderStatus("loading");
    setProviderError("");
    serviceProviderAPI.list({ region_slug: region?.slug, q: q || null, limit: 30 })
      .then(({ data }) => {
        if (!live) return;
        setProviders(Array.isArray(data?.providers) ? data.providers : []);
        setProviderStatus("ready");
      })
      .catch(() => {
        if (!live) return;
        setProviders([]);
        setProviderStatus("error");
        setProviderError("Service providers could not be loaded.");
      });
    return () => { live = false; };
  }, [isServices, demo, region?.slug, q, providerReload]);

  const providerItems = useMemo(() => providers.map(providerToCard), [providers]);

  const chooseRegion = useCallback((next) => {
    try { localStorage.setItem(REGION_KEY, next.slug); } catch { /* private mode */ }
    setSavedRegion(next.slug);
    patchParams({ region: next.slug, country: "" });
  }, [patchParams]);

  const radius = Math.round(location?.radius_km ?? 15);
  const activeWhen = when ? WHEN_FILTERS.find((o) => o.value === when) : null;
  const activePrice = price === "free" ? "No price" : price === "priced" ? "Priced" : null;
  const hiddenFilterCount = (when ? 1 : 0) + (price ? 1 : 0);
  const hasFilters = Boolean(kind || intent || trust || when || price);

  const visibleItems = useMemo(() => {
    const ordinary = regionAware && kinds?.length === 0 ? [] : items;
    const permitted = regionAware && trust === "3" ? ordinary.filter((item) => ownerLevel(item.owner) >= 3) : ordinary;
    // The strict standing filter excludes all community-spotted sales.
    const includeSpotted = regionAware && !demo && (!kind || kind === "spotted") && !when && !price && trust !== "3" && (!intent || intent === "offers");
    return includeSpotted ? [...spotted, ...permitted] : permitted;
  }, [items, regionAware, trust, intent, demo, kind, when, price, spotted, kinds]);

  const clearAll = () => patchParams({ kind: "", filter: "", intent: "", trust: "", when: "", price: "" });

  return (
    <div className="space-y-s3">
      {/* ── one row of identity: the screen and the place ─────────────────── */}
      <div className="flex items-center justify-between gap-2">
        {/* The tab is "Discover" (v2.18): find vendors, suppliers, services and
            products. The heading follows the tab — two names for one screen is
            how a product starts to feel like two products. */}
        <h1 className="text-title-section font-bold tracking-tight text-ink-1">Discover</h1>
        {regionAware ? (
          <RegionPicker
            region={region}
            onSelect={chooseRegion}
            className="relative max-w-[70%]"
          />
        ) : (
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
        )}
      </div>

      {/* ── the region the results belong to ───────────────────────────────
          The region is a scope, not a market gate. Two lines say what this
          corridor is known for and offer the one door that matters: its own
          page. Markets are gone, so nothing here turns into a directory. */}
      {regionAware && region && (
        <section
          aria-label="Region"
          data-testid="region-context"
          className="flex items-center gap-3 rounded-xl border border-edge-1 bg-surface-0 px-3 py-2.5"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-300">
            <MapPin size={16} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-ink-1">{regionLabel(region)}</p>
            <p className="truncate text-micro text-ink-4">
              {region.knownFor.slice(0, 3).join(" · ")}
            </p>
          </div>
          <Link
            to={regionPath(region)}
            className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-300"
          >
            Open region
          </Link>
        </section>
      )}

      {!regionAware && <nav aria-label="Browse the network" className="flex flex-wrap gap-2"><Link to="/offers" className="underline text-xs">Verified offers</Link><Link to="/browse?type=people" className="underline text-xs">Suppliers</Link></nav>}

      <SearchInput
        value={q}
        onChange={onSearch}
        placeholder={isServices ? "Search services by name or trade…" : "Search goods, people, services…"}
        aria-label="Search everything"
      />

      {regionAware && <div role="group" aria-label="Browse by category" className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        {REGION_CATEGORIES.map(option => <button key={option.value || "all"} type="button" aria-pressed={kind === option.value} onClick={() => patchParams({ kind: option.value, filter: "" })} className={cn("shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold", kind === option.value ? "bg-brand-700 text-white border-brand-700" : "border-edge-1 bg-surface-0 text-ink-2")}>{option.label}</button>)}
      </div>}

      {/* The full location controls, unchanged, one press away. In the region
          version the knob is a region, so GPS is not offered as a second,
          competing answer to "where am I looking?". */}
      {!regionAware && placeOpen && (
        <div data-testid="explore-place-panel">
          <LocationBar showRadius={false} className="border-edge-1" />
        </div>
      )}

      {/* ── radius and the standing filter share one line ──────────────────
          Neither applies to the Services directory: it is filtered by the
          provider's Page area, and standing is not a provider ranking. Showing
          a control that changes nothing is worse than not showing it. */}
      {!isServices && <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
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
        {regionAware && (
          <button
            type="button"
            aria-pressed={trust === "3"}
            aria-label="Only Level 3 or higher traders"
            title="Only pages with a completed trade record (Level 3+)"
            onClick={() => patchParams({ trust: trust === "3" ? "" : "3" })}
            data-testid="regions-trust"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-micro font-bold transition-colors",
              trust === "3"
                ? "border-brand-700 bg-brand-700 text-white"
                : "border-edge-1 bg-surface-1 text-ink-3 hover:border-edge-2 hover:text-ink-1",
            )}
          >
            <ShieldCheck size={12} aria-hidden="true" />
            Lvl 3+ only
          </button>
        )}
      </div>}

      {/* ── what you are doing: the secondary axis, kept quiet ────────────── */}
      {!isServices && regionAware ? (
        <div
          role="group"
          aria-label="Browse by intent"
          className="-mt-1 flex flex-wrap items-center gap-1 overflow-visible"
        >
          {REGION_INTENTS.map((option) => (
            <Chip
              key={option.value || "all"}
              size="sm"
              active={intent === option.value}
              onClick={() => patchParams({ intent: option.value })}
              data-testid={`regions-intent-${option.value || "all"}`}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      ) : !isServices ? (
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
      ) : null}

      {/* ── categories, in colour, wrapping into as many rows as needed ───── */}
      {!regionAware && <section aria-labelledby="explore-categories-heading" className="space-y-1.5">
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
        <CategoryTiles value={kind} onSelect={(value) => patchParams({ kind: value, filter: "", intent: "" })} />
      </section>}

      {/* ── everything else, behind one control that counts what is on ────── */}
      {!isServices && <div className="rounded-xl border border-edge-1 bg-surface-1">
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
      </div>}

      {!regionAware && (
        /* A strip, not a card wall: markets were the old scope. */
        <MarketStrip limit={2} />
      )}

      {regionAware && !demo && !isServices && <><button type="button" onClick={() => setSpottedOpen(true)} className="rounded-xl border border-amber-400 px-3 py-2 text-xs font-bold">Spot a public sale</button><SpotDealModal region={region?.slug} open={spottedOpen} onClose={() => setSpottedOpen(false)} onCreated={loadSpotted} />{spottedError && <p role="alert" className="text-xs text-rose-700">{spottedError}</p>}</>}
      {/* ── results ───────────────────────────────────────────────────────── */}
      {isServices ? (
        <ServiceProvidersPanel
          status={providerStatus}
          error={providerError}
          items={providerItems}
          query={q}
          region={region}
          onRetry={() => setProviderReload((n) => n + 1)}
        />
      ) : (
      <section aria-live="polite" aria-busy={status === "loading"} className="space-y-3">
        {status === "loading" && !items.length ? (
          <FeedSkeleton regionAware={regionAware} />
        ) : status === "error" ? (
          <ErrorPanel onRetry={() => loadFeed({ kinds, query: q || null, force: true })} message={error} />
        ) : visibleItems.length === 0 && (!items.length || (regionAware && kinds?.length === 0)) ? (
          <EmptyPanel query={q} />
        ) : visibleItems.length === 0 ? (
          <FilteredEmpty
            onClear={() => patchParams({ trust: "" })}
            hasMore={Boolean(cursor)}
            onMore={loadMore}
          />
        ) : (
          <>
            <p className="text-2xs text-ink-4" data-testid="explore-count">
              {visibleItems.length} {visibleItems.length === 1 ? "thing" : "things"}
              {q ? ` matching “${q}”` : ""}
              {location?.radius_km ? ` within ${radius} km` : ""}
              {regionAware && region ? ` · ${regionLabel(region)}` : ""}
            </p>
            {regionAware ? (
              <RegionsGrid items={visibleItems} onSpottedChanged={loadSpotted} />
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {visibleItems.map((item) => (
                  <li key={`${item.kind}:${item.id}`}>
                    <ContentCard item={item} onReact={toggleReaction} className="h-full" />
                  </li>
                ))}
              </ul>
            )}
            <div ref={sentinel} className="h-4" aria-hidden="true" />
            {status === "loading_more" && <p className="py-3 text-center text-2xs text-ink-4">Loading more…</p>}
            {!cursor && visibleItems.length > 4 && (
              <p className="py-3 text-center text-2xs text-ink-4">That's everything in this radius.</p>
            )}
          </>
        )}
      </section>
      )}
    </div>
  );
}

/** A provider row, shaped like every other Regions card.
 *
 * The card is one provider, never one service. The offering names travel in
 * `summary`/`meta` for the tests and for any richer card renderer; the visible
 * price is the provider's own starting price, not an invented average.
 */
export function providerToCard(provider) {
  const offerings = Array.isArray(provider?.offerings) ? provider.offerings : [];
  const names = offerings.map((o) => o.name).filter(Boolean);
  return {
    kind: "provider",
    id: provider.id,
    to: provider.handle ? `/p/${provider.handle}` : "#",
    title: provider.name || (provider.handle ? `@${provider.handle}` : "Service provider"),
    summary: names.slice(0, 4).join(" · "),
    category: provider.domains?.[0] || provider.categories?.[0] || "service",
    location: provider.area || null,
    price_kes: provider.starting_price_kes ?? null,
    owner: provider.owner || null,
    counts: {},
    meta: {
      service_count: provider.service_count || names.length,
      service_names: names,
      starting_price_unit: provider.starting_price_unit || null,
      is_bookable: Boolean(provider.is_bookable),
    },
  };
}

function ServiceProvidersPanel({ status, error, items, query, region, onRetry }) {
  if (status === "loading" || status === "idle") {
    return <FeedSkeleton regionAware />;
  }
  if (status === "error") {
    return <ErrorPanel onRetry={onRetry} message={error} />;
  }
  if (!items.length) {
    return (
      <section
        data-testid="service-providers-empty"
        className="rounded-2xl border border-dashed border-edge-2 bg-surface-0 p-6 text-center"
      >
        <h2 className="text-sm font-bold text-ink-1">No service providers here yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-ink-3">
          {query
            ? `Nothing matched “${query}” in this corridor.`
            : `Nobody in ${region?.name || "this corridor"} has published a bookable service yet.`}
          {" "}Services are listed one provider at a time, so a page needs at least one
          service before it appears here.
        </p>
        <Link
          to="/you/page"
          className="mt-4 inline-flex h-10 items-center gap-1 rounded-lg bg-brand-700 px-4 text-xs font-bold text-white hover:bg-brand-800"
        >
          Publish your own service <Compass size={13} aria-hidden="true" />
        </Link>
      </section>
    );
  }
  return (
    <section aria-live="polite" className="space-y-3" data-testid="service-providers">
      <p className="text-2xs text-ink-4">
        {items.length} service provider{items.length === 1 ? "" : "s"}
        {query ? ` matching “${query}”` : ""}
        {region ? ` · ${regionLabel(region)}` : ""}
        {" "}· one card per provider
      </p>
      <RegionsGrid items={items} />
    </section>
  );
}

function FeedSkeleton({ regionAware = false }) {
  return (
    <ul
      className={cn("grid gap-3", regionAware ? "grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 lg:grid-cols-3")}
      aria-label="Loading results"
    >
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

function FilteredEmpty({ onClear, hasMore = false, onMore }) {
  return (
    <div
      data-testid="explore-filtered-empty"
      className="rounded-card-lg border border-edge-1 bg-surface-1 p-6 text-center shadow-xs"
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 text-ink-4">
        <ShieldCheck size={22} aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-title-section font-semibold text-ink-1">
        {hasMore ? "No Level 3+ traders in these results yet" : "No Level 3+ traders here yet"}
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        Level 3 means at least one completed trade on record. Widen the radius,
        load more, or turn the standing filter off — a new page is still worth reading.
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        <Button variant="secondary" onClick={onClear}>
          Show every page
        </Button>
        {hasMore && (
          <Button variant="ghost" onClick={onMore}>
            Load more
          </Button>
        )}
      </div>
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
