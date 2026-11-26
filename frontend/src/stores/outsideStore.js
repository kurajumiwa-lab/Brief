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

/**
 * THE REQUEST PARAMETERS FOR "AROUND YOU".
 *
 * A point, and the width the person chose. There is no point — no GPS, no
 * typed area — then there is no scope, and the feed is the whole network.
 * That is the honest answer: it is better to show everything than to show
 * everything as if it were nearby.
 */
export function locationScope(location) {
  if (!location) return null;
  if (location.lat == null || location.lng == null) return null;
  const radius = Number(location.radius_km);
  return {
    lat: location.lat,
    lng: location.lng,
    radius_km: Number.isFinite(radius) && radius > 0 ? radius : 15,
  };
}

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
    // The scope in force. An explicit one — a region the person chose — wins.
    // Otherwise it is their own location and the radius they chose, so
    // "around you" really is around them and the radius control really
    // changes what comes back.
    const effectiveScope = scope ?? locationScope(get().location);
    set({ status: "loading", error: "", failure: null, kinds, lastQuery: query, scope: effectiveScope });
    try {
      const data = await get()._fetch({ kinds, q: query, limit: 20, ...(effectiveScope || {}) });
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

  /**
   * Refresh the scope in one action: ask the device where the person is now,
   * then ask the feed again around that point.
   *
   * The permission is only ever requested from a press — a prompt nobody
   * asked for is a prompt people refuse — and a refusal is reported, never
   * papered over with a substitute location. The feed is NOT reloaded when
   * the device says no: the previous scope is still true, and reloading it
   * would suggest the screen had changed when it had not.
   */
  refreshNearby: async () => {
    const result = await get().requestGps();
    if (!result.ok) return result;
    await get().loadFeed({
      kinds: get().kinds,
      query: get().lastQuery,
      scope: get().scope,
      force: true,
    });
    return result;
  },

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

  /**
   * Mark ONE notification read in the local record.
   *
   * Called after the server accepts `POST /notifications/{id}/read`. It is
   * deliberately per-record: there is no "mark all" here and there must not be,
   * because the Inbox shows a single list and opening one row may not clear the
   * others. Rebuilt immutably so every subscriber (tab bar, header bell, Home's
   * badge) re-renders from the same new object rather than three separate
   * counts.
   */
  markNotificationReadLocal: (notificationId) => {
    const activity = get().activity;
    if (!activity || !notificationId) return;
    set({
      activity: {
        ...activity,
        groups: (activity.groups || []).map((group) => ({
          ...group,
          items: (group.items || []).map((item) =>
            item.id === notificationId ? { ...item, is_read: true } : item,
          ),
        })),
        counts: activity.counts?.unread_notifications
          ? {
              ...activity.counts,
              unread_notifications: Math.max(0, activity.counts.unread_notifications - 1),
            }
          : activity.counts,
      },
    });
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

/**
 * The words a location chip shows, whatever produced the point.
 *
 * The rule the brief sets is simple: never print a place the app does not
 * actually know. There is no town or county in here that was not typed by
 * the person or returned by the server, and a device that cannot share a
 * location says exactly that rather than guessing a town.
 *
 * A GPS fix with no reverse-geocoded name is "Your current location" — it is
 * true, and it claims no town. A point that is not there at all is
 * "Location unavailable", which is a fact about the device rather than a
 * failure to answer.
 */
export function locationLabel(location) {
  if (!location) return "Location unavailable";
  if (location.label) return location.label;
  const hasPoint = location.lat != null && location.lng != null;
  switch (location.source) {
    case "gps":
    case "request":
      return hasPoint ? "Your current location" : "Location unavailable";
    case "manual":
      return hasPoint ? "Your chosen area" : "Location unavailable";
    case "vendor_profile":
      return "Your business address";
    case "market_zone":
      return "Your nearest market";
    default:
      return "Location unavailable";
  }
}

/** True when the app has a point it can honestly stand behind. */
export function hasUsableLocation(location) {
  if (!location) return false;
  if (location.source === "unset") return false;
  return location.lat != null && location.lng != null;
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
