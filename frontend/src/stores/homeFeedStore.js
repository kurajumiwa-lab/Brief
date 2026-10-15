import { create } from "zustand";
import { SHELVES, publicShelfItems, shelfByKey } from "@/config/homeShelves";
import { useAuthStore } from "@/stores/authStore";

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

const initial = () => ({ items: [], status: "idle", error: "", at: 0 });

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
      shelves: { ...state.shelves, [key]: { ...current, status: "loading", error: "" } },
    }));

    try {
      const rows = await shelf.load();
      const vendor = useAuthStore.getState?.().vendor ?? null;
      const items = publicShelfItems(rows, vendor, shelf.limit);
      set((state) => ({
        shelves: { ...state.shelves, [key]: { items, status: "ready", error: "", at: Date.now() } },
      }));
    } catch {
      set((state) => ({
        shelves: { ...state.shelves, [key]: { items: [], status: "error", error: `${shelf.title} didn't load`, at: 0 } },
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
