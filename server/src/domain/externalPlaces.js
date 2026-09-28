// ---------------------------------------------------------------------------
// EXTERNAL PLACES — map listings a seeker can find, never shops we vouch for.
//
// Source: BizData (https://bizdata-web.vercel.app), itself a proxy over
// OpenStreetMap/Overpass. No key, no signup — and no reliability promise:
// upstream 504s are routine, so every answer here carries its provenance
// (source + fetched-at) and a stale cache is served honestly labelled rather
// than failing a seeker who is mid-task.
//
// What this is NOT:
// - not vendors, not shops, not capabilities. External rows live in their
//   own tables and are never merged into registered-shop reads;
// - not verified. Coverage in Kenya is thin (often name + coordinates only).
//   Empty fields stay empty — no address is ever composed, guessed, or
//   borrowed from somewhere else;
// - not priced. The directory carries no prices at all. A price appears only
//   as a receipt-backed CLAIM: a photo of the receipt is mandatory, the
//   claim is always labelled unverified, and bare typed prices are refused.
//
// Reads through this file create economic records never; the snapshot cache
// is technical (source + point-in-time, per the integrity contract), and a
// search only ever runs when the seeker explicitly taps search.
// ---------------------------------------------------------------------------
import { store, newId } from "../store.js";
import * as v from "./supplyValidation.js";
import * as intake from './engine/intake.js';

export const PLACES_SOURCE = "bizdata-web (OpenStreetMap)";
export const PLACES_ATTRIBUTION = "© OpenStreetMap contributors · via BizData";
const UPSTREAM = "https://bizdata-web.vercel.app/api/businesses";
const CACHE_MS = 24 * 3600 * 1000;
const UPSTREAM_TIMEOUT_MS = 12000;

export const PLACE_CATEGORIES = [
  "accountant", "bakery", "bank", "bar", "beauty", "bookstore", "cafe",
  "car_dealer", "car_repair", "cinema", "clothing", "coworking", "dentist",
  "doctor", "electronics", "florist", "furniture", "gallery", "gas_station",
  "guest_house", "gym", "hairdresser", "hospital", "hostel", "hotel",
  "insurance", "lawyer", "museum", "parking", "pet_shop", "pharmacy",
  "real_estate", "restaurant", "school", "supermarket", "theatre", "university",
];

const cacheKey = (location, category, limit) =>
  `${location.trim().toLowerCase()}|${category}|${limit}`;

function shapeBusiness(b) {
  if (!b || typeof b !== "object") return null;
  const name = typeof b.name === "string" ? b.name : "";
  if (name.trim() === "") return null;
  const str = (x) => (typeof x === "string" ? x : "");
  const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
  return {
    name,
    category: str(b.category),
    address: str(b.address),
    phone: str(b.phone),
    website: str(b.website),
    email: str(b.email),
    lat: num(b.lat),
    lon: num(b.lon),
    openingHours: str(b.opening_hours),
    osmId: b.osm_id === undefined || b.osm_id === null ? null : String(b.osm_id),
  };
}

