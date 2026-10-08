import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Store, MapPin, Building2, Search, Crosshair, Plus, Minus, List, X, ChevronRight,
  CloudOff, ZoomIn,
} from "lucide-react";
import MarketMap from "@/components/map/MarketMap";
import MapSheet from "@/components/map/MapSheet";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import SearchInput from "@/components/ui/SearchInput";
import { mapAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num } from "@/lib/formatters";
import useMapViewport from "@/lib/useMapViewport";
import { areaSummary, categoryLabel, formatCount, KIND_COLORS } from "@/lib/mapViewport";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MAP — find something to buy near you.
//
// The old screen loaded the whole directory (7,640 places), built a Leaflet
// marker for each one and waited. On a phone that is a freeze, not a delay —
// and it is also the wrong product: a wall of pins is not a marketplace.
//
// What this screen does instead:
//
//   1. VIEWPORT LOADING. The map asks for one screenful at a time
//      (`GET /api/map/viewport?bbox=…&zoom=…`), debounced and cancelled.
//   2. SERVER-SIDE CLUSTERING. Zoomed out it draws ~20–200 aggregate bubbles
//      ("7.6K places", "1,240"); zoomed in it draws real pins, capped at 300.
//   3. COUNTERS ARE FILTERS. Markets / Vendors / Places each load one dataset,
//      never all three at once.
//   4. PROGRESSIVE DISCLOSURE. Zoom 2–7 regions, 8–11 cities, 12–14 markets and
//      vendors, 15+ individual businesses — details only when a pin is tapped.
//   5. MAP + LIST. The map is a discovery surface; the list is where you act.
//
// Tiles come from the server config (see MarketMap). Attribution is ODbL and
// travels with every row that came from OpenStreetMap.
// ─────────────────────────────────────────────────────────────────────────────

const COUNTERS = [
  { value: "markets", label: "Markets", icon: MapPin },
  { value: "vendors", label: "Vendors", icon: Store },
  { value: "places", label: "Places", icon: Building2 },
];

// A phone can hold a few hundred objects comfortably. The server caps us at
// `points_per_layer`; asking for fewer keeps the payload (and the canvas) small
// without changing what the user sees at these zoom levels.
const VIEW_LIMIT = 200;

const QUICK = [
  { value: "", label: "All" },
  { value: "food", label: "Food" },
  { value: "electronics", label: "Electronics" },
  { value: "clothing", label: "Clothing" },
  { value: "wholesale", label: "Wholesale" },
  { value: "services", label: "Services" },
];

