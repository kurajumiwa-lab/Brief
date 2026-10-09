// ─────────────────────────────────────────────────────────────────────────────
// MAP VIEWPORT — the helpers the mobile map is built on. Pure functions: no
// Leaflet, no React, no network. Kept here so they can be tested in jsdom.
//
// The rule they exist to enforce: the map never holds the whole directory. It
// holds the screen, and the screen is described by a bbox and a zoom level.
// ─────────────────────────────────────────────────────────────────────────────

/** Counters on a phone are narrow, but a four-digit count is still readable:
    `7640 → "7.6K"`, `1240 → "1,240"`, `128000 → "128K"`. */
export function formatCount(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "0";
  const v = Number(n);
  if (v < 2000) return new Intl.NumberFormat("en-KE").format(v);
  if (v < 100_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (v < 1_000_000) return `${Math.round(v / 1000)}K`;
  return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "shop:electronics" → "electronics"; "amenity:pharmacy" → "pharmacy". */
export function categoryLabel(category) {
  if (!category) return "business";
  const [, value] = String(category).split(":");
  return (value || category).replace(/_/g, " ");
}

/** Leaflet bounds → `minLng,minLat,maxLng,maxLat`, padded so pins just off the
    edge are already on the phone when the user pans. */
export function bboxString(bounds, padRatio = 0.15) {
  if (!bounds) return "";
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  const padLat = Math.max((ne.lat - sw.lat) * padRatio, 0);
  const padLng = Math.max((ne.lng - sw.lng) * padRatio, 0);
  const clampLat = (v) => Math.max(-90, Math.min(90, v));
  const clampLng = (v) => Math.max(-180, Math.min(180, v));
  return [
    clampLng(sw.lng - padLng),
    clampLat(sw.lat - padLat),
    clampLng(ne.lng + padLng),
    clampLat(ne.lat + padLat),
  ]
    .map((v) => v.toFixed(4))
    .join(",");
}

/** The four progressive-disclosure tiers. Below `shop`, the map shows
    aggregates; at `shop` it shows businesses. */
export function zoomTier(zoom) {
  if (zoom <= 7) return "region";
  if (zoom <= 11) return "city";
  if (zoom <= 14) return "market";
  return "shop";
}

/** Cluster circle radius in pixels — logarithmic so 12,000 pins is not a
    screen-filling blob and 2 pins is still tappable. */
export function clusterRadius(count) {
  const c = Math.max(1, Number(count) || 1);
  return Math.round(14 + Math.min(26, 9 * Math.log10(c + 1)));
}

/** Cluster colour by size: cold → hot. Five bands, matching the pins. */
export function clusterColor(count) {
  const c = Number(count) || 0;
  if (c >= 1000) return "#F59E0B";   // amber — a whole city
  if (c >= 200) return "#FB923C";
  if (c >= 50) return "#A78BFA";     // violet
  return "#60A5FA";                  // blue
}

export const KIND_COLORS = {
  markets: "#A78BFA",
  vendors: "#FBBF24",
  places: "#60A5FA",
};

// ── Tiers (v2.8): a pin on the map is not automatically in the marketplace ────
// network  — vendors, claimed places, markets with registered suppliers.
//            Drawn full colour, ranked first. This is the product.
// external — unclaimed public-data rows. Hidden by default; when shown, muted.
// stale    — the source stopped confirming the row: off the commercial map.
export const NETWORK_COLOR = "#34D399";   // emerald — the verified network
export const MUTED_COLOR = "#9CA3AF";     // grey — everything else

/** TRUE when a pin is on the map but not in the marketplace. */
export function isExternal(item) {
  return item?.kind === "places" && item.network === false;
}

/** Canvas-circle style for one pin. Network pins keep their layer colour;
    external pins drop to grey, thinner and translucent — visible background,
    unmistakably not a member. */
export function pointStyle(item, selected = false) {
  const kind = item?.kind || "places";
  const base = PIN_RADIUS[kind] ?? 6;
  const external = isExternal(item);
  const color = external ? MUTED_COLOR : KIND_COLORS[kind] || "#60A5FA";
  return {
    radius: selected ? base + 4 : external ? base - 1 : base,
    color: selected ? "#FFFFFF" : color,
    weight: selected ? 3 : external ? 1 : 1.5,
    fillColor: color,
    fillOpacity: selected ? 1 : external ? 0.3 : 0.85,
    opacity: selected ? 1 : external ? 0.5 : 1,
  };
}

/** Cluster bubble colour. A cluster with even one network row is a network
    cell and reads as one; a purely external cluster reads muted. Vendor and
    market clusters are network rows by definition and keep their colours. */
export function clusterStyle(cluster) {
  if (cluster.kind === "places") {
    if (cluster.network === false) return MUTED_COLOR;
    if (cluster.network === true) return NETWORK_COLOR;
  }
  return clusterColor(cluster.count);
}

/** List order: the marketplace first, the directory after. Vendors and
    working markets lead; claimed places and network-catalog markets that are
    not worked yet sit in the middle; external places last — distance only
    breaks ties inside a tier. */
export function tierRank(item) {
  if (item.kind === "vendors") return 0;
  if (item.kind === "markets") return item.networked === false ? 1 : 0;
  if (item.kind === "places") return item.network === false ? 2 : 1;
  return 3;
}

export function sortNetworkFirst(items) {
  return [...(items || [])].sort((a, b) =>
    (tierRank(a) - tierRank(b))
    || ((a.distance_km ?? 1e9) - (b.distance_km ?? 1e9)));
}

/** Short tag for a list row: what the network relationship is. */
export function tierTag(item) {
  if (item.kind === "vendors") return null;            // vendors are the network
  if (item.kind === "markets") {
    if (item.networked === false) return "no suppliers yet";
    return null;
  }
  if (item.kind === "places") {
    if (item.network === false) return "external";
    return "network";
  }
  return null;
}

/** "This area holds 1,240 places" — the honest sentence under the chips.
    Network rows are named first; the external directory is the trailing
    clause, and says it is hidden when the map is not showing it. Accepts the
    v2.7 flat shape too, so old callers keep their sentence. */
export function areaSummary(counts = {}, kind = "all", { externalHidden = false } = {}) {
  const parts = [];
  const wantMarkets = kind === "all" || kind === "markets";
  const wantVendors = kind === "all" || kind === "vendors";
  const wantPlaces = kind === "all" || kind === "places";
  const tiered = counts.network != null;
  const networkPlaces = tiered ? counts.network : counts.places;
  const placeWord = tiered ? "network places" : "places";
  if (wantMarkets && counts.markets) parts.push(`${formatCount(counts.markets)} markets`);
  if (wantVendors && counts.vendors) parts.push(`${formatCount(counts.vendors)} vendors`);
  if (wantPlaces && networkPlaces) parts.push(`${formatCount(networkPlaces)} ${placeWord}`);
  if (!parts.length && !counts.external) return "Nothing mapped in this area yet";
  let sentence = parts.length ? `${parts.join(" · ")} here` : "Only external places here";
  if (wantPlaces && counts.external) {
    sentence += ` · ${formatCount(counts.external)} external ${externalHidden ? "hidden" : "muted"}`;
  }
  return sentence;
}

/** Tap radius in px for a pin (canvas circle markers have no DOM padding). */
export const PIN_RADIUS = { markets: 9, vendors: 7, places: 6 };

// ── Offline: last-known area ─────────────────────────────────────────────────
// Application data only. We deliberately never cache map tiles: bulk-downloading
// the public OpenStreetMap tile servers is against their tile usage policy, so
// an offline map would have to come from a licensed provider. What we can keep
// honestly is the last screenful of *our* data.
const CACHE_KEY = "brief.map.lastViews";
const CACHE_MAX = 6;

export function rememberView(payload) {
  try {
    if (!payload || typeof localStorage === "undefined") return;
    const all = readViews();
    const key = `${payload.zoom}|${payload.bbox ? [payload.bbox.west, payload.bbox.south, payload.bbox.east, payload.bbox.north].join(",") : "network"}`;
    all.unshift({ key, at: Date.now(), payload });
    const deduped = all.filter((v, i, arr) => arr.findIndex((x) => x.key === v.key) === i).slice(0, CACHE_MAX);
    localStorage.setItem(CACHE_KEY, JSON.stringify(deduped));
  } catch {
    /* private mode, quota, disabled storage — a cache that cannot write is fine */
  }
}

export function readViews() {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** The most recent screenful we successfully loaded, for when the network is
    gone. Returns null when there is nothing — we never invent pins. */
export function lastKnownView() {
  const [first] = readViews();
  return first?.payload || null;
}

export function clearViews() {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to clear */
  }
}
