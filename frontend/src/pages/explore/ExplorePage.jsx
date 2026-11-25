import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  ChevronDown, Compass, HelpCircle, MapPin, RefreshCw, ShieldCheck, X,
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
import RegionSpotlight from "@/components/regions/RegionSpotlight";
import ScopeBar from "@/components/regions/ScopeBar";
import { SpotDealModal } from "@/components/spotted/SpottedDealUI";
import CategoryNav from "@/components/discover/CategoryNav";
import HowWastaWorks from "@/components/discover/HowWastaWorks";
import DealRail from "@/components/discover/DealRail";
import ResultDeck from "@/components/discover/ResultDeck";
import MarketplaceBand from "@/components/discover/MarketplaceBand";
import FeaturedGrid from "@/components/discover/FeaturedGrid";
import FallbackRail, { ColdStartRail } from "@/components/discover/FallbackRail";
import { MerchGrid } from "@/components/discover/MerchCard";
import { favoritesEvent, loadFavorites } from "@/lib/discoverFavorites";
import { outsideAPI, serviceProviderAPI, spottedDealAPI } from "@/lib/api";
import {
  DEFAULT_REGION, REGION_BY_SLUG, REGION_SCOPE_RADIUS_KM, regionAnchor, regionFromPlace,
  regionLabel,
} from "@/config/regions";
import { regionMetrics } from "@/lib/regionMetrics";
import { RADII, locationLabel, useOutsideStore } from "@/stores/outsideStore";
import { ownerLevel } from "@/lib/standing";
import { cn } from "@/lib/utils";