export default function MapPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const mapRef = useRef(null);

  const [config, setConfig] = useState(null);
  const [counts, setCounts] = useState(null);
  const [error, setError] = useState("");
  const [view, setView] = useState(null);
  const [kind, setKind] = useState("all");
  const [filter, setFilter] = useState("");
  const [search, setSearch] = useState("");     // already debounced by SearchInput
  const [selected, setSelected] = useState(null);
  const [mode, setMode] = useState("map");        // map | list

  // ── boot: tile config + headline counters (two small calls) ───────────────
  useEffect(() => {
    let live = true;
    Promise.all([mapAPI.config(), mapAPI.counts()])
      .then(([c, n]) => {
        if (!live) return;
        setConfig(c.data);
        setCounts(n.data);
      })
      .catch((e) => live && setError(apiError(e, "The map could not be started")));
    return () => { live = false; };
  }, []);

  // SearchInput debounces typing itself; the term is part of the viewport query
  // from two characters in, and below that the map just shows the area.
  const term = search.trim();
  const searching = term.length >= 2;
  const scope = searching ? "network" : "viewport";

  const { data, loading, error: viewError, offline } = useMapViewport({
    bbox: view?.bbox,
    zoom: view?.zoom,
    kind,
    q: term,
    filter,
    scope,
    limit: VIEW_LIMIT,
    enabled: Boolean(config) && (scope === "network" || Boolean(view?.bbox)),
  });

  const points = data?.points || [];
  const clusters = data?.clusters || [];

  const onViewChange = useCallback((next) => setView(next), []);

  // A network-wide search returns pins the current rectangle may not contain —
  // go to them, or the results look empty.
  useEffect(() => {
    if (scope !== "network" || !points.length) return;
    mapRef.current?.fit(points, 0.3);
  }, [scope, points]);

  // ── actions ──────────────────────────────────────────────────────────────
  const locateMe = useCallback(() => {
    if (!navigator.geolocation) {
      toast.error("This phone will not give a location — search a market instead");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => mapRef.current?.flyTo(pos.coords.latitude, pos.coords.longitude, 15),
      () => toast.error("Location is off — allow it, or search for your market"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  }, []);

  const onCluster = useCallback((cluster) => {
    mapRef.current?.flyTo(cluster.lat, cluster.lng, Math.min(19, (view?.zoom || 8) + 2));
  }, [view?.zoom]);

  const onSelect = useCallback((item) => {
    setSelected(item);
    if (mode === "list") setMode("map");
  }, [mode]);

  // ── ?focus=<id> — arriving from a place or market screen ──────────────────
  // A place profile and a market screen both say "show on the map". The map
  // answers with the sheet open on that row instead of dropping you on an
  // uncentred map and expecting you to find it yourself.
  const focusId = searchParams.get("focus");
  useEffect(() => {
    if (!focusId || !config) return undefined;
    let live = true;
    mapAPI.place(focusId)
      .then(({ data: d }) => {
        if (!live) return;
        setSelected({ id: d.id, kind: d.kind, name: d.name, lat: d.lat, lng: d.lng, category: d.category });
        setMode("map");
        mapRef.current?.flyTo(d.lat, d.lng, 17);
        searchParams.delete("focus");
        setSearchParams(searchParams, { replace: true });
      })
      .catch(() => live && toast.error("That place is no longer in the directory"));
    return () => { live = false; };
  }, [focusId, config]);

  const nearest = useMemo(
    () => [...points].sort((a, b) => (a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)).slice(0, 40),
    [points],
  );

  if (error) return <EmptyState icon={MapPin} title="The map is down" description={error} />;
  if (!config) return <PageSpinner label="Starting the map…" />;

  const shownCounts = data?.counts || {};
  const attribution = config.tiles?.attribution;

  return (
    <div className="flex flex-col h-[calc(100vh-7rem)] min-h-[26rem]">
      {/* ── search + list toggle ─────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search products, shops or markets"
          className="flex-1"
        />
        <button type="button" onClick={() => setMode((m) => (m === "map" ? "list" : "map"))}
          className={cn("h-9 px-3 rounded-xl text-xs font-semibold inline-flex items-center gap-1.5 cursor-pointer",
            mode === "list" ? "bg-brand-500/20 text-brand-200" : "bg-white/[0.07] text-ink-2")}
          aria-label={mode === "list" ? "Show the map" : "Show the list"}>
          {mode === "list" ? <MapPin size={14} /> : <List size={14} />}
          {mode === "list" ? "Map" : "List"}
        </button>
      </div>

      {/* ── counters that are filters ────────────────────────────────────── */}
      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
        {COUNTERS.map(({ value, label, icon: Icon }) => {
          const active = kind === value;
          const total = counts?.[value];
          return (
            <button key={value} type="button"
              onClick={() => setKind((k) => (k === value ? "all" : value))}
              className={cn("shrink-0 h-8 px-3 rounded-full text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors",
                active ? "bg-black/70 text-white" : "bg-white/[0.05] text-ink-3 hover:text-ink-1")}>
              <span className="w-2 h-2 rounded-full"
                style={{ background: KIND_COLORS[value], opacity: active || kind === "all" ? 1 : 0.45 }} />
              <Icon size={12} />
              {label}
              <span className="font-mono opacity-70">{formatCount(total)}</span>
            </button>
          );
        })}
        {kind !== "all" && (
          <button type="button" onClick={() => setKind("all")}
            className="shrink-0 h-8 px-2.5 rounded-full text-2xs text-ink-4 hover:text-ink-1 inline-flex items-center gap-1 cursor-pointer">
            <X size={11} /> all layers
          </button>
        )}
      </div>

      {/* ── quick filters (trade, not OSM keys) ──────────────────────────── */}
      {(kind === "all" || kind === "places") && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
          {QUICK.map((q) => {
            const facet = (counts?.facets || []).find((f) => f.value === q.value);
            const active = filter === q.value;
            return (
              <button key={q.label} type="button" onClick={() => setFilter(q.value)}
                className={cn("shrink-0 h-7 px-2.5 rounded-full text-2xs font-medium cursor-pointer transition-colors",
                  active ? "bg-brand-500/20 text-brand-200" : "text-ink-4 hover:text-ink-2")}>
                {q.label}
                {facet && q.value ? <span className="ml-1 opacity-60 font-mono">{formatCount(facet.count)}</span> : null}
              </button>
            );
          })}
        </div>
      )}

      {/* ── the map / the list ──────────────────────────────────────────── */}
      <div className="relative mt-2 flex-1 min-h-0 rounded-3xl overflow-hidden glass-strong">
        {mode === "map" ? (
          <>
            <MarketMap
              ref={mapRef}
              config={config}
              initialView={view}
              points={points}
              clusters={clusters}
              selectedId={selected?.id}
              onSelect={onSelect}
              onCluster={onCluster}
              onViewChange={onViewChange}
            />

            {/* status line — what the screen is actually showing */}
            <div className="absolute top-2 left-2 right-2 z-[500] flex items-start gap-1.5 pointer-events-none">
              <p className="text-2xs px-2 py-1 rounded-full bg-black/60 text-white/80 backdrop-blur-sm">
                {loading
                  ? (searching ? "Searching the network…" : "Loading this area…")
                  : searching
                    ? `${formatCount(shownCounts.markets + shownCounts.vendors + shownCounts.places)} matches · whole network`
                    : areaSummary(shownCounts, kind)}
              </p>
              {offline && (
                <p className="text-2xs px-2 py-1 rounded-full bg-amber-500/20 text-amber-200 inline-flex items-center gap-1">
                  <CloudOff size={10} /> last loaded area
                </p>
              )}
              {data?.truncated && (
                <p className="text-2xs px-2 py-1 rounded-full bg-black/60 text-white/60">
                  showing {num(points.length)} of {formatCount(shownCounts.places + shownCounts.vendors + shownCounts.markets)}
                </p>
              )}
            </div>

            {/* map controls, thumb-reachable */}
            <div className="absolute right-2 bottom-20 z-[500] flex flex-col gap-1.5">
              <MapButton onClick={locateMe} label="My location"><Crosshair size={15} /></MapButton>
              <MapButton onClick={() => mapRef.current?.zoomBy(1)} label="Zoom in"><Plus size={15} /></MapButton>
              <MapButton onClick={() => mapRef.current?.zoomBy(-1)} label="Zoom out"><Minus size={15} /></MapButton>
            </div>

            {viewError && !offline && (
              <p className="absolute inset-x-3 top-10 z-[500] text-2xs text-red-300 bg-red-500/10 rounded-xl px-2.5 py-1.5">
                {viewError}
              </p>
            )}

            {!loading && !points.length && !clusters.length && (
              <div className="absolute inset-0 z-[450] flex items-center justify-center pointer-events-none">
                <p className="text-xs text-white/60 bg-black/60 rounded-2xl px-4 py-3 text-center">
                  {searching ? "Nothing matches that search." : "Nothing mapped here yet."}
                  <span className="block text-2xs text-white/40 mt-0.5">
                    {searching ? "Try fewer words." : "Zoom out, or open Markets to map this area."}
                  </span>
                </p>
              </div>
            )}

            <MapSheet item={selected} onClose={() => setSelected(null)}
              onFocus={(it) => mapRef.current?.flyTo(it.lat, it.lng, 17)} />

            {attribution && (
              <p className="absolute bottom-1 left-2 z-[400] text-[10px] text-white/45 bg-black/40 rounded px-1.5 py-0.5"
                style={{ display: selected ? "none" : "block" }}
                dangerouslySetInnerHTML={{ __html: attribution }} />
            )}
          </>
        ) : (
          <NearbyList items={nearest} kind={kind} loading={loading} selectedId={selected?.id}
            onSelect={onSelect} onOpenMarkets={() => navigate("/markets")} />
        )}
      </div>
    </div>
  );
}

