import { create } from "zustand";
import { failureReason, socialAPI } from "@/lib/api";

/**
 * THE COMMUNITY, AS ONE CLIENT-SIDE FACT.
 *
 * Caesar's backend is already the source of truth: posts are ranked by the
 * server from real reactions, a verdict is computed per request, a report opens
 * a case with a number, and a block is the reader's own reversible choice. This
 * store exists for exactly three reasons, and none of them is "hold the data":
 *
 *   1. **One request per screen.** The feed, the circles rail and the identity
 *      strip all read the same load. Two components mounting must not mean two
 *      trips over a phone connection.
 *   2. **A failure that says what happened.** Same contract as the home shelves
 *      (`homeFeedStore`): `reason` is a sentence, `retryable` says whether
 *      asking again could possibly help, and a failed *refresh* keeps the posts
 *      that were already read rather than blanking the screen.
 *   3. **Optimistic reactions that cannot lie.** A tap paints immediately, then
 *      the server's own counts replace the guess. If the server refuses, the
 *      paint is undone — a pressed button that did not reach the database is
 *      worse than a button that never pressed.
 *
 * Deliberately absent: any notion of "my vendor account". Participation is an
 * account of its own (`social_accounts`), which may or may not have a business
 * behind it. The UI reads `linked_to_vendor` only to explain, never to allow.
 */

const FEED_TIMEOUT_MS = 20_000;

/** A deadline, so a request that never settles still becomes a sentence. */
function withinDeadline(promise, ms) {
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("timeout");
      error.isTimeout = true;
      reject(error);
    }, ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

/** Describing a failure must never become a second failure. */
function describeFailure(error) {
  try {
    if (error?.isTimeout) {
      return `No answer within ${Math.round(FEED_TIMEOUT_MS / 1000)} seconds. The server may be starting up.`;
    }
    return failureReason(error, "The community didn't load.");
  } catch {
    return "The community didn't load.";
  }
}

function worthRetrying(error) {
  const status = error?.response?.status;
  if (!status) return true; // no answer at all: a connection problem, not a decision
  if (status >= 500 || status === 408 || status === 429) return true;
  return false; // 4xx is the server giving an answer; asking again repeats it
}