/**
 * EXPLORE — the region's shelf of what is on offer.
 *
 * The screen used to open like a catalogue with three overlapping control
 * surfaces: a sticky search with a chip row under it, a category strip further
 * down, and a toolbar with a category select, a sort select and a filters
 * door. The hero above them said "Great finds. Better deals." and the spotlight
 * below it said "Around you", so the region — the thing the whole screen is
 * named after — appeared in one small line under a folding knob.
 *
 * What it is now, in the order a person meets it:
 *
 *   1. THE REGION, named. A knob that picks a corridor, and a card that says
 *      which one, what is in it, and how far "it" reaches.
 *   2. ONE SEARCH. One field, always on screen, and nothing else on the page
 *      that also searches.
 *   3. ONE CATEGORY GRID. Uniform cards, a wrapping grid, and a count on each
 *      one that is true or absent.
 *   4. ONE CONTROL DECK. The count, the filters, the sort, and the switch
 *      between the list and the map.
 *   5. THE RESULTS, with honest states: loading, failed (with the real
 *      reason and a retry), empty (with a way to change that), and full.
 *
 * Search state still lives in the URL (`?q=`, `?kind=`, `?when=`, `?price=`,
 * `?trust=`, `?intent=`, `?public_sale=`, `?region=`), so Back and deep links
 * restore the results.
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
];

const FILTER_KIND = {
  goods: "listing",
  services: "service",
  equipment: "rental",
};

const REGION_KEY = "brief-discovery-region";

export default function ExplorePage({ regionAware = false, demo = null }) {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Search scopes call it `search`; the field calls it `q`. Both land here.
  const q = params.get("q") || params.get("search") || "";
  const kind =
    params.get("kind") ||
    (regionAware ? FILTER_KIND[params.get("filter")] : "") ||
    "";
  const when = params.get("when") || "";
  const price = params.get("price") || "";
  const intent = params.get("intent") || "";
  const minLevel = params.get("min_level");
  const trust = params.get("trust") || (minLevel === "3" ? "3" : "");
  const publicSale = params.get("public_sale") === "true";
  const hasFilters = Boolean(kind || intent || trust || when || price);
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
  const [savedCount, setSavedCount] = useState(() => loadFavorites().length);
  const [nearby, setNearby] = useState([]);
  const [placeOpen, setPlaceOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [worksOpen, setWorksOpen] = useState(false);
  const [sort, setSort] = useState("popular");
  const [savedRegion, setSavedRegion] = useState(() => {
    try { return localStorage.getItem(REGION_KEY); } catch { return null; }
  });

  // `demo` is the dev-only preview path: the real screen, with fixture data and
  // no network. Every other caller leaves it null and gets the live stores.
  const liveItems = useOutsideStore((s) => s.items);
  const liveStatus = useOutsideStore((s) => s.status);
  const liveCursor = useOutsideStore((s) => s.cursor);
  const liveFailure = useOutsideStore((s) => s.failure);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const loadMore = useOutsideStore((s) => s.loadMore);
  const toggleReaction = useOutsideStore((s) => s.toggleReaction);
  const liveLocation = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);
  const setLocation = useOutsideStore((s) => s.setLocation);

  const items = demo ? demo.items : liveItems;
  const status = demo || (regionAware && kind === "spotted") ? "ready" : liveStatus;
  const cursor = demo ? null : liveCursor;
  const failure = demo ? null : liveFailure;
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

  // The Saved tile shows how many cards this device holds. It is deliberately
  // local: no server count, no owner notification.
  useEffect(() => {
    const refresh = () => setSavedCount(loadFavorites().length);
    window.addEventListener(favoritesEvent, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(favoritesEvent, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  const patchParams = useCallback((patch) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setParams(next, { replace: false });
  }, [params, setParams]);

  // Category tiles are destinations, not local toggles: the main ones have a
  // shareable section route, and the rest keep a URL-bound kind on /discover.
  const selectCategory = useCallback((value) => {
    const next = new URLSearchParams(params);
    next.delete("kind");
    next.delete("filter");
    // Intent and public-sale belong to the previous category; carrying them
    // into Goods/Services/Rounds would silently intersect two different doors.
    next.delete("intent");
    next.delete("public_sale");
    const suffix = next.toString();
    const section = { listing: "goods", service: "services", rental: "rentals" }[value];
    // `/regions` keeps its own path: `/regions/goods` would be read as a region
    // slug. There the same door is a URL-bound kind, not a section route.
    const onRegions = pathname.startsWith("/regions");
    if (section && !onRegions) {
      navigate({ pathname: `/discover/${section}`, search: suffix ? `?${suffix}` : "" });
      return;
    }
    if (value) next.set("kind", value);
    const target = onRegions ? "/regions" : "/discover";
    navigate({ pathname: target, search: next.toString() ? `?${next.toString()}` : "" });
  }, [navigate, params, pathname]);

  // ── the region, and the point the feed is centred on ──────────────────────
  // Precedence: the URL (shareable) → the last region this device chose → the
  // region the saved location belongs to → the largest corridor we serve. A
  // market name is never the answer.
  const region = useMemo(() => {
    if (!regionAware) return null;
    const slug = params.get("region") || savedRegion;
    return REGION_BY_SLUG[slug] || demo?.region || regionFromPlace(location?.label) || DEFAULT_REGION;
  }, [regionAware, params, savedRegion, demo?.region, location?.label]);

  // A region that was *chosen* — in the URL or remembered on this device —
  // becomes the point the feed looks from. A region that was merely inferred
  // from where the person already is does NOT: it would move the search away
  // from them, which is the opposite of "around you".
  const regionChosen = useMemo(
    () => Boolean(regionAware && (params.get("region") || savedRegion)),
    [regionAware, params, savedRegion],
  );
  const anchor = useMemo(() => (regionChosen ? regionAnchor(region) : null), [regionChosen, region]);
  const feedScope = useMemo(
    () => (anchor
      ? { lat: anchor.lat, lng: anchor.lng, radius_km: REGION_SCOPE_RADIUS_KM }
      : null),
    [anchor],
  );

  // Reload whenever the URL state changes — which is also what makes the back
  // button restore the previous results.
  useEffect(() => {
    if (!demo && !isServices && (!kinds || kinds.length)) {
      loadFeed({ kinds, query: q || null, scope: feedScope });
    }
  }, [demo, isServices, kinds, q, loadFeed, feedScope]);

  // COLD-START BACKFILL: nothing at the chosen radius is not the same as
  // nothing nearby. We ask for 50 km only when the clean feed is empty, and we
  // keep the result to Level 1–2 pages so the fallback never overclaims.
  useEffect(() => {
    if (!regionAware || demo || isServices || hasFilters || status !== "ready" || items.length) {
      setNearby([]);
      return undefined;
    }
    let live = true;
    outsideAPI.search({ radius_km: 50, limit: 12 })
      .then(({ data }) => {
        if (!live) return;
        const lowLevel = (data?.items || []).filter((item) => ownerLevel(item.owner) <= 2);
        setNearby(lowLevel);
      })
      .catch(() => { if (live) setNearby([]); });
    return () => { live = false; };
  }, [regionAware, demo, isServices, hasFilters, status, items.length]);

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

  // "Around me" — the person puts the search back where they are. The region
  // stops being a scope and the feed returns to their own point.
  const centreOnMe = useCallback(() => {
    try { localStorage.removeItem(REGION_KEY); } catch { /* private mode */ }
    setSavedRegion(null);
    patchParams({ region: "" });
  }, [patchParams]);

  const radius = Math.round(location?.radius_km ?? 15);
  const activeWhen = when ? WHEN_FILTERS.find((o) => o.value === when) : null;
  const activePrice = price === "free" ? "No price" : price === "priced" ? "Priced" : null;
  // A filter that the screen cannot express is not counted: the legacy
  // /explore skin has no standing door, so trust is only counted where it
  // can actually be turned off.
  const hiddenFilterCount = (when ? 1 : 0) + (price ? 1 : 0) + (intent ? 1 : 0)
    + (regionAware && trust ? 1 : 0);

  const visibleItems = useMemo(() => {
    // People live on the Home feed now. Discover is about what is on offer,
    // not a directory of faces; person records are filtered even when the
    // search endpoint returns them in its default kind set.
    const sourceItems = regionAware ? items.filter((item) => item.kind !== "person") : items;
    const ordinary = regionAware && kinds?.length === 0 ? [] : sourceItems;
    const strict = regionAware && trust === "3" ? ordinary.filter((item) => ownerLevel(item.owner) >= 3) : null;
    // A strict Level 3+ door that finds fewer than four traders falls back to
    // Level 2+, as the design contract says. It never silently calls a Level 2
    // trader "verified": the card shows the real level.
    const permitted = strict
      ? (strict.length >= 4 ? strict : ordinary.filter((item) => ownerLevel(item.owner) >= 2))
      : ordinary;
    // The strict standing filter excludes all community-spotted sales.
    const includeSpotted = regionAware && !demo
      && (!kind || kind === "spotted" || publicSale)
      && (publicSale || (!when && !price && trust !== "3" && (!intent || intent === "offers")));
    return includeSpotted ? [...spotted, ...permitted] : permitted;
  }, [items, regionAware, trust, intent, demo, kind, when, price, spotted, kinds, publicSale]);

  const resultItems = isServices ? providerItems : visibleItems;
  const featuredItems = useMemo(
    () => resultItems.filter((item) => item.feed_kind !== "SPOTTED_DEAL").slice(0, 3),
    [resultItems],
  );
  const standardItems = useMemo(
    () => (featuredItems.length >= 3 ? resultItems.slice(3) : resultItems),
    [resultItems, featuredItems.length],
  );
  const renderableStandard = standardItems.filter((item) => item.feed_kind !== "SPOTTED_DEAL");
  const spottedStandard = standardItems.filter((item) => item.feed_kind === "SPOTTED_DEAL");

  // Sort is an ordering of the page already fetched, never a second request.
  // Items without a price stay at the end rather than pretending to be free.
  const sortedStandard = useMemo(() => {
    const rows = [...renderableStandard];
    if (sort === "price_low" || sort === "price_high") {
      const direction = sort === "price_low" ? 1 : -1;
      rows.sort((a, b) => {
        const av = a.price_kes == null ? null : Number(a.price_kes);
        const bv = b.price_kes == null ? null : Number(b.price_kes);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return (av - bv) * direction;
      });
    } else if (sort === "newest") {
      rows.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    }
    return rows;
  }, [renderableStandard, sort]);

  const saleItems = useMemo(
    () => resultItems.filter((item) => item.price_kes != null || item.feed_kind === "SPOTTED_DEAL").slice(0, 8),
    [resultItems],
  );

  // The counts on the region card. They describe the records the screen holds,
  // and the screen says so — they are never a regional total.
  const metrics = useMemo(
    () => regionMetrics(items, { status, failed: status === "error" }),
    [items, status],
  );

  // Reset also clears the sticky search and the sale/trending doors. Leaving
  // any of them in the URL made "Reset" look like it had done nothing.
  const clearAll = () => {
    setSort("popular");
    patchParams({
      kind: "", filter: "", intent: "", trust: "", min_level: "", when: "", price: "",
      public_sale: "", q: "", search: "", feed: "",
    });
  };

  const retryFeed = useCallback(() => {
    loadFeed({ kinds, query: q || null, scope: feedScope, force: true });
  }, [loadFeed, kinds, q, feedScope]);

  // The count on the deck is the count of what is on the screen. It is never
  // presented as the size of the region.
  const countText = useMemo(() => {
    const where = region ? region.name : "this region";
    if (status === "error") return "Results couldn’t load — try again.";
    if (status === "loading" || status === "idle") return "Loading results…";
    const n = resultItems.length;
    if (!n) return `No results in ${where}.`;
    const bits = [`${n} result${n === 1 ? "" : "s"} loaded`];
    if (q) bits.push(`matching “${q}”`);
    bits.push(where);
    if (cursor) bits.push("more to load");
    return bits.join(" · ");
  }, [status, resultItems.length, region, q, cursor]);

  // Where the results are looking from, said in one line.
  const scopeLabel = useMemo(() => {
    if (anchor) return `Centred on ${anchor.hub}`;
    if (location?.label) return locationLabel(location);
    return "No area set";
  }, [anchor, location]);

  const scopeDetail = useMemo(() => {
    if (anchor) return `Within ${REGION_SCOPE_RADIUS_KM} km of ${anchor.hub}`;
    if (location?.source === "unset" || !location) {
      return "Showing everything the network has — set an area to narrow it.";
    }
    return `Within ${radius} km of you`;
  }, [anchor, location, radius]);

  const scopeNote = anchor
    ? `Results are centred on ${anchor.hub} and reach ${REGION_SCOPE_RADIUS_KM} km.`
    : null;

  // What the scope bar shows: the radius in force, and whether the region
  // owns it (in which case the person's own radius cannot change it).
  const scopeBar = useMemo(() => ({
    label: scopeLabel,
    detail: scopeDetail,
    radiusKm: anchor ? REGION_SCOPE_RADIUS_KM : radius,
    locked: Boolean(anchor),
  }), [scopeLabel, scopeDetail, anchor, radius]);

  // The map is a second way to see the same search. It takes the search text;
  // the region itself is not a map filter, and the screen says so rather than
  // letting a pin stand in for a region.
  const openMap = useCallback(() => {
    const next = new URLSearchParams();
    if (q) next.set("q", q);
    if (region?.slug) next.set("region", region.slug);
    next.set("from", "regions");
    navigate(`/map?${next.toString()}`);
  }, [navigate, q, region?.slug]);

  const postHere = useCallback(() => {
    const next = new URLSearchParams();
    if (region?.hub) next.set("place", region.hub);
    if (region?.slug) next.set("region", region.slug);
    navigate(`/create?${next.toString()}`);
  }, [navigate, region]);

  // Shared by the shopfront Filters door and the quieter /explore panel, so the
  // two screens never drift into different filter sets.
  const filterControls = (
    <>
      {regionAware && (
        <div role="group" aria-label="Browse by intent" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 shrink-0 text-micro text-mk-ink-soft">Use</span>
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
      )}
      <div className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-12 shrink-0 text-micro text-mk-ink-soft">Time</span>
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
        <span className="mr-1 w-12 shrink-0 text-micro text-mk-ink-soft">Price</span>
        <Chip size="sm" active={price === "free"} onClick={() => patchParams({ price: price === "free" ? "" : "free" })}>
          No price
        </Chip>
        <Chip size="sm" active={price === "priced"} onClick={() => patchParams({ price: price === "priced" ? "" : "priced" })}>
          Priced
        </Chip>
      </div>
      {regionAware && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 shrink-0 text-micro text-mk-ink-soft">Standing</span>
          <button
            type="button"
            aria-pressed={trust === "3"}
            aria-label="Only Level 3 or higher traders"
            title="Only pages with a completed trade record (Level 3+)"
            onClick={() => patchParams({ trust: trust === "3" ? "" : "3" })}
            data-testid="regions-trust"
            className={cn(
              "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-2xs font-extrabold transition-colors",
              trust === "3"
                ? "border-mk-ink bg-mk-ink text-mk-cream"
                : "border-mk-line bg-mk-cream text-mk-ink-soft hover:border-mk-ink/40 hover:text-mk-ink",
            )}
          >
            <ShieldCheck size={11} aria-hidden="true" /> Lvl 3+ only
          </button>
        </div>
      )}
      {(hiddenFilterCount > 0 || trust) && (
        <button
          type="button"
          data-testid="explore-clear-all"
          onClick={clearAll}
          className="inline-flex h-7 items-center gap-1 rounded-full px-2 text-micro font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1"
        >
          <X size={11} aria-hidden="true" /> Clear all filters
        </button>
      )}
    </>
  );

  return (
    <div className={cn("space-y-s3", regionAware && "-mx-4 bg-mk-cream px-4 pb-10 pt-3 text-mk-ink sm:-mx-6 sm:px-6")}>
      {regionAware ? (
        <>
          {/* ── the region masthead scrolls; the search bar below sticks ───── */}
          <div data-testid="discover-masthead" className="flex items-center justify-between gap-2">
            <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">Wasta · Explore</p>
            {/* The list must open *below* the sticky search bar, never over
                it — search stays permanent and usable while choosing. */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setWorksOpen(true)}
                aria-haspopup="dialog"
                aria-label="How Wasta works"
                data-testid="discover-how-it-works-button"
                className="grid h-8 w-8 place-items-center rounded-full border border-mk-line bg-mk-card text-mk-ink-soft transition-colors hover:border-mk-orange hover:text-mk-orange focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-mk-orange"
              >
                <HelpCircle size={13} aria-hidden="true" />
              </button>
              <RegionPicker
                region={region}
                onSelect={chooseRegion}
                avoidSelector='[data-testid="discover-toolbar"]'
                className="relative max-w-[62%]"
              />
            </div>
          </div>
          {region && (
            /* The identity line. It names the region and what it is known for;
               the region card below owns the links, so no destination is
               offered twice on the same screen. */
            <div data-testid="region-context" className="flex min-w-0 items-center gap-1.5 text-2xs text-mk-ink-soft">
              <MapPin size={11} className="shrink-0 text-mk-orange" aria-hidden="true" />
              <span className="truncate font-extrabold text-mk-ink">{regionLabel(region)}</span>
              <span className="hidden truncate sm:inline">· {region.knownFor.slice(0, 3).join(" · ")}</span>
            </div>
          )}

          {/* ── ONE search, and it never leaves ─────────────────────────────── */}
          <header
            data-testid="discover-toolbar"
            className="sticky top-[var(--header-h)] z-30 border-y border-mk-line/70 bg-mk-cream/80 px-1 py-2 shadow-[0_10px_24px_-22px_rgba(31,22,50,0.7)] backdrop-blur-md supports-[backdrop-filter]:bg-mk-cream/65"
          >
            <h1 className="sr-only">Explore</h1>
            <SearchInput
              value={q}
              onChange={onSearch}
              placeholder="Search goods, services, events…"
              aria-label="Search everything"
              size="lg"
              className="[&_svg]:text-mk-ink-soft"
              inputClassName="rounded-xl border-mk-line bg-mk-card text-mk-ink shadow-sm placeholder:text-mk-ink-soft/80 focus:border-mk-orange"
            />
          </header>

          <HowWastaWorks open={worksOpen} onClose={() => setWorksOpen(false)} />

          {/* ── the region itself: identity, truth, and one clear action ───── */}
          <RegionSpotlight
            region={region}
            metrics={metrics}
            scopeNote={scopeNote}
            onPost={postHere}
          />

          <ScopeBar scope={scopeBar} onCentreOnMe={centreOnMe} />

          {/* ── one category grid ───────────────────────────────────────────── */}
          <section aria-labelledby="discover-departments-heading" className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">Shop by department</p>
                <h2 id="discover-departments-heading" className="mt-1 text-2xl font-black tracking-tight text-mk-ink">
                  Categories
                </h2>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Link to="/regions/all" className="text-2xs font-extrabold text-mk-ink hover:text-mk-orange">
                  All regions
                </Link>
              </div>
            </div>
            <CategoryNav
              value={kind}
              onSelect={selectCategory}
              savedCount={savedCount}
              savedActive={pathname.startsWith("/discover/favorites")}
              items={items}
              countsKnown={status === "ready"}
            />
            <p className="text-2xs text-mk-ink-soft" data-testid="explore-category-note">
              {status === "ready"
                ? "Counts are from the results loaded below."
                : "Counts appear once the results load."}
            </p>
          </section>

          {!isServices && (
            <DealRail
              items={saleItems}
              viewAllTo={`${pathname.startsWith("/regions") ? "/regions" : "/discover"}?kind=listing&public_sale=true${region?.slug ? `&region=${region.slug}` : ""}`}
              onPublish={postHere}
              onSpotSale={() => setSpottedOpen(true)}
            />
          )}
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-title-section font-bold tracking-tight text-ink-1">Discover</h1>
            <button
              type="button"
              onClick={() => setPlaceOpen((v) => !v)}
              aria-expanded={placeOpen}
              data-testid="explore-place"
              className="inline-flex h-8 min-w-0 max-w-[60%] items-center gap-1 rounded-full border border-edge-1 bg-surface-1 px-2.5 text-2xs font-semibold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink-1"
            >
              <MapPin size={12} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              <span className="truncate" data-testid="explore-place-label">{locationLabel(location)}</span>
              <ChevronDown size={12} aria-hidden="true" className={cn("shrink-0 text-ink-4 transition-transform", placeOpen && "rotate-180")} />
            </button>
          </div>

          <nav aria-label="Browse the network" className="flex flex-wrap gap-2"><Link to="/offers" className="underline text-xs">Verified offers</Link><Link to="/browse?type=people" className="underline text-xs">Suppliers</Link></nav>

          <SearchInput
            value={q}
            onChange={onSearch}
            placeholder="Search goods, services and rentals…"
            aria-label="Search everything"
          />
        </>
      )}

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
          a control that changes nothing is worse than not showing it. ───── */}
      {!isServices && !regionAware && <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-micro text-ink-4">Within</span>
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
      </div>}

      {/* ── what you are doing: kept inside More filters on the region
          screen, because the category grid already answers "what". Non-region
          Explore keeps its own quiet type row. ───────────────────────────── */}
      {!regionAware && (
        <div role="group" aria-label="Discovery type" className="-mt-1 flex flex-wrap items-center gap-1 overflow-visible">
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
      )}

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

      {/* ── /explore keeps its quiet, counted filter panel. The shopfront uses
          the same controls inside the result deck, so there is one filter
          set. ──────────────────────────────────────────────────────────── */}
      {!regionAware && !isServices && (
        <div className="rounded-xl border border-edge-1 bg-surface-1">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            data-testid="explore-more-filters"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-2xs font-semibold text-ink-2"
          >
            <ShieldCheck size={13} className="text-ink-4" aria-hidden="true" />
            More filters
            {hiddenFilterCount > 0 && (
              <span className="rounded-full bg-brand-600 px-1.5 text-micro font-bold text-white dark:bg-brand-500">{hiddenFilterCount}</span>
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
              {filterControls}
            </div>
          )}
        </div>
      )}

      {!regionAware && (
        /* A strip, not a card wall: markets were the old scope. */
        <MarketStrip limit={2} />
      )}

      {regionAware && !isServices && (
        <>
          {!demo && (
            <SpotDealModal
              region={region?.slug}
              open={spottedOpen}
              onClose={() => setSpottedOpen(false)}
              onCreated={loadSpotted}
            />
          )}
          {spottedError && <p role="alert" className="text-xs text-rose-700">{spottedError}</p>}
        </>
      )}

      {regionAware && !isServices && (
        <ResultDeck
          countText={countText}
          countState={status === "error" ? "error" : "ready"}
          sort={sort}
          onSort={setSort}
          dirty={Boolean(q || kind || hiddenFilterCount || sort !== "popular")}
          onReset={clearAll}
          filtersOpen={filtersOpen}
          onToggleFilters={() => setFiltersOpen((v) => !v)}
          hiddenFilterCount={hiddenFilterCount}
          view="list"
          onViewChange={(next) => { if (next === "map") openMap(); }}
        >
          {filterControls}
        </ResultDeck>
      )}

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
          ) : status === "error" && !items.length ? (
            <FeedErrorPanel failure={failure} onRetry={retryFeed} region={region} onPublish={postHere} />
          ) : visibleItems.length === 0 && nearby.length > 0 ? (
            <ColdStartRail
              items={nearby}
              region={region}
              radius={radius}
              onSavedChanged={() => setSavedCount(loadFavorites().length)}
            />
          ) : visibleItems.length === 0 && (!items.length || (regionAware && kinds?.length === 0)) ? (
            <EmptyPanel query={q} region={region} onPublish={postHere} onClear={clearAll} />
          ) : visibleItems.length === 0 ? (
            regionAware && trust === "3" ? (
              <FallbackRail
                items={items}
                region={region}
                onShowEveryPage={() => patchParams({ trust: "", min_level: "" })}
                onSavedChanged={() => setSavedCount(loadFavorites().length)}
              />
            ) : (
              <FilteredEmpty
                onClear={clearAll}
                hasMore={Boolean(cursor)}
                onMore={loadMore}
              />
            )
          ) : (
            <>
              {status === "error" && (
                <FeedErrorStrip failure={failure} onRetry={retryFeed} />
              )}

              {!regionAware && (
                <div className="flex items-center justify-between gap-2">
                  <p className="text-2xs text-ink-4" data-testid="explore-count">
                    {resultItems.length} {resultItems.length === 1 ? "thing" : "things"}
                    {q ? ` matching “${q}”` : ""}
                    {location?.radius_km ? ` within ${radius} km` : ""}
                  </p>
                </div>
              )}

              {regionAware && (
                <FeaturedGrid
                  items={featuredItems}
                  viewAllTo={region?.slug ? `/discover?feed=trending&region=${region.slug}` : "/discover?feed=trending"}
                  onSavedChanged={() => setSavedCount(loadFavorites().length)}
                />
              )}

              {regionAware ? (
                <MerchGrid
                  items={sortedStandard}
                  onSavedChanged={() => setSavedCount(loadFavorites().length)}
                />
              ) : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {visibleItems.map((item) => (
                    <li key={`${item.kind}:${item.id}`}>
                      <ContentCard item={item} onReact={toggleReaction} className="h-full" />
                    </li>
                  ))}
                </ul>
              )}

              {regionAware && spottedStandard.length > 0 && (
                <section aria-labelledby="discover-spotted-heading" className="space-y-2">
                  <div>
                    <p className="text-2xs font-extrabold uppercase tracking-[0.18em] text-mk-orange">Community reports</p>
                    <h2 id="discover-spotted-heading" className="mt-1 text-2xl font-black tracking-tight text-mk-ink">
                      Spotted public sales
                    </h2>
                    <p className="text-2xs text-mk-ink-soft">Walked to, seen and confirmed on the ground.</p>
                  </div>
                  <MerchGrid
                    items={spottedStandard}
                    onSavedChanged={() => setSavedCount(loadFavorites().length)}
                  />
                </section>
              )}

              <div ref={sentinel} className="h-4" aria-hidden="true" />
              {status === "loading_more" && <p className="py-3 text-center text-2xs text-ink-4">Loading more…</p>}
              {!cursor && resultItems.length > 4 && (
                <p className="py-3 text-center text-2xs text-ink-4">That&apos;s everything in this scope.</p>
              )}
            </>
          )}
        </section>
      )}

      {regionAware && <MarketplaceBand />}
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
        className="rounded-2xl border border-dashed border-mk-line bg-mk-card p-6 text-center"
      >
        <h2 className="text-sm font-bold text-mk-ink">No service providers here yet</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-mk-ink-soft">
          {query
            ? `Nothing matched “${query}” in this corridor.`
            : `Nobody in ${region?.name || "this corridor"} has published a bookable service yet.`}
          {" "}Services are listed one provider at a time, so a page needs at least one
          service before it appears here.
        </p>
        <Link
          to="/you/page"
          className="mt-4 inline-flex h-10 items-center gap-1 rounded-lg bg-mk-ink px-4 text-xs font-extrabold text-mk-cream hover:bg-mk-ink/90"
        >
          Publish your own service <Compass size={13} aria-hidden="true" />
        </Link>
      </section>
    );
  }
  return (
    <section aria-live="polite" className="space-y-3" data-testid="service-providers">
      <p className="text-2xs text-mk-ink-soft">
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
        <li key={i} className="soft-card overflow-hidden rounded-2xl bg-mk-card">
          <Skeleton className="aspect-square w-full rounded-none bg-mk-warm" />
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

/**
 * THE FAILED LIST — the real reason, and a way forward.
 *
 * This panel used to print one sentence for every possible failure: offline,
 * timed out, signed out, a broken deployment. Now it names the cause it can
 * name, says whether trying again could help, and always leaves two doors
 * open: try again, or publish the thing yourself.
 */
function FeedErrorPanel({ failure, onRetry, region, onPublish }) {
  const retryable = failure ? failure.retryable !== false : true;
  return (
    <div
      data-testid="explore-error"
      role="alert"
      className="soft-card rounded-2xl bg-mk-card p-6 text-center"
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-mk-warm text-mk-orange">
        <RefreshCw size={22} aria-hidden="true" />
      </span>
      <h2 className="mt-3 text-title-section font-semibold text-ink-1">
        {failure?.title || "That didn’t load."}
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        {failure?.description || "The rest of the app is fine — this is just this list."}
      </p>
      {failure?.technical && (
        <details className="mx-auto mt-3 max-w-sm text-left">
          <summary className="cursor-pointer text-2xs font-bold text-ink-4">Technical note</summary>
          <p className="mt-1 break-words text-2xs text-ink-4">{failure.technical}</p>
        </details>
      )}
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {retryable && (
          <Button variant="secondary" icon={RefreshCw} onClick={onRetry} data-testid="explore-retry">
            Try again
          </Button>
        )}
        <Button onClick={onPublish} data-testid="explore-error-publish">
          Publish in {region?.hub || "your area"}
        </Button>
      </div>
      <p className="mt-3 text-2xs text-ink-4">
        You can still browse {region?.name || "the region"} by category while the list is down.
      </p>
    </div>
  );
}

/** The same failure, but above results that are already on screen. */
function FeedErrorStrip({ failure, onRetry }) {
  const retryable = failure ? failure.retryable !== false : true;
  return (
    <div
      data-testid="explore-error-strip"
      role="status"
      className="flex flex-wrap items-center gap-2 rounded-2xl border border-mk-line bg-mk-warm px-3 py-2.5"
    >
      <p className="min-w-0 flex-1 text-2xs font-semibold text-mk-ink">
        {failure?.title || "The next page didn’t load."} {failure?.description || ""}
      </p>
      {retryable && (
        <button
          type="button"
          onClick={onRetry}
          data-testid="explore-retry-strip"
          className="inline-flex h-9 items-center gap-1 rounded-lg bg-mk-ink px-3 text-2xs font-extrabold text-mk-cream"
        >
          <RefreshCw size={12} aria-hidden="true" /> Try again
        </button>
      )}
    </div>
  );
}

function ErrorPanel({ onRetry, message }) {
  return (
    <div
      data-testid="explore-error"
      className="soft-card rounded-2xl bg-mk-card p-6 text-center"
    >
      <p className="text-sm font-semibold text-mk-ink">{message || "That didn't load."}</p>
      <p className="mt-1 text-xs text-mk-ink-soft">The rest of the app is fine — this is just this list.</p>
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
      className="soft-card rounded-2xl bg-mk-card p-6 text-center"
    >
      <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-mk-warm text-mk-orange">
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
 * actually help are clearing the search and publishing something — because on
 * a discovery network the fix for "nothing here" is usually you.
 */
function EmptyPanel({ query, region, onPublish, onClear }) {
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
        {query ? `Nothing matches “${query}” yet` : `Nothing in ${region?.name || "this region"} yet`}
      </h2>
      <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-ink-3">
        {query
          ? "Try a shorter word, or clear the search — a specialist might serve the whole town."
          : "This area is quiet right now. Be the first to post something here, or look in another region."}
      </p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {query && onClear && (
          <Button variant="secondary" onClick={onClear} data-testid="explore-empty-clear">
            Clear the search
          </Button>
        )}
        {onPublish && (
          <Button onClick={onPublish} data-testid="explore-empty-publish">
            Post something
          </Button>
        )}
        {!query && (
          <Link to="/regions/all">
            <Button variant="secondary" icon={MapPin} data-testid="explore-empty-regions">
              See other regions
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}

export { KIND_FILTERS, TYPE_FILTERS, WHEN_FILTERS };