function MapButton({ children, onClick, label }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="w-9 h-9 rounded-xl bg-black/65 text-white/85 hover:text-white hover:bg-black/80 backdrop-blur-sm inline-flex items-center justify-center cursor-pointer">
      {children}
    </button>
  );
}

function NearbyList({ items, kind, loading, selectedId, onSelect, onOpenMarkets }) {
  if (loading && !items.length) return <PageSpinner label="Reading this area…" />;
  if (!items.length) {
    return (
      <div className="h-full flex items-center justify-center p-6">
        <EmptyState icon={ZoomIn} title="Nothing listed in this area"
          description="Zoom out on the map, or clear the filters."
          action={<button type="button" onClick={onOpenMarkets}
            className="text-xs text-brand-300 hover:text-brand-200 cursor-pointer">Open the market catalog</button>} />
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto overscroll-contain p-2 space-y-1.5">
      <p className="text-2xs text-ink-4 px-1 pb-1">
        {num(items.length)} {kind === "all" ? "places" : kind} nearest to the middle of the map
      </p>
      {items.map((it) => (
        <button key={`${it.kind}-${it.id}`} type="button" onClick={() => onSelect(it)}
          className={cn("w-full text-left glass rounded-2xl p-3 flex items-center gap-3 cursor-pointer",
            selectedId === it.id ? "ring-1 ring-brand-500/60" : "glass-hover")}>
          <span className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center"
            style={{ background: `${KIND_COLORS[it.kind] || "#60A5FA"}22`, color: KIND_COLORS[it.kind] || "#60A5FA" }}>
            {it.kind === "vendors" ? <Store size={14} /> : it.kind === "markets" ? <MapPin size={14} /> : <Building2 size={14} />}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-1 truncate">{it.name}</span>
            <span className="block text-2xs text-ink-4 truncate">
              {it.kind === "vendors" && `@${it.handle}`}
              {it.kind === "markets" && `${[it.city, it.country].filter(Boolean).join(", ")} · ${num(it.members || 0)} registered`}
              {it.kind === "places" && categoryLabel(it.category)}
              {it.zone_name ? ` · ${it.zone_name}` : ""}
            </span>
          </span>
          {typeof it.distance_km === "number" && (
            <span className="digital text-xs text-ink-3 shrink-0">{it.distance_km} km</span>
          )}
          <ChevronRight size={14} className="text-ink-4 shrink-0" />
        </button>
      ))}
    </div>
  );
}
