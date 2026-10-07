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

/** Tap radius in px for a pin (canvas circle markers have no DOM padding). */
export const PIN_RADIUS = { markets: 9, vendors: 7, places: 6 };

/** "This area holds 1,240 places" — the honest sentence under the chips. */
export function areaSummary(counts = {}, kind = "all") {
  const parts = [];
  if ((kind === "all" || kind === "markets") && counts.markets) parts.push(`${formatCount(counts.markets)} markets`);
  if ((kind === "all" || kind === "vendors") && counts.vendors) parts.push(`${formatCount(counts.vendors)} vendors`);
  if ((kind === "all" || kind === "places") && counts.places) parts.push(`${formatCount(counts.places)} places`);
  if (!parts.length) return "Nothing mapped in this area yet";
  return `${parts.join(" · ")} here`;
}

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
