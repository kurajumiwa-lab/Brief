import { create } from "zustand";
import { SHELVES, publicShelfItems, shelfByKey } from "@/config/homeShelves";
import { useAuthStore } from "@/stores/authStore";
import { failureReason } from "@/lib/api";

/**
 * THE HOME FEED STORE — one small state machine per shelf.
 *
 * Why a store and not one big `useEffect`: the feed is a *composition* of
 * independent modules, so it is loaded like one.
 *
 *   · `loadShelf(key)` loads exactly one shelf. A shelf that throws lands in
 *     `error` and is the only thing that breaks — the rest of the feed renders.
 *   · Concurrent calls collapse (a shelf already loading is not loaded twice).
 *   · A shelf that answered within `STALE_MS` is not fetched again when you
 *     come back to Home — no repeated API calls on every navigation.
 *   · Items pass through `publicShelfItems`, so the vendor's own inventory
 *     never reaches a public shelf even if a server filter changes.
 *
 * Status is `idle → loading → ready | error`. `ready` with zero items is a
 * legitimate, meaningful state: the shelf hides itself (there is nothing to
 * pad it with, and we never would).
 */

export const STALE_MS = 5 * 60 * 1000;

/**
 * How long a shelf may stay on the skeleton before it is a failure.
 *
 * A request that never settles is worse than one that fails: the shelf sits on
 * its loading skeleton forever, the user has no retry button, and the feed
 * looks half-loaded with no explanation. Axios gives up at 30s on its own; this
 * deadline is shorter so the card lands in `error` — with its retry — while the
 * user is still looking at it.
 */
export const SHELF_TIMEOUT_MS = 20 * 1000;

/**
 * Would trying again plausibly work?
 *
 * Used for the retry that happens when the connection comes back: a shelf that
 * failed because the network was down should heal itself the moment it isn't.
 * A 4xx is a decision, not a hiccup, and is not re-requested.
 */
function describeFailure(failure) {
  try {
    if (failure?.isTimeout) {
      return `No answer within ${Math.round(SHELF_TIMEOUT_MS / 1000)} seconds. The server may be starting up.`;
    }
    return failureReason(failure, "The request failed.");
  } catch {
    return "The request failed.";
  }
}

export function worthRetrying(error) {
  const status = error?.response?.status;
  if (!status) return true;
  return status >= 500 || status === 408 || status === 429;
}

const initial = () => ({ items: [], status: "idle", error: "", reason: "", at: 0 });

function withinDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      // Marked so the caller can tell "the server never answered" apart from
      // "the server answered with an error" — they need different sentences.
      const error = new Error("shelf timed out");
      error.isTimeout = true;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

export const useHomeFeedStore = create((set, get) => ({
  shelves: {},

  reset: () => set({ shelves: {} }),

  /** Load one shelf. Never throws — failures are state, not exceptions. */
  loadShelf: async (key, { force = false } = {}) => {
    const shelf = shelfByKey(key);
    if (!shelf) return;
    const current = get().shelves[key] || initial();

    if (!force) {
      if (current.status === "loading") return;
      if (current.status === "ready" && Date.now() - current.at < STALE_MS) return;
    }

    set((state) => ({
      shelves: { ...state.shelves, [key]: { ...current, status: "loading", error: "", reason: "", retryable: false } },
    }));

    try {
      const rows = await withinDeadline(Promise.resolve().then(() => shelf.load()), SHELF_TIMEOUT_MS);
      const vendor = useAuthStore.getState?.().vendor ?? null;
      const items = publicShelfItems(rows, vendor, shelf.limit);
      set((state) => ({
        shelves: { ...state.shelves, [key]: { items, status: "ready", error: "", reason: "", retryable: false, at: Date.now() } },
      }));
    } catch (failure) {
      // The card keeps its short title ("Fresh on the network didn't load") and
      // gains the actual reason underneath, so a screenshot of the failure is
      // enough to diagnose it instead of needing the server logs.
      //
      // Describing a failure must never become a second failure: if the reason
      // helper is missing or itself throws, the shelf is still marked broken
      // with a plain sentence. (This is how a broken error path hides the very
      // error it was meant to explain.)
      set((state) => ({
        shelves: {
          ...state.shelves,
          [key]: {
            items: [],
            status: "error",
            error: `${shelf.title} didn't load`,
            reason: describeFailure(failure),
            retryable: worthRetrying(failure),
            at: 0,
          },
        },
      }));
    }
  },

  /**
   * Kick every shelf off at once — each resolves on its own clock, so the
   * fastest module paints first and the slowest never blocks the others.
   */
  loadFeed: () => {
    SHELVES.forEach((shelf) => {
      get().loadShelf(shelf.key).catch(() => {});
    });
  },

  /** Refresh one shelf (the retry affordance in a failed carousel). */
  retryShelf: (key) => get().loadShelf(key, { force: true }),

  /**
   * The network just came back. Re-request exactly the shelves that failed for
   * a reason a new request can fix — not the ones the server refused — so a
   * driver that reconnects heals the feed without the reader having to hunt for
   * the retry buttons. Deliberately event-driven: a timer-based retry delays
   * the error message and makes the feed's timing impossible to reason about.
   */
  retryFailedShelves: () => {
    const shelves = get().shelves;
    return Promise.all(
      Object.entries(shelves)
        .filter(([, state]) => state.status === "error" && state.retryable !== false)
        .map(([key]) => get().retryShelf(key))
    );
  },

  /** Refresh the whole feed — used by the pull-to-refresh affordance. */
  refreshFeed: () => {
    SHELVES.forEach((shelf) => {
      get().loadShelf(shelf.key, { force: true }).catch(() => {});
    });
  },

  /** Shelf state for the feed, with a stable shape while it is still idle. */
  shelfState: (key) => get().shelves[key] || initial(),
}));

/** True once every shelf has settled — used by the quiet-network fallback. */
export const feedSettled = (shelves) =>
  SHELVES.every((shelf) => ["ready", "error"].includes((shelves[shelf.key] || {}).status));

/** True when the network answered, and answered with nothing to show. */
export const feedIsQuiet = (shelves) =>
  feedSettled(shelves) &&
  SHELVES.every((shelf) => {
    const state = shelves[shelf.key] || {};
    return state.status === "error" || (state.items || []).length === 0;
  });
