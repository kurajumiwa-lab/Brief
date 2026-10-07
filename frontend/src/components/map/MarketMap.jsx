import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { bboxString, clusterColor, clusterRadius, KIND_COLORS, PIN_RADIUS } from "@/lib/mapViewport";

// ─────────────────────────────────────────────────────────────────────────────
// MarketMap — plain Leaflet, canvas-drawn pins, one screenful of data.
//
// What makes this survive a phone:
//
//   * `preferCanvas` — pins are painted onto one <canvas>, not one DOM node
//     each. A few hundred markers cost one element instead of a few hundred,
//     which is the difference between a map that pans and a map that janks.
//   * `updateWhenIdle` on the tile layer — tiles are requested when the pan
//     stops, not on every frame of it. `keepBuffer: 1` keeps one ring of
//     off-screen tiles, not four.
//   * `detectRetina: false` — retina tiles are 4× the bytes for a map that is
//     mostly read on a bus. Off by design.
//   * Clusters are the only DOM markers on the map, and they are capped (a few
//     hundred at most) because they have to show a number.
//
// The tile URL and its attribution come from `GET /api/map/config`, so the ODbL
// credit can never drift from the tiles being served, and switching the public
// OSM tile server for a commercial one is a deploy-time change.
// ─────────────────────────────────────────────────────────────────────────────

const FALLBACK_TILES = {
  url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)',
  max_zoom: 19,
};

function clusterIcon(count, color) {
  const size = clusterRadius(count) * 2;
  return L.divIcon({
    className: "",
    html: `<span style="display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;
      border-radius:9999px;background:${color}26;border:2px solid ${color};color:#fff;
      font:700 11px/1 ui-sans-serif,system-ui;box-shadow:0 2px 10px rgba(0,0,0,.45);
      backdrop-filter:blur(2px)">${count > 999 ? `${Math.round(count / 1000)}k` : count}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

const MarketMap = forwardRef(function MarketMap(
  { config, points = [], clusters = [], selectedId, initialView, onSelect, onCluster, onViewChange },
  ref,
) {
  const hostRef = useRef(null);
  const mapRef = useRef(null);
  const pinLayer = useRef(null);
  const clusterLayer = useRef(null);
  const handlers = useRef({ onSelect, onCluster, onViewChange });
  handlers.current = { onSelect, onCluster, onViewChange };
  // Where the map should open when it mounts. Read through a ref so a pan
  // updates it without remounting the map (and losing the user's position when
  // they flip to the list view and back).
  const startView = useRef(initialView);
  startView.current = initialView;

  // ── mount once ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!hostRef.current || mapRef.current) return undefined;
    const tiles = config?.tiles || FALLBACK_TILES;
    const center = startView.current?.center || config?.default_center || [-1.2867, 36.8172];
    const zoom = startView.current?.zoom ?? config?.default_zoom ?? 12;

    const map = L.map(hostRef.current, {
      center,
      zoom,
      preferCanvas: true,          // paint pins, not DOM
      zoomControl: false,          // we place our own, thumb-reachable
      attributionControl: true,
      inertia: true,
      updateWhenZooming: false,    // no tile churn mid-zoom
      zoomSnap: 1,
      minZoom: tiles.min_zoom ?? 2,
      maxZoom: tiles.max_zoom ?? 19,
      tap: true,                    // one tap = one click, no 300 ms wait
      bounceAtZoomLimits: false,
    });

    L.tileLayer(tiles.url || FALLBACK_TILES.url, {
      attribution: tiles.attribution || FALLBACK_TILES.attribution,
      subdomains: tiles.subdomains || "abc",
      minZoom: tiles.min_zoom ?? 2,
      maxZoom: tiles.max_zoom ?? 19,
      maxNativeZoom: tiles.max_zoom ?? 19,
      updateWhenIdle: true,        // mobile: ask for tiles when the pan stops
      updateWhenZooming: false,
      keepBuffer: 1,               // one off-screen ring, not four
      detectRetina: false,         // 4× bytes for little gain on a phone
      crossOrigin: true,
    }).addTo(map);

    pinLayer.current = L.layerGroup().addTo(map);
    clusterLayer.current = L.layerGroup().addTo(map);
    mapRef.current = map;

    const emit = () => {
      const b = map.getBounds();
      handlers.current.onViewChange?.({
        bbox: bboxString(b),
        zoom: map.getZoom(),
        center: [map.getCenter().lat, map.getCenter().lng],
      });
    };
    map.on("moveend zoomend", emit);
    emit();

    return () => {
      map.off("moveend zoomend", emit);
      map.remove();
      mapRef.current = null;
      pinLayer.current = null;
      clusterLayer.current = null;
    };
  }, [config]);

  // ── pins: canvas circle markers, replaced wholesale each view ─────────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = pinLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    points.forEach((p) => {
      if (typeof p.lat !== "number" || typeof p.lng !== "number") return;
      const isSelected = p.id === selectedId;
      const base = PIN_RADIUS[p.kind] ?? 6;
      const marker = L.circleMarker([p.lat, p.lng], {
        renderer: map.options.renderer || undefined,
        radius: isSelected ? base + 4 : base,
        color: isSelected ? "#FFFFFF" : KIND_COLORS[p.kind] || "#60A5FA",
        weight: isSelected ? 3 : 1.5,
        fillColor: KIND_COLORS[p.kind] || "#60A5FA",
        fillOpacity: isSelected ? 1 : 0.85,
      });
      marker.on("click", () => handlers.current.onSelect?.(p));
      layer.addLayer(marker);
    });
  }, [points, selectedId]);

  // ── clusters: the only DOM markers, because they carry a number ───────────
  useEffect(() => {
    const map = mapRef.current;
    const layer = clusterLayer.current;
    if (!map || !layer) return;
    layer.clearLayers();
    clusters.forEach((c) => {
      if (typeof c.lat !== "number" || typeof c.lng !== "number") return;
      const color = clusterColor(c.count);
      const marker = L.marker([c.lat, c.lng], {
        icon: clusterIcon(c.count, color),
        keyboard: false,
        riseOnHover: true,
      });
      marker.on("click", () => handlers.current.onCluster?.(c));
      marker.bindTooltip(
        `${c.count} ${c.kind === "vendors" ? "vendors" : c.kind === "markets" ? "markets" : "places"}`,
        { direction: "top", offset: [0, -6] },
      );
      layer.addLayer(marker);
    });
  }, [clusters]);

  useImperativeHandle(ref, () => ({
    flyTo(lat, lng, zoom = 16) {
      mapRef.current?.flyTo([lat, lng], zoom, { duration: 0.6 });
    },
    setView(center, zoom) {
      mapRef.current?.setView(center, zoom);
    },
    zoomBy(delta) {
      mapRef.current?.setZoom((mapRef.current?.getZoom() || 12) + delta);
    },
    fit(points_, pad = 0.25) {
      const map = mapRef.current;
      if (!map || !points_?.length) return;
      const bounds = L.latLngBounds(points_.map((p) => [p.lat, p.lng]).filter((c) => c[0] != null));
      if (bounds.isValid()) map.fitBounds(bounds.pad(pad));
    },
    centerOnMe() {
      const map = mapRef.current;
      if (!map) return;
      map.locate({ setView: true, maxZoom: 16, enableHighAccuracy: true, timeout: 8000 });
    },
    getMap: () => mapRef.current,
  }));

  return <div ref={hostRef} className="absolute inset-0" style={{ background: "#0b0f14" }} />;
});

export default MarketMap;
