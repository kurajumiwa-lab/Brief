import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Compass, Heart, MapPin, ShieldCheck, X } from "lucide-react";
import MarketplaceSearch, { CategoryRow } from "@/components/search/MarketplaceSearch";
import LocationBar from "@/components/outside/LocationBar";
import RegionPicker from "@/components/regions/RegionPicker";
import ResultDeck from "@/components/discover/ResultDeck";
import ListingCard from "@/components/listings/ListingCard";
import Chip from "@/components/ui/Chip";
import { SpotDealModal } from "@/components/spotted/SpottedDealUI";
import { outsideAPI, serviceProviderAPI, spottedDealAPI } from "@/lib/api";
import {
  DEFAULT_REGION, REGION_BY_SLUG, REGION_SCOPE_RADIUS_KM, regionAnchor, regionFromPlace,
} from "@/config/regions";
import { categoryByKey, categoryForKind, kindsForCategory } from "@/config/searchCategories";
import { locationLabel, useOutsideStore } from "@/stores/outsideStore";
import { ownerLevel } from "@/lib/standing";
import { cn } from "@/lib/utils";

/**
 * EXPLORE — the marketplace, with nothing in the way.
 *
 * The brief is blunt about this screen: it is a marketplace, not an
 * editorial page. "Remove large region cards, discovery statistics,
 * repeated regional descriptions, redundant location headings, duplicate
 * categories, and empty promotional sections. Retain search, categories,
 * contextual filters, nearby listings, and map/list switching; prioritise
 * listings over explanatory content."
 *
 * So this is what Explore is now, in the order a person meets it:
 *
 *   1. ONE SCOPE. A region knob, and one sentence saying what the results are
 *      actually looking from — the region's hub, or the person's own point.
 *      The sentence is also the door to the full controls (GPS, typed area,
 *      radius), because the GPS button must never be the only way in.
 *   2. ONE SEARCH, WITH THE CATEGORIES IN IT. One field, one filter control
 *      that counts AND names what is on, and the five categories in one
 *      wrapping row underneath — sticky, so they stay above the results.
 *   3. THE RESULTS. The count (honest), the sort, the list/map switch, and
 *      the listings themselves, in the standard card.
 *
 * What is gone, and why it can go:
 *
 *   · THE REGION CARD. A big panel with three statistics about the records
 *     the screen happened to load, and a description of the region. The
 *     statistics were never a regional total, and a card that big pushed the
 *     listings below the fold.
 *   · THE REGION DESCRIPTION LINE. The region was named three times — in the
 *     knob, in the card and in a line under the masthead. Once is enough.
 *   · THE SECOND LOCATION CONTROL. The place was printed in a knob, a pill
 *     and a description line: three answers to one question. There is one
 *     knob and one sentence now.
 *   · THE CHIP ROW AND THE PERMANENT TYPE ROW. Two more answers to "what am
 *     I looking for?" beside the category grid. The types still exist, one
 *     press away, where they can actually change the answer.
 *   · THE MARKET STRIP, THE DEALS RAIL, THE FEATURED BAND AND THE HOW-IT-
 *     WORKS DIALOG. Promotional surfaces that competed with the listings.
 *
 * What is NOT gone: the region scope itself (a URL you can share, and a hub
 * the feed is centred on), the provider directory behind Services, the
 * community-spotted sales, the honest loading, failed and empty states, and
 * the map.
 *
 * Search state still lives in the URL (`?q=`, `?kind=`, `?type=`, `?when=`,
 * `?price=`, `?trust=`, `?public_sale=`, `?region=`), so Back and deep links
 * restore the results.
 */

/** The legacy `?filter=` names, mapped onto the five categories. */
const FILTER_KIND = {
  goods: "listing",
  services: "service",
  rentals: "rental",
  equipment: "rental",
  opportunities: "opportunity",
  events: "event",
};