async function fetchUpstream(location, category, limit) {
  const url =
    `${UPSTREAM}?location=${encodeURIComponent(location)}` +
    `&category=${encodeURIComponent(category)}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || !Array.isArray(body.businesses))
    throw new Error(body?.error ? String(body.error) : `directory answered ${res.status}`);
  return {
    businesses: body.businesses.map(shapeBusiness).filter(Boolean),
    total: typeof body.total === "number" ? body.total : null,
    locationResolved: typeof body.location_resolved === "string" ? body.location_resolved : location,
    dataQuality: body.data_quality && typeof body.data_quality === "object" ? body.data_quality : null,
  };
}

function snapshotOf(row, stale) {
  return {
    key: row.key,
    location: row.location,
    category: row.category,
    limit: row.limit,
    source: row.source,
    attribution: PLACES_ATTRIBUTION,
    fetchedAt: row.fetchedAt,
    stale,
    total: row.total,
    locationResolved: row.locationResolved,
    dataQuality: row.dataQuality,
    businesses: row.businesses,
  };
}

export async function searchPlaces(actorId, input = {}) {
  v.actor(actorId);
  v.fields(input, ["location", "category", "limit"], "placeSearch");
  const location = v.text(input.location, 120, "location", 2).trim();
  const category = v.choice(String(input.category ?? "").toLowerCase(), PLACE_CATEGORIES, "category");
  const limitRaw = input.limit === undefined ? 10 : Number(input.limit);
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 20)
    v.fail("limit must be 1–20.", 422, "bad_limit");
  const key = cacheKey(location, category, limitRaw);
  const now = Date.now();
  const hit = store.find("externalPlaceSnapshots", (r) => r.key === key);
  if (hit && now - Date.parse(hit.fetchedAt) < CACHE_MS)
    return snapshotOf(hit, false);
  try {
    const up = await fetchUpstream(location, category, limitRaw);
    const row = {
      key,
      location,
      category,
      limit: limitRaw,
      source: PLACES_SOURCE,
      fetchedAt: new Date().toISOString(),
      total: up.total,
      locationResolved: up.locationResolved,
      dataQuality: up.dataQuality,
      businesses: up.businesses,
    };
    store.transaction(() => {
      const prev = store.find("externalPlaceSnapshots", (r) => r.key === key);
      if (prev) store.update("externalPlaceSnapshots", prev.id, row);
      else store.insert("externalPlaceSnapshots", { id: newId("psnap"), ...row });
    });
    return snapshotOf(row, false);
  } catch (e) {
    if (hit) return snapshotOf(hit, true);
    v.fail(
      `The business directory could not be reached just now (${e.message}). Nothing is shown in its place.`,
      503,
      "directory_unavailable",
    );
  }
}

// ---------------------------------------------------------------------------
// Receipt-backed price claims.
//
// A claim says: this item cost this much here, and here is the receipt photo
// that says so. The photo is MANDATORY — a price without a receipt is refused
// outright. Every claim stays labelled unverified: confirmation (a second,
// independent receipt) is a later phase, and this file does not pretend it
// exists yet.
// ---------------------------------------------------------------------------

const CLAIM_FIELDS = [
  "placeKey",
  "placeName",
  "location",
  "category",
  "item",
  "amountKes",
  "receiptPhoto",
  "idempotencyKey",
];

export function claimPlacePrice(actorId, input = {}) {
  v.actor(actorId);
  v.fields(input, CLAIM_FIELDS, "priceClaim");
  const placeKey = v.text(input.placeKey, 60, "placeKey", 1).trim();
  const placeName = v.text(input.placeName, 200, "placeName", 1).trim();
  const location = v.text(input.location, 120, "location", 1).trim();
  const category = v.text(input.category, 60, "category", 1).trim();
  const item = v.text(input.item, 120, "item", 2).trim();
  const amountKes = v.num(input.amountKes, "amountKes", 1, 1e9);
  if (!Number.isInteger(amountKes))
    v.fail("amountKes must be a whole number of shillings.", 422, "bad_claim");
  if (input.receiptPhoto === undefined || input.receiptPhoto === null || String(input.receiptPhoto).trim() === "")
    v.fail("A receipt photo is required — a price without a receipt is not a claim.", 422, "receipt_required");
  const receiptPhoto = v.text(String(input.receiptPhoto), 300, "receiptPhoto").trim();
  const key =
    input.idempotencyKey === undefined || input.idempotencyKey === null
      ? null
      : v.text(String(input.idempotencyKey), 120, "idempotencyKey");
  if (key) {
    const dupe = store.find(
      "placePriceClaims",
      (c) => c.claimedBy === actorId && c.idempotencyKey === key,
    );
    if (dupe) {
      const same =
        dupe.placeKey === placeKey &&
        dupe.item === item &&
        dupe.amountKes === amountKes &&
        dupe.receiptPhoto === receiptPhoto;
      if (!same)
        v.fail(
          "That reference was already used for a different claim.",
          409,
          "idempotency_key_reused",
        );
      // The key is also recorded at the edge, so every idempotency key this
      // system honours is visible in one place (see ops/intake). Enforcement
      // stays here, where the live claim row is: the edge record is a ledger of
      // keys, not a second source of truth about claims.
      intake.note({ key: `claim:${actorId}:${key}`, source: 'places', handler: 'claim_price', outcome: { claimId: dupe.id }, actorId });
      return { claim: dupe, replayed: true };
    }
  }
  const now = new Date().toISOString();
  const row = {
    id: newId("pclaim"),
    placeKey,
    placeName,
    location,
    category,
    item,
    amountKes,
    receiptPhoto,
    claimedBy: actorId,
    status: "claimed",
    idempotencyKey: key,
    history: [v.event(actorId, "price_claimed", ["item", "amountKes"])],
    createdAt: now,
    updatedAt: now,
  };
  return {
    claim: store.transaction(() => store.insert("placePriceClaims", row)),
    replayed: false,
  };
}

/**
 * Everything cached that carries coordinates, deduplicated, with a real
 * claimed-price count each. The map's honest dataset: no zones, no totals
 * beyond what is counted here, no rows invented for empty areas.
 */
export function listMapPlaces(actorId) {
  v.actor(actorId);
  const seen = new Map();
  for (const snap of store.all("externalPlaceSnapshots")) {
    for (const b of snap.businesses ?? []) {
      if (typeof b.lat !== "number" || typeof b.lon !== "number") continue;
      const key = b.osmId ?? `${b.name}|${b.lat},${b.lon}`;
      if (!seen.has(key)) {
        seen.set(key, {
          key,
          name: b.name,
          category: b.category,
          lat: b.lat,
          lon: b.lon,
          fetchedAt: snap.fetchedAt,
        });
      }
    }
  }
  const out = [...seen.values()];
  for (const p of out) {
    p.claimCount = store.filter("placePriceClaims", (c) => c.placeKey === p.key).length;
  }
  return out;
}

export function listPlacePriceClaims(actorId, placeKey) {
  v.actor(actorId);
  const key = v.text(placeKey, 60, "placeKey", 1).trim();
  return store
    .filter("placePriceClaims", (c) => c.placeKey === placeKey)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