export const useCommunityStore = create((set, get) => ({
  identity: null,
  identityError: "",

  circles: [],
  feed: [],

  status: "idle", // idle | loading | ready | error
  error: "",
  reason: "",
  retryable: true,
  stale: false,
  at: 0,
  inFlight: null,

  /** postId → case number, so a reported post keeps saying it was reported. */
  cases: {},

  reset: () =>
    set({
      identity: null,
      identityError: "",
      circles: [],
      feed: [],
      status: "idle",
      error: "",
      reason: "",
      retryable: true,
      stale: false,
      at: 0,
      inFlight: null,
      cases: {},
    }),

  /**
   * Load the surface. Never throws — a failure is state.
   *
   * `force` means "a person asked", and always makes a real request. Without it
   * a ready feed is trusted for a minute and a second caller joins the first
   * request instead of starting another.
   */
  load: async ({ force = false } = {}) => {
    const current = get();
    if (current.inFlight) return current.inFlight;
    if (!force && current.status === "ready" && Date.now() - current.at < 60_000) return current.feed;

    const request = (async () => {
      set({ status: "loading", error: "", reason: "", retryable: true });
      try {
        // The three reads are independent; one failing must not hide the others.
        const [feed, circles, me] = await Promise.allSettled([
          withinDeadline(socialAPI.feed({ limit: 40 }), FEED_TIMEOUT_MS),
          withinDeadline(socialAPI.circles(), FEED_TIMEOUT_MS),
          withinDeadline(socialAPI.me(), FEED_TIMEOUT_MS),
        ]);

        if (me.status === "fulfilled") set({ identity: me.value.data, identityError: "" });
        else set({ identityError: describeFailure(me.reason) });

        if (circles.status === "fulfilled") set({ circles: circles.value.data || [] });

        if (feed.status === "rejected") throw feed.reason;

        set({
          feed: feed.value.data || [],
          status: "ready",
          error: "",
          reason: "",
          retryable: true,
          stale: false,
          at: Date.now(),
          inFlight: null,
        });
        return feed.value.data || [];
      } catch (failure) {
        const had = get().feed.length > 0;
        set({
          // Keep what was already read. A feed that blinks to empty on a bad
          // minute reads as "your community is gone", which is never true.
          status: "error",
          error: "The community didn't load",
          reason: describeFailure(failure),
          retryable: worthRetrying(failure),
          stale: had,
          inFlight: null,
        });
        return get().feed;
      }
    })();

    set({ inFlight: request });
    return request;
  },

  /** A person asked for it: always a real request. */
  retry: () => get().load({ force: true }),

  /**
   * Support or dissent, painted before the round trip.
   *
   * The optimistic step only moves *this* reader's own reaction and the counts
   * it implies; every other number stays the server's. If the write fails the
   * previous post is put back verbatim, so the screen stops claiming something
   * that did not happen.
   */
  react: async (postId, value) => {
    const before = get().feed;
    const target = before.find((entry) => entry.post.id === postId);
    if (!target) return;

    const previous = target.my_reaction;
    const next = previous === value ? null : value;

    set({
      feed: before.map((entry) => {
        if (entry.post.id !== postId) return entry;
        let { up, down } = entry.verdict;
        if (previous === "up") up -= 1;
        if (previous === "down") down -= 1;
        if (next === "up") up += 1;
        if (next === "down") down += 1;
        return { ...entry, my_reaction: next, verdict: { ...entry.verdict, up, down } };
      }),
    });

    try {
      const state = next
        ? (await socialAPI.react(postId, next)).data
        : (await socialAPI.withdrawReaction(postId)).data;
      set({
        feed: get().feed.map((entry) =>
          entry.post.id === postId
            ? {
                ...entry,
                my_reaction: state.my_reaction,
                verdict: {
                  ...entry.verdict,
                  up: state.up,
                  down: state.down,
                  participation: state.participation,
                  contested: state.contested,
                },
              }
            : entry
        ),
      });
      return state;
    } catch (failure) {
      set({ feed: before });
      throw failure;
    }
  },

  /** Put a new post on top. The server's row is what stays. */
  publish: async ({ body, circleId = null, lang = "en" }) => {
    const response = await socialAPI.post({ body, circle_id: circleId, lang, data_kb: 1 });
    const created = response.data;
    await get().retry();
    return created;
  },

  follow: async (circleId) => {
    await socialAPI.followCircle(circleId);
    set({
      circles: get().circles.map((circle) =>
        circle.id === circleId ? { ...circle, following: true } : circle
      ),
    });
  },

  unfollow: async (circleId) => {
    await socialAPI.unfollowCircle(circleId);
    set({
      circles: get().circles.map((circle) =>
        circle.id === circleId ? { ...circle, following: false } : circle
      ),
    });
  },

  /**
   * File a case. The post stays visible, because a report is a claim awaiting a
   * moderator, not a delete button wearing a disguise.
   */
  report: async (postId, reason, detail) => {
    const response = await socialAPI.report(postId, reason, detail);
    set({ cases: { ...get().cases, [postId]: response.data.case_number } });
    return response.data;
  },

  block: async (targetId, kind = "block") => {
    await socialAPI.block(targetId, kind);
    // Re-read rather than removing rows locally: the server decides what a
    // block hides, including posts the client has not seen yet.
    await get().retry();
  },

  unblock: async (targetId, kind = "block") => {
    await socialAPI.unblock(targetId, kind);
    await get().retry();
  },
}));

export { FEED_TIMEOUT_MS, describeFailure, worthRetrying };
