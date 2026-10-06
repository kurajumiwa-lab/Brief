import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Store, MapPin, Building2, X } from "lucide-react";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { surfaceAPI, apiError } from "@/lib/api";
import { toast } from "@/components/ui/Toast";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// MAP — vendors, markets, and public places as pins on real tiles.
//
// Plain Leaflet (no react-leaflet): we own the mount in a useEffect, zero
// version conflicts, one dependency. Tiles are OpenStreetMap — free, no API
// key, ODbL-attributed (the same licence as the place data on top of them).
// Pins are divIcons (CSS circles), so there are no marker image paths to
// break under a bundler. Tap a pin for its card; your location is the anchor.
// A cluster of pins with no claimed places is an unworked market; a market
// with pins but no members is a place to register as patron.
// ─────────────────────────────────────────────────────────────────────────────

const LAYERS = [
  { value: "markets", label: "Markets", icon: MapPin, color: "#A78BFA" },
  { value: "vendors", label: "Vendors", icon: Store, color: "#FBBF24" },
  { value: "places", label: "Places", icon: Building2, color: "#60A5FA" },
];

function pinIcon(color, size = 14) {
  return L.divIcon({
    className: "",
    html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:9999px;background:${color};border:2px solid rgba(10,14,20,0.85);box-shadow:0 1px 6px rgba(0,0,0,0.5)"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

export default function MapPage() {
  const navigate = useNavigate();
  const divRef = useRef(null);
  const mapRef = useRef(null);
  const layersRef = useRef({});
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [active, setActive] = useState({ markets: true, vendors: true, places: true });
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let live = true;
    surfaceAPI.map().then((r) => live && setData(r.data)).catch((e) => live && setError(apiError(e, "The map could not be loaded")));
    return () => { live = false; };
  }, []);

  // Mount the map once the pins exist.
  useEffect(() => {
    if (!data || !divRef.current || mapRef.current) return;
    const center = data.viewer?.lat != null
      ? [data.viewer.lat, data.viewer.lng]
      : data.markets[0] ? [data.markets[0].lat, data.markets[0].lng]
      : [-1.2867, 36.8172]; // Nairobi
    const map = L.map(divRef.current, { zoomControl: true, attributionControl: true }).setView(center, 11);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
    }).addTo(map);
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = {};
    };
  }, [data]);

  // (Re)draw layers when the data or the active toggles change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    Object.values(layersRef.current).forEach((g) => map.removeLayer(g));
    layersRef.current = {};

    const add = (key, items, color, size) => {
      if (!active[key]) return;
      const g = L.layerGroup();
      items.forEach((it) => {
        if (it.lat == null) return;
        const m = L.marker([it.lat, it.lng], { icon: pinIcon(color, size) });
        m.on("click", () => setSelected({ kind: key, item: it }));
        g.addLayer(m);
      });
      g.addTo(map);
      layersRef.current[key] = g;
    };
    add("markets", data.markets, "#A78BFA", 18);
    add("vendors", data.vendors, "#FBBF24", 13);
    add("places", data.places, "#60A5FA", 11);
  }, [data, active]);

  // Fit to the pins of the active layers on first draw.
  const fitted = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data || fitted.current) return;
    const pts = [
      ...data.markets.filter((m) => active.markets).map((m) => [m.lat, m.lng]),
      ...data.vendors.filter((m) => active.vendors).map((m) => [m.lat, m.lng]),
      ...data.places.filter((m) => active.places).map((m) => [m.lat, m.lng]),
    ].filter((p) => p[0] != null);
    if (pts.length >= 2) {
      map.fitBounds(L.latLngBounds(pts).pad(0.2));
      fitted.current = true;
    }
  }, [data, active]);

  if (error) return <EmptyState icon={MapPin} title="The map is down" description={error} />;
  if (!data) return <PageSpinner label="Drawing the map…" />;

  const counts = { markets: data.markets.length, vendors: data.vendors.length, places: data.places.length };

  return (
    <div className="relative h-[calc(100vh-7rem)] rounded-3xl overflow-hidden glass-strong">
      <div ref={divRef} className="absolute inset-0" style={{ background: "#0b0f14" }} />

      {/* Layer toggles */}
      <div className="absolute top-3 left-3 right-3 z-[500] flex gap-1.5 flex-wrap">
        {LAYERS.map((l) => (
          <button key={l.value} type="button"
            onClick={() => setActive((a) => ({ ...a, [l.value]: !a[l.value] }))}
            className={cn("rounded-full px-3 h-8 text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer backdrop-blur",
              active[l.value] ? "bg-black/70 text-white" : "bg-black/40 text-white/50")}>
            <span className="w-2 h-2 rounded-full" style={{ background: l.color, opacity: active[l.value] ? 1 : 0.4 }} />
            {l.label} <span className="font-mono text-2xs opacity-70">{num(counts[l.value])}</span>
          </button>
        ))}
      </div>

      {/* Selected pin card */}
      {selected && (
        <div className="absolute bottom-3 left-3 right-3 z-[500] glass-strong rounded-2xl p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-ink-1 truncate">{selected.item.name}</p>
              <p className="text-2xs text-ink-4 mt-1 truncate">
                {selected.kind === "vendor" && `@${selected.item.handle} · ${(selected.item.categories || []).join(" · ") || "categories not stated"}`}
                {selected.kind === "market" && `${[selected.item.city, selected.item.country].filter(Boolean).join(", ")} · ${num(selected.item.member_count)} registered · ${num(data.places.filter((p) => p.zone_name === selected.item.name).length)} places mapped`}
                {selected.kind === "place" && `${selected.item.category || "business"}${selected.item.zone_name ? ` · ${selected.item.zone_name}` : ""}${selected.item.claimed_by_me ? " · claimed by you" : ""}`}
                {typeof selected.item.distance_km === "number" ? ` · ${selected.item.distance_km} km` : ""}
              </p>
            </div>
            <button type="button" onClick={() => setSelected(null)} className="text-ink-4 hover:text-ink-1 cursor-pointer" aria-label="Close">
              <X size={14} />
            </button>
          </div>
          <div className="mt-3 flex gap-2">
            {selected.kind === "vendor" && (
              <button type="button" onClick={() => navigate("/network")} className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "rgba(251,191,36,0.14)", color: "#FCD34D" }}>
                Open suppliers
              </button>
            )}
            {selected.kind === "market" && (
              <button type="button" onClick={() => navigate("/markets")} className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "rgba(167,139,250,0.16)", color: "#C4B5FD" }}>
                Open markets
              </button>
            )}
            {selected.kind === "place" && !selected.item.claimed_by_me && (
              <button type="button" onClick={() => { toast.info("Open the market from the Markets tab to claim this place"); navigate("/markets"); }}
                className="px-3 py-2 rounded-xl text-xs font-bold" style={{ background: "rgba(96,165,250,0.16)", color: "#93C5FD" }}>
                Claim via Markets
              </button>
            )}
          </div>
        </div>
      )}

      <p className="absolute bottom-3 left-3 z-[400] text-2xs text-white/50 bg-black/50 rounded-full px-2 py-1" style={{ display: selected ? "none" : "block" }}>
        Data © OpenStreetMap contributors (ODbL)
      </p>
    </div>
  );
}
