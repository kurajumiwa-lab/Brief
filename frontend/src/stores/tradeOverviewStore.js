import { create } from "zustand";
import { failureReason, ordersAPI } from "@/lib/api";

/** Describing a failure must never become a second failure. */
function describeFailure(error) {
  try {
    return failureReason(error, "Could not read your trade overview");
  } catch {
    return "Could not read your trade overview";
  }
}
import { useAuthStore } from "@/stores/authStore";

/**
 * ONE TRADE OVERVIEW, ONE REQUEST.
 *
 * The home page has two components that need the same numbers — the compact
 * trade shelf and the business pulse. Both used to call `ordersAPI.records()`
 * themselves, which meant:
 *
 *   · two identical GETs on every home load (three on a retry, because each
 *     shelf retried its own copy),
 *   · two independent failures for the same broken endpoint, so the page showed
 *     "the overview didn't load" twice and looked twice as broken as it was,
 *   · and a retry that healed one card while leaving the other one wrong.
 *
 * This store makes the overview a single shared fact with a single failure.
 * The shape mirrors `homeFeedStore` on purpose: same status vocabulary, same
 * "failures are state, not exceptions" rule, same deadline so a request that
 * never settles becomes an error with a retry rather than a permanent skeleton.
 *
 * It also keeps the last good answer (`data` survives a failed refresh). A
 * dashboard that blanks itself because one poll timed out is worse than one
 * showing a number from ninety seconds ago, labelled as such.
 */

export const OVERVIEW_TIMEOUT_MS = 20 * 1000;

/**
 * Would trying again plausibly work?
 *
 * A 5xx, a timeout, or no answer at all is the server having a bad moment —
 * a cold start, a restart, a database connection reaped between requests.
 * A 4xx is a decision (bad token, wrong role); retrying it just doubles the
 * wait before the same answer.
 */
export function isTransient(error) {
  const status = error?.response?.status;
  if (!status) return true; // no response at all: timeout, DNS, connection reset
  return status >= 500 || status === 408 || status === 429;
}

function withinDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("overview timed out");
      error.isTimeout = true;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

const initial = () => ({
  data: null,
  /** Whether a new request could plausibly fix the last failure. */
  retryable: false,
  status: "idle", // idle | loading | ready | error
  /** Human sentence for a failure, empty when the last read worked. */
  error: "",
  /** Whether the numbers on screen predate the failure. */
  stale: false,
  at: 0,
});

export const useTradeOverviewStore = create((set, get) => ({
  ...initial(),
  /** The in-flight request, so concurrent callers join it instead of duplicating it. */
  inFlight: null,

  reset: () => set({ ...initial(), inFlight: null }),

  /**
   * Read the overview, joining a request already in the air.
   * Returns the data, or null after recording the failure in state.
   */
  load: async ({ force = false } = {}) => {
    const current = get();
    if (current.inFlight && !force) return current.inFlight;
    // Cached numbers belong to the account that read them. A different token
    // (a sign-out, a sign-in as someone else) invalidates the cache outright.
    const token = useAuthStore.getState?.().token ?? null;
    if (!force && current.status === "ready" && current.token === token && Date.now() - current.at < 60_000) {
      return current.data;
    }

    set({ status: current.data ? "refreshing" : "loading", error: "" });

    const request = (async () => {
      try {
        const { data } = await withinDeadline(Promise.resolve().then(() => ordersAPI.records({ limit: 3 })), OVERVIEW_TIMEOUT_MS);
        set({ data, status: "ready", error: "", stale: false, retryable: false, at: Date.now(), token, inFlight: null });
        return data;
      } catch (error) {
        // Immediate and legible. A timed retry here would delay the sentence
        // the user needs; the reconnect listener in HomeHub (and the Retry
        // button) make the second attempt when there is a reason to believe
        // one will work.
        set((state) => ({
          status: "error",
          error: describeFailure(error),
          stale: Boolean(state.data),
          retryable: isTransient(error),
          inFlight: null,
        }));
        return null;
      }
    })();

    set({ inFlight: request });
    return request;
  },

  /** The retry affordance: always a real request, never a cache hit. */
  retry: () => get().load({ force: true }),
}));

export default useTradeOverviewStore;