const WHEN_FILTERS = [
  { value: "", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "weekend", label: "This weekend" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

/**
 * What a person is DOING, as opposed to what a thing IS. These are posting
 * types, not categories, and they only make sense where they can change the
 * answer — so they live behind the filter door rather than on the page.
 */
const TYPE_FILTERS = [
  { value: "", label: "Everything" },
  { value: "available", label: "Available" },
  { value: "wanted", label: "Wanted" },
  { value: "scheduled", label: "Scheduled" },
  { value: "opportunity", label: "Opportunities" },
  { value: "post", label: "Posts" },
];

const REGION_KEY = "brief-discovery-region";

export default function ExplorePage({ demo = null }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // Search scopes call it `search`; the field calls it `q`. Both land here.
  const q = params.get("q") || params.get("search") || "";
  const kind = params.get("kind") || FILTER_KIND[params.get("filter")] || "";
  const type = params.get("type") || "";
  const when = params.get("when") || "";
  const price = params.get("price") || "";
  const trust = params.get("trust") || (params.get("min_level") === "3" ? "3" : "");
  const publicSale = params.get("public_sale") === "true";
  const category = categoryForKind(kind);
  // Services are people, not countable goods. That door gets its own read.
  const isServices = category === "services";
  const hasFilters = Boolean(kind || type || trust || when || price || publicSale);

  const [spotted, setSpotted] = useState([]);
  const spottedRequest = useRef(0);
  const [spottedError, setSpottedError] = useState("");
  const [providers, setProviders] = useState([]);
  const [providerStatus, setProviderStatus] = useState("idle");
  const [providerError, setProviderError] = useState("");
  const [providerReload, setProviderReload] = useState(0);
  const [spottedOpen, setSpottedOpen] = useState(false);
  const [nearby, setNearby] = useState([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [scopeOpen, setScopeOpen] = useState(false);
  const [sort, setSort] = useState("popular");
  const [savedRegion, setSavedRegion] = useState(() => {
    try { return localStorage.getItem(REGION_KEY); } catch { return null; }
  });

  // `demo` is the dev-only preview path: the real screen, with fixture data
  // and no network. Every other caller leaves it null and gets the live store.
  const liveItems = useOutsideStore((s) => s.items);
  const liveStatus = useOutsideStore((s) => s.status);
  const liveCursor = useOutsideStore((s) => s.cursor);
  const liveFailure = useOutsideStore((s) => s.failure);
  const loadFeed = useOutsideStore((s) => s.loadFeed);
  const loadMore = useOutsideStore((s) => s.loadMore);
  const liveLocation = useOutsideStore((s) => s.location);
  const loadLocation = useOutsideStore((s) => s.loadLocation);

  const items = demo ? demo.items : liveItems;
  const status = demo || isServices ? "ready" : liveStatus;
  const cursor = demo ? null : liveCursor;
  const failure = demo ? null : liveFailure;
  const location = demo ? demo.location : liveLocation;

  const sentinel = useRef(null);

  /**
   * The feed kinds for the current category, narrowed by the posting type.
   *
   * `null` means "do not narrow the feed" — which is different from asking
   * for nothing. A category with no compatible type keeps the category.
   */
  const kinds = useMemo(() => {
    const base = kindsForCategory(category);
    if (!type) return base;
    if (!base) return [type];
    const narrowed = base.filter((value) => value === type);
    return narrowed.length ? narrowed : base;
  }, [category, type]);

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

  /** The five categories are URL-backed, so Back restores the results. */
  const selectCategory = useCallback((value) => {
    const next = new URLSearchParams(params);
    next.delete("kind");
    next.delete("filter");
    // A posting type belongs to the category it was chosen under.
    next.delete("type");
    const kindValue = categoryByKey(value).kind;
    if (kindValue) next.set("kind", kindValue);
    setParams(next, { replace: false });
  }, [params, setParams]);

  // ── the region, and the point the feed is centred on ──────────────────────
  // Precedence: the URL (shareable) → the last region this device chose → the
  // region the saved location belongs to → the largest corridor we serve. A
  // market name is never the answer.
  const region = useMemo(() => {
    const slug = params.get("region") || savedRegion;
    return REGION_BY_SLUG[slug] || demo?.region || regionFromPlace(location?.label) || DEFAULT_REGION;
  }, [params, savedRegion, demo?.region, location?.label]);

  // A region that was *chosen* — in the URL or remembered on this device —
  // becomes the point the feed looks from. A region that was merely inferred
  // from where the person already is does NOT: it would move the search away
  // from them, which is the opposite of "around you".
  const regionChosen = useMemo(
    () => Boolean(params.get("region") || savedRegion),
    [params, savedRegion],
  );
  const anchor = useMemo(() => (regionChosen ? regionAnchor(region) : null), [regionChosen, region]);
  const feedScope = useMemo(
    () => (anchor
      ? { lat: anchor.lat, lng: anchor.lng, radius_km: REGION_SCOPE_RADIUS_KM }
      : null),
    [anchor],
  );

  // Reload whenever the URL state changes — which is also what makes the back
  // button restore the previous results — and whenever the person's own
  // location arrives, because that is the scope of the results.
  useEffect(() => {
    if (!demo && !isServices) {
      loadFeed({ kinds, query: q || null, scope: feedScope });
    }
  }, [demo, isServices, kinds, q, loadFeed, feedScope, location]);

  // COLD-START BACKFILL: nothing at the chosen radius is not the same as
  // nothing nearby. We ask for 50 km only when the clean feed is empty, and we
  // keep the result to Level 1–2 pages so the fallback never overclaims.
  useEffect(() => {
    if (demo || isServices || hasFilters || status !== "ready" || items.length) {
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
  }, [demo, isServices, hasFilters, status, items.length]);

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

  const loadSpotted = useCallback(async () => {
    if (demo || !region?.slug) return;
    const request = ++spottedRequest.current;
    setSpotted([]);
    try {
      const { data } = await spottedDealAPI.list(region.slug, q);
      if (request === spottedRequest.current) { setSpotted(data); setSpottedError(""); }
    } catch {
      if (request === spottedRequest.current) { setSpotted([]); setSpottedError("Spotted sales could not be loaded."); }
    }
  }, [demo, region?.slug, q]);
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
    patchParams({ region: next.slug });
  }, [patchParams]);

  // "Around me" — the person puts the search back where they are. The region
  // stops being a scope and the feed returns to their own point.
  const centreOnMe = useCallback(() => {
    try { localStorage.removeItem(REGION_KEY); } catch { /* private mode */ }
    setSavedRegion(null);
    patchParams({ region: "" });
  }, [patchParams]);

  const radius = Math.round(location?.radius_km ?? 15);
  // Every filter that is actually on, counted in one place. A filter that
  // cannot be turned off is not counted: the count must be a promise.
  const filterCount =
    (when ? 1 : 0) + (price ? 1 : 0) + (trust ? 1 : 0) + (type ? 1 : 0) + (publicSale ? 1 : 0);

  // The posting types that make sense for the category in force. Asking for a
  // "Wanted" post inside "Rentals" would return nothing, so it is not offered.
  const typeOptions = useMemo(() => {
    const base = kindsForCategory(category) || [];
    if (!base.length) return TYPE_FILTERS;
    return TYPE_FILTERS.filter((option) => !option.value || base.includes(option.value));
  }, [category]);

  // The control says WHAT is on, not only how much. A filter hidden behind a
  // number is a filter nobody can find.
  const filterSummary = useMemo(() => {
    const bits = [];
    if (when) bits.push(WHEN_FILTERS.find((option) => option.value === when)?.label || when);
    if (price) bits.push(price === "free" ? "No price" : "Priced");
    if (trust) bits.push("Lvl 3+");
    if (type) bits.push(typeOptions.find((option) => option.value === type)?.label || type);
    if (publicSale) bits.push("Spotted sales");
    return bits.join(" · ");
  }, [when, price, trust, type, publicSale, typeOptions]);

  // The posting types that make sense for the category in force. Asking for a
  // "Wanted" post inside "Rentals" would return nothing, so it is not offered.

  const visibleItems = useMemo(() => {
    // People live on the Home feed now. Explore is about what is on offer,
    // not a directory of faces; person records are filtered even when the
    // search endpoint returns them in its default kind set.
    const sourceItems = items.filter((item) => item.kind !== "person");
    const strict = trust === "3" ? sourceItems.filter((item) => ownerLevel(item.owner) >= 3) : null;
    // A strict Level 3+ door that finds fewer than four traders falls back to
    // Level 2+, as the design contract says. It never silently calls a Level 2
    // trader "verified": the card shows the real level.
    const permitted = strict
      ? (strict.length >= 4 ? strict : sourceItems.filter((item) => ownerLevel(item.owner) >= 2))
      : sourceItems;
    // Community-spotted sales are reports about a public sale. They belong
    // with the goods, and only when nothing else is narrowing the screen.
    const includeSpotted = !demo
      && (category === "all" || category === "goods" || publicSale)
      && (publicSale || (!when && !price && trust !== "3"));
    return includeSpotted ? [...spotted, ...permitted] : permitted;
  }, [items, trust, demo, category, when, price, publicSale, spotted]);

  const resultItems = isServices ? providerItems : visibleItems;
  const renderableStandard = resultItems.filter((item) => item.feed_kind !== "SPOTTED_DEAL");
  const spottedStandard = resultItems.filter((item) => item.feed_kind === "SPOTTED_DEAL");

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

  // Reset also clears the sticky search and every filter. Leaving any of them
  // in the URL made "Reset" look like it had done nothing.
  const clearAll = useCallback(() => {
    setSort("popular");
    patchParams({
      kind: "", filter: "", type: "", trust: "", min_level: "", when: "", price: "",
      public_sale: "", q: "", search: "", feed: "",
    });
  }, [patchParams]);

  const retryFeed = useCallback(() => {
    loadFeed({ kinds, query: q || null, scope: feedScope, force: true });
  }, [loadFeed, kinds, q, feedScope]);

  // The count on the deck is the count of what is on the screen. It is never
  // presented as the size of the region.
  const countText = useMemo(() => {
    const where = regionChosen ? region.name : "near you";
    if (status === "error") return "Results couldn’t load — try again.";
    if (status === "loading" || status === "idle") return "Loading results…";
    const n = resultItems.length;
    if (!n) return `No results ${where}.`;
    const bits = [`${n} result${n === 1 ? "" : "s"} loaded`];
    if (q) bits.push(`matching “${q}”`);
    bits.push(where);
    if (cursor) bits.push("more to load");
    return bits.join(" · ");
  }, [status, resultItems.length, regionChosen, region, q, cursor]);

  // The map is a second way to see the same search. It takes the search text
  // and the region; the screen says so rather than letting a pin stand in for
  // a region.
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

  /** Where the results are looking from, said in one honest line. */
  const scopeDetail = useMemo(() => {
    if (anchor) return `Centred on ${anchor.hub} · within ${REGION_SCOPE_RADIUS_KM} km`;
    if (!location || location.source === "unset") return "No area set — showing everything the network has";
    return `Within ${radius} km of ${locationLabel(location)}`;
  }, [anchor, location, radius]);

  // The filter door: everything that is not the search and not the category.
  const filterControls = (
    <div className="space-y-2.5">
      {typeOptions.length > 1 && (
        <div role="group" aria-label="Posting type" className="flex flex-wrap items-center gap-1">
          <span className="mr-1 w-12 shrink-0 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
            Looking for
          </span>
          {typeOptions.map((option) => (
            <Chip
              key={option.value || "all"}
              size="sm"
              active={type === option.value}
              onClick={() => patchParams({ type: option.value })}
              data-testid={`explore-type-${option.value || "all"}`}
            >
              {option.label}
            </Chip>
          ))}
        </div>
      )}

      <div role="group" aria-label="Time filter" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-12 shrink-0 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
          Time
        </span>
        {WHEN_FILTERS.map((option) => (
          <Chip
            key={option.value || "anytime"}
            size="sm"
            active={when === option.value}
            onClick={() => patchParams({ when: option.value })}
            data-testid={`explore-when-${option.value || "anytime"}`}
          >
            {option.label}
          </Chip>
        ))}
      </div>

      <div role="group" aria-label="Price filter" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-12 shrink-0 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
          Price
        </span>
        <Chip
          size="sm"
          active={price === "free"}
          onClick={() => patchParams({ price: price === "free" ? "" : "free" })}
          data-testid="explore-price-free"
        >
          No price
        </Chip>
        <Chip
          size="sm"
          active={price === "priced"}
          onClick={() => patchParams({ price: price === "priced" ? "" : "priced" })}
          data-testid="explore-price-priced"
        >
          Priced
        </Chip>
      </div>

      <div role="group" aria-label="Trust filter" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-12 shrink-0 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
          Standing
        </span>
        <button
          type="button"
          aria-pressed={trust === "3"}
          aria-label="Only Level 3 or higher traders"
          title="Only pages with a completed trade record (Level 3+)"
          onClick={() => patchParams({ trust: trust === "3" ? "" : "3", min_level: "" })}
          data-testid="regions-trust"
          className={cn(
            "inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-2xs font-bold transition-colors",
            trust === "3"
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-edge-2 bg-surface-1 text-ink-3 hover:border-ink-4 hover:text-ink-1",
          )}
        >
          <ShieldCheck size={12} aria-hidden="true" /> Lvl 3+ only
        </button>
      </div>

      <div role="group" aria-label="Community sales filter" className="flex flex-wrap items-center gap-1">
        <span className="mr-1 w-12 shrink-0 text-micro font-bold uppercase tracking-[0.1em] text-ink-4">
          Community
        </span>
        <button
          type="button"
          aria-pressed={publicSale}
          onClick={() => patchParams({ public_sale: publicSale ? "" : "true" })}
          data-testid="explore-public-sale"
          className={cn(
            "inline-flex h-8 items-center rounded-full border px-2.5 text-2xs font-bold transition-colors",
            publicSale
              ? "border-brand-600 bg-brand-600 text-white"
              : "border-edge-2 bg-surface-1 text-ink-3 hover:border-ink-4 hover:text-ink-1",
          )}
        >
          Spotted sales
        </button>
      </div>

      {filterCount > 0 && (
        <button
          type="button"
          data-testid="explore-clear-all"
          onClick={clearAll}
          className="inline-flex h-8 items-center gap-1 rounded-full px-2 text-2xs font-bold text-ink-3 hover:bg-surface-2 hover:text-ink-1"
        >
          <X size={12} aria-hidden="true" /> Clear all filters
        </button>
      )}
    </div>
  );

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3">
      {/* ── 1 · the masthead: what this screen is, and where it is looking ── */}
      <header className="space-y-2.5" data-testid="discover-masthead">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="ds-eyebrow">Wasta · Explore</p>
            <h1 className="mt-0.5 text-title-page font-black tracking-tight text-ink-1">Explore</h1>
          </div>
          <div className="mt-1 flex shrink-0 items-center gap-3">
            {/* SAVED is a route, not a filter: the cards live on this device,
                and opening them is a place to go, not a way to narrow the
                feed. It sits with the regions door for the same reason. */}
            <Link
              to="/discover/favorites"
              data-testid="discover-saved-pill"
              className="inline-flex items-center gap-1 text-2xs font-bold text-ink-3 hover:text-ink-1"
            >
              <Heart size={12} aria-hidden="true" />
              Saved
            </Link>
            <Link
              to="/regions/all"
              className="inline-flex items-center gap-1 text-2xs font-bold text-ink-3 hover:text-ink-1"
            >
              <Compass size={13} aria-hidden="true" />
              All regions
            </Link>
          </div>
        </div>

        {/* THE SCOPE — one knob, one sentence, and one panel behind it.
            The knob chooses a corridor; the sentence says what the results
            are actually looking from — the chosen corridor, or the person's
            own point. The sentence is also the door to the full controls
            (GPS, typed area, radius), so a person whose device refuses a
            location never has to hunt for the alternative.

            There is deliberately no second location pill here: the screen
            used to print the region in the knob, the person's town in a pill
            and the radius in a third line, which is three answers to one
            question. */}
        <div className="flex flex-wrap items-center gap-2">
          <RegionPicker
            region={region}
            onSelect={chooseRegion}
            avoidSelector='[data-testid="discover-toolbar"]'
          />
          {anchor && (
            <button
              type="button"
              onClick={centreOnMe}
              data-testid="regions-scope-toggle"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full border border-edge-2 px-2.5 text-2xs font-bold text-ink-3 transition-colors hover:border-ink-4 hover:text-ink-1"
            >
              <X size={10} aria-hidden="true" />
              Look around me
            </button>
          )}
        </div>

        {/* The sentence is a caption, not a second pill: a screen that wears
            two identical location buttons has said the same thing twice and
            made neither of them clear. One press opens the full controls. */}
        <button
          type="button"
          onClick={() => setScopeOpen((value) => !value)}
          aria-expanded={scopeOpen}
          aria-controls="explore-scope-panel"
          data-testid="regions-scope-label"
          title="Change the area the results are looking from"
          className={cn(
            "-mt-1 inline-flex max-w-full items-center gap-1 text-left text-2xs transition-colors",
            scopeOpen ? "text-brand-700 dark:text-brand-300" : "text-ink-4 hover:text-ink-2",
          )}
        >
          <MapPin size={10} aria-hidden="true" className="shrink-0" />
          <span className="truncate">{scopeDetail}</span>
          <span className="shrink-0 font-bold underline underline-offset-2">Change</span>
        </button>

        {scopeOpen && (
          <div
            id="explore-scope-panel"
            data-testid="explore-scope-panel"
            className="space-y-2 rounded-xl border border-edge-1 bg-surface-1 p-2.5"
          >
            <p className="text-2xs text-ink-3">
              {anchor
                ? `Results are centred on ${anchor.hub}. Switch to your own point, or type an area below.`
                : "Results are looking from your own point. Type an area to move them, or use the device location."}
            </p>
            <LocationBar showRadius />
          </div>
        )}
      </header>

      {/* ── 2 · the one search, and the one filter door ──────────────────── */}
      <div
        data-testid="discover-toolbar"
        className="sticky top-[var(--header-h)] z-30 -mx-1 space-y-2 bg-surface-0/95 px-1 py-2 backdrop-blur supports-[backdrop-filter]:bg-surface-0/85"
      >
        <MarketplaceSearch
          value={q}
          onChange={(value) => patchParams({ q: (value || "").trim() })}
          onSubmit={(term) => navigate(`/regions?q=${encodeURIComponent(term)}${kind ? `&kind=${kind}` : ""}`)}
          filtersOpen={filtersOpen && !isServices}
          onToggleFilters={isServices ? null : () => setFiltersOpen((value) => !value)}
          filterCount={filterCount}
          filterSummary={filterSummary}
          variant="compact"
          placeholder="Search goods, services, rentals and events"
          aria-label="Search everything"
          showCategories={false}
        >
          {filterControls}
        </MarketplaceSearch>

        {/* THE CATEGORIES — the same five everywhere, in a wrapping grid that
            is never a carousel. A category hidden behind a swipe is a
            category missing from the product. */}
        <CategoryRow value={category} onSelect={selectCategory} />
      </div>

      {!demo && !isServices && (
        <>
          <SpotDealModal
            region={region?.slug}
            open={spottedOpen}
            onClose={() => setSpottedOpen(false)}
            onCreated={loadSpotted}
          />
          {spottedError && <p role="alert" className="text-2xs text-danger">{spottedError}</p>}
        </>
      )}

      {/* ── 2 · the results ───────────────────────────────────────────────── */}
      {!isServices && (
        <ResultDeck
          countText={countText}
          countState={status === "error" ? "error" : "ready"}
          sort={sort}
          onSort={setSort}
          dirty={Boolean(q || kind || filterCount || sort !== "popular")}
          onReset={clearAll}
          view="list"
          onViewChange={(next) => { if (next === "map") openMap(); }}
        />
      )}

      <section aria-live="polite" aria-busy={status === "loading"} className="space-y-3">
        {isServices ? (
          <ServiceProvidersPanel
            status={providerStatus}
            error={providerError}
            items={providerItems}
            query={q}
            region={region}
            onRetry={() => setProviderReload((n) => n + 1)}
          />
        ) : status === "loading" && !items.length ? (
          <FeedSkeleton />
        ) : status === "error" && !items.length ? (
          <FeedErrorPanel failure={failure} onRetry={retryFeed} region={region} onPublish={postHere} />
        ) : visibleItems.length === 0 && nearby.length > 0 ? (
          <ColdStartRail
            items={nearby}
            region={region}
            radius={radius}
          />
        ) : visibleItems.length === 0 && trust === "3" && items.length > 0 ? (
          <StandingEmptyPanel
            onShowEvery={() => patchParams({ trust: "", min_level: "" })}
          />
        ) : visibleItems.length === 0 ? (
          <EmptyPanel query={q} region={region} onPublish={postHere} onClear={clearAll} />
        ) : (
          <>
            {status === "error" && (
              <FeedErrorStrip failure={failure} onRetry={retryFeed} />
            )}

            <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="explore-results">
              {sortedStandard.map((item) => (
                <li key={`${item.kind}:${item.id}`} className="min-w-0">
                  <ListingCard item={item} />
                </li>
              ))}
            </ul>

            {spottedStandard.length > 0 && (
              <section aria-labelledby="discover-spotted-heading" className="space-y-2">
                <div>
                  <p className="ds-eyebrow">Community reports</p>
                  <h2 id="discover-spotted-heading" className="mt-0.5 text-title-section font-black tracking-tight text-ink-1">
                    Spotted public sales
                  </h2>
                </div>
                <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                  {spottedStandard.map((item) => (
                    <li key={`${item.kind}:${item.id}`} className="min-w-0">
                      <ListingCard item={item} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div ref={sentinel} className="h-4" aria-hidden="true" />
            {status === "loading_more" && (
              <p className="py-3 text-center text-2xs text-ink-4">Loading more…</p>
            )}
            {!cursor && resultItems.length > 4 && (
              <p className="py-3 text-center text-2xs text-ink-4">
                That&apos;s everything in this scope.
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** A provider row, shaped like every other listing card.
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
    return <FeedSkeleton />;
  }
  if (status === "error") {
    return <ErrorPanel onRetry={onRetry} message={error} />;
  }
  if (!items.length) {
    return (
      <section
        data-testid="service-providers-empty"
        className="rounded-2xl border border-dashed border-edge-2 bg-surface-1 p-6 text-center"
      >
        <h2 className="text-sm font-bold text-ink-1">No service providers here yet</h2>
        <p className="mx-auto mt-1 max-w-md text-2xs text-ink-3">
          {query
            ? `Nothing matched “${query}” in this area.`
            : `Nobody in ${region?.name || "this area"} has published a bookable service yet.`}
          {" "}Services are listed one provider at a time, so a page needs at least one
          service before it appears.
        </p>
      </section>
    );
  }
  return (
    <ul className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="service-providers">
      {items.map((item) => (
        <li key={`${item.kind}:${item.id}`} className="min-w-0">
          <ListingCard item={item} />
        </li>
      ))}
    </ul>
  );
}

function FeedSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" data-testid="explore-skeleton">
      {[0, 1, 2, 3].map((index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-edge-1 bg-surface-1">
          <div className="aspect-[4/3] animate-pulse bg-surface-2" />
          <div className="space-y-2 p-3">
            <div className="h-3 w-3/4 animate-pulse rounded-full bg-surface-2" />
            <div className="h-3 w-1/2 animate-pulse rounded-full bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrorPanel({ onRetry, message }) {
  return (
    <div className="rounded-2xl border border-danger/30 bg-surface-1 p-5 text-center" role="alert">
      <p className="text-sm font-bold text-ink-1">{message || "Something went wrong."}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-3 inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-2xs font-bold text-white"
      >
        Try again
      </button>
    </div>
  );
}

function FeedErrorPanel({ failure, onRetry, region, onPublish }) {
  return (
    <div
      data-testid="explore-error"
      role="alert"
      className="rounded-2xl border border-danger/30 bg-surface-1 p-5"
    >
      <h2 className="text-sm font-bold text-ink-1">
        {failure?.title || "We couldn’t load these results."}
      </h2>
      <p className="mt-1 text-2xs text-ink-3">
        {failure?.description
          || "The request did not come back. Nothing is wrong with your search — it is safe to try again."}
      </p>
      {failure?.technical && (
        <p className="mt-2 rounded-lg bg-surface-2 px-2.5 py-1.5 text-2xs text-ink-4">
          Technical note: {failure.technical}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          data-testid="explore-retry"
          className="inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-2xs font-bold text-white"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onPublish}
          data-testid="explore-post"
          className="inline-flex h-10 items-center rounded-xl border border-edge-2 px-4 text-2xs font-bold text-ink-2"
        >
          List something in {region?.hub || "your area"}
        </button>
      </div>
    </div>
  );
}

function FeedErrorStrip({ failure, onRetry }) {
  return (
    <div
      role="alert"
      data-testid="explore-error-strip"
      className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/30 bg-surface-1 px-3 py-2"
    >
      <span className="min-w-0 flex-1 text-2xs text-ink-2">
        {failure?.title || "The last page could not be loaded."}
      </span>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex h-8 items-center rounded-lg border border-edge-2 px-3 text-2xs font-bold text-ink-2"
      >
        Try again
      </button>
    </div>
  );
}

/**
 * THE LEVEL 3+ DOOR, WHEN IT FINDS NOTHING.
 *
 * A strict standing door that finds no Level 3 page must not pretend the
 * scope is empty — the pages are there, they just do not have the record this
 * door asks for. So the screen says exactly that, and offers the way out:
 * show every page, with each card still wearing its real level.
 */
function StandingEmptyPanel({ onShowEvery }) {
  return (
    <section
      data-testid="explore-filtered-empty"
      className="rounded-2xl border border-dashed border-edge-2 bg-surface-1 p-6 text-center"
    >
      <h2 className="text-sm font-bold text-ink-1">No Level 3+ traders here yet</h2>
      <p className="mx-auto mt-1 max-w-md text-2xs text-ink-3">
        There are pages in this scope, but none has the completed trade record
        this door asks for. Showing them here would overstate them, so they
        are not — but you can still see them, each wearing its real level.
      </p>
      <button
        type="button"
        onClick={onShowEvery}
        data-testid="explore-show-every"
        className="mt-3 inline-flex h-10 items-center rounded-xl border border-edge-2 px-4 text-2xs font-bold text-ink-2 transition-colors hover:border-ink-4 hover:text-ink-1"
      >
        Show every page
      </button>
    </section>
  );
}

function EmptyPanel({ query, region, onPublish, onClear }) {  return (
    <section
      data-testid="explore-empty"
      className="rounded-2xl border border-dashed border-edge-2 bg-surface-1 p-6 text-center"
    >
      <h2 className="text-sm font-bold text-ink-1">
        {query ? `Nothing matched “${query}”` : "Nothing here yet"}
      </h2>
      <p className="mx-auto mt-1 max-w-md text-2xs text-ink-3">
        {region?.hub
          ? `No listings have been published around ${region.hub} in this scope.`
          : "No listings have been published in this scope yet."}
        {" "}A wider radius, or a different area, may show more.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={onClear}
          data-testid="explore-empty-clear"
          className="inline-flex h-10 items-center rounded-xl border border-edge-2 px-4 text-2xs font-bold text-ink-2"
        >
          Clear the filters
        </button>
        <button
          type="button"
          onClick={onPublish}
          data-testid="explore-empty-publish"
          className="inline-flex h-10 items-center rounded-xl bg-brand-600 px-4 text-2xs font-bold text-white"
        >
          List the first one
        </button>
      </div>
    </section>
  );
}

/**
 * COLD START — the quiet corridor.
 *
 * Nothing inside the chosen radius is not the same as nothing at all. When
 * the screen is empty, this asks one wider question and shows what came back,
 * clearly labelled as further out. It never presents those records as if they
 * were nearby.
 */
function ColdStartRail({ items, region, radius, onSavedChanged }) {
  return (
    <section
      data-testid="discover-cold-start"
      className="rounded-2xl border border-edge-1 bg-surface-1 p-3"
    >
      <p className="ds-eyebrow">Quiet within {radius} km</p>
      <h2 className="mt-0.5 text-title-section font-black tracking-tight text-ink-1">
        Popular in {region?.name || "your area"}{" "}
        {/* The rail is every level, and says so: these records were not
            filtered by standing, because on a quiet page the alternative to a
            Level 1 page is no page at all. */}
        <span className="font-semibold text-ink-3">(all levels)</span>
      </h2>
      <p className="mt-1 text-2xs text-ink-3">
        Nothing has been published inside {radius} km. These are further out.
      </p>
      <ul className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-3">
        {items.map((item) => (
          <li key={`${item.kind}:${item.id}`} className="min-w-0">
            <ListingCard item={item} onSavedChanged={onSavedChanged} />
          </li>
        ))}
      </ul>
    </section>
  );
}
