import { create } from "zustand";
import { outsideAPI } from "@/lib/api";
import { describeFailure } from "@/lib/failure";

/**
 * THE OUTSIDE STORE — where you are looking, what is around you, and what is
 * waiting for you.
 *
 * Three pieces of state, deliberately kept together because they share one
 * question ("where am I?"):
 *
 *   location   the resolved point plus WHY it is that point. `source` is the
 *              honest part: `gps`, `manual`, `vendor_profile`, `market_zone`
 *              or `unset`. A denied GPS permission is `manual`-or-`unset`,
 *              never an error state.
 *   feed       one cursor-paged list. `loadMore` appends and dedupes by
 *              `kind:id`, so a re-ranked page cannot show a card twice.
 *   activity   grouped notifications and the two real waiting counts.
 *
 * Nothing here throws. Failures land in `status` so a screen can render an
 * error state with a retry instead of crashing the shell.
 *
 * A failure is never a single sentence. `failure` holds the classified
 * problem — kind, headline, description, whether a retry could plausibly work
 * — so the screen can say *why* the list is empty instead of the one generic
 * line this store used to print for every possible cause: a dead network, a
 * timed-out request, a rejected session and a broken deployment all read as
 * "We couldn't load what's around you".
 */

/** Discovery radii the product names, so the UI never hardcodes a number. */
export const RADII = [
  { value: 3, label: "Nearby", hint: "0–3 km · immediate neighbourhood" },
  { value: 15, label: "Around town", hint: "3–15 km · services, events, communities" },
  { value: 50, label: "Further out", hint: "trips, specialists, wider communities" },
];

export const LAYERS = [
  { value: "neighbourhood", label: "Neighbourhood" },
  { value: "town", label: "Town or city" },
  { value: "region", label: "Region" },
  { value: "country", label: "Country" },
  { value: "global", label: "Anywhere" },
];

const keyOf = (item) => `${item.kind}:${item.id}`;

export const useOutsideStore = create((set, get) => ({
  // ── location ─────────────────────────────────────────────────────────────
  location: null,
  // idle | loading | ready | saving | error | denied | unavailable
  locationStatus: "idle",

  loadLocation: async () => {
    if (get().locationStatus === "loading") return;
    set({ locationStatus: "loading" });
    try {
      const { data } = await outsideAPI.location();
      set({ location: data, locationStatus: "ready" });
      return data;
    } catch {
      set({ locationStatus: "error" });
      return null;
    }
  },

  /**
   * Ask the device where the person is — once, on request.
   *
   * Three honest outcomes, and none of them is an error page:
   *
   *   ok           the point was saved and the feed can use it
   *   denied       the person said no — the previous area (or none) still works
   *   unavailable  this browser cannot share a location at all
   *
   * It lives in the store rather than in a component because "around you" is
   * one question for the whole app: the Regions screen, the location bar and
   * the map must never disagree about whether there is a point.
   */
  requestGps: async () => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      set({ locationStatus: "unavailable" });
      return { ok: false, reason: "unavailable" };
    }
    set({ locationStatus: "loading" });
    const outcome = await new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ ok: true, coords: pos.coords }),
        (err) => resolve({
          ok: false,
          // 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT.
          reason: err?.code === 1 ? "denied" : "unavailable",
        }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
      );
    });
    if (!outcome.ok) {
      set({ locationStatus: outcome.reason });
      return { ok: false, reason: outcome.reason };
    }
    const saved = await get().setLocation({
      geo_lat: outcome.coords.latitude,
      geo_lng: outcome.coords.longitude,
      source: "gps",
      label: null,
    });
    if (!saved) {
      set({ locationStatus: "error" });
      return { ok: false, reason: "save_failed" };
    }
    return { ok: true, location: saved };
  },

  /**
   * Save where you are looking. Optimistic: the chip updates immediately and
   * the server answer replaces it, so a slow network never makes the control
   * feel broken. `share_location` is never implied by setting a point.
   */
  setLocation: async (patch) => {
    const previous = get().location;
    set({ location: { ...(previous || {}), ...patch }, locationStatus: "saving" });
    try {
      const { data } = await outsideAPI.setLocation({
        label: patch.label ?? previous?.label ?? null,
        geo_lat: patch.geo_lat ?? previous?.geo_lat ?? null,
        geo_lng: patch.geo_lng ?? previous?.geo_lng ?? null,
        source: patch.source ?? "manual",
        radius_km: patch.radius_km ?? previous?.radius_km ?? 15,
        layer: patch.layer ?? previous?.layer ?? "town",
        interests: patch.interests ?? previous?.interests ?? [],
        share_location: patch.share_location ?? previous?.share_location ?? false,
      });
      set({ location: data, locationStatus: "ready" });
      return data;
    } catch {
      set({ location: previous, locationStatus: "error" });
      return null;
    }
  },

  // ── feed ─────────────────────────────────────────────────────────────────
  items: [],
  cursor: null,
  status: "idle",          // idle | loading | loading_more | ready | error
  error: "",               // one headline a person can read
  failure: null,           // the classified failure behind `error`
  kinds: null,
  lastQuery: null,
  lastLoadedAt: null,
  scope: null,              // the extra request parameters (lat/lng/radius) in force

  _fetch: async (params) => outsideAPI.search(params).then((r) => r.data),

  /**
   * First page. Replaces the list.
   *
   * `scope` carries the extra request parameters — the point the feed is
   * centred on and how wide it looks. It is remembered so that "load more"
   * and "try again" ask for exactly the same thing the first page asked for,
   * instead of quietly falling back to the person's saved location.
   */
  loadFeed: async ({ kinds = null, query = null, force = false, scope = null } = {}) => {
    if (!force && get().status === "loading") return null;
    set({ status: "loading", error: "", failure: null, kinds, lastQuery: query, scope });
    try {
      const data = await get()._fetch({ kinds, q: query, limit: 20, ...(scope || {}) });
      set({
        items: data.items || [],
        cursor: data.next_cursor || null,
        status: "ready",
        error: "",
        failure: null,
        center: data.center || null,
        lastLoadedAt: Date.now(),
      });
      return data;
    } catch (err) {
      // The one line this store used to print for every cause — offline,
      // timed out, signed out, broken server — is now the *headline* of a
      // classified failure, and the screen can say what happened and whether
      // trying again could possibly help.
      const failure = describeFailure(err, { subject: "what's around you" });
      set({ status: "error", failure, error: failure.title });
      return null;
    }
  },

  /** Next page. Appends, and drops anything already on screen. */
  loadMore: async () => {
    const { cursor, status, kinds, lastQuery, scope } = get();
    if (!cursor || status === "loading" || status === "loading_more") return;
    set({ status: "loading_more" });
    try {
      const data = await get()._fetch({ kinds, q: lastQuery, limit: 20, cursor, ...(scope || {}) });
      const seen = new Set(get().items.map(keyOf));
      const fresh = (data.items || []).filter((item) => !seen.has(keyOf(item)));
      set((state) => ({
        items: [...state.items, ...fresh],
        cursor: data.next_cursor || null,
        status: "ready",
      }));
    } catch {
      // A failed *next page* is not a failed screen: the rows already on it
      // are still true. Keep them and stop paging.
      set({ status: "ready", cursor: null });
    }
  },

  /** Try the same request again. Used by the retry control on the error state. */
  retryFeed: () =>
    get().loadFeed({ kinds: get().kinds, query: get().lastQuery, scope: get().scope, force: true }),

  refreshFeed: () =>
    get().loadFeed({ kinds: get().kinds, query: get().lastQuery, scope: get().scope, force: true }),

  /** Optimistic reaction: the heart fills now, the server confirms after. */
  toggleReaction: async (item, reaction) => {
    const id = keyOf(item);
    const before = get().items;
    const active = Boolean(item.reactions?.[reaction]);

    const patched = before.map((row) =>
      keyOf(row) === id
        ? { ...row, reactions: { ...row.reactions, [reaction]: !active } }
        : row,
    );
    set({ items: patched });

    const body = { content_kind: item.kind, content_id: item.id, reaction };
    try {
      if (active) await outsideAPI.unreact(body);
      else await outsideAPI.react(body);
      return true;
    } catch {
      set({ items: before });
      return false;
    }
  },

  // ── activity ─────────────────────────────────────────────────────────────
  activity: null,
  activityStatus: "idle",

  loadActivity: async () => {
    set({ activityStatus: "loading" });
    try {
      const { data } = await outsideAPI.activity();
      set({ activity: data, activityStatus: "ready" });
      return data;
    } catch {
      set({ activityStatus: "error" });
      return null;
    }
  },

  /** Everything unread across every group — the tab badge. */
  activityCount: () => {
    const activity = get().activity;
    if (!activity) return 0;
    const unread = activity.groups.reduce(
      (total, group) => total + group.items.filter((i) => !i.is_read).length, 0);
    return unread + (activity.counts?.rooms_active_today || 0);
  },

  reset: () => set({ items: [], cursor: null, status: "idle", activity: null, failure: null, error: "" }),
}));

/** The words a location chip shows, whatever produced the point. */
export function locationLabel(location) {
  if (!location) return "Setting your area…";
  if (location.label) return location.label;
  if (location.source === "unset") return "Choose your area";
  if (location.lat != null && location.lng != null) {
    return `${location.lat.toFixed(3)}, ${location.lng.toFixed(3)}`;
  }
  return "Choose your area";
}

/** A sentence that explains why the app thinks you are here. */
export function locationExplain(location) {
  switch (location?.source) {
    case "gps": return "Using your device location.";
    case "manual": return "Using the area you chose.";
    case "vendor_profile": return "Using your business address. Change it any time.";
    case "market_zone": return "Using your nearest market as a starting point.";
    case "request": return "Using the point you picked.";
    default: return "No location yet — pick a neighbourhood to see what's nearby.";
  }
}
