/**
 * LIVE — the same screens, with the network behind them.
 *
 * This store is only ever active when a session exists (see `store/session.js`).
 * It holds the server's answer, patches it locally for the half-second before
 * the server answers again, and — importantly — never invents a number that the
 * server did not send. After every write it re-reads the ranked feed, so the
 * score on a card is always the score the server computed from real rows.
 *
 * Errors are kept in one place because there are only two kinds:
 *
 *   · **Refused** (400/403/409/422) — the server said something specific, and
 *     that sentence is what the person needs to read. A report you already
 *     filed is a 409 carrying the case number, not a generic failure.
 *   · **Ended** (401) — the token is dead. The session is cleared rather than
 *     left to fail on every screen, and the interface drops back to the
 *     on-device network with a line explaining why.
 */
import { create } from "zustand";
import { ApiError, createApi } from "@/lib/api.js";
import { toEntries } from "@/lib/liveFeed.js";
import { useSession } from "./session.js";

/** One API instance for the whole app; the token is read per request. */
export const api = createApi({
  baseUrl: "/api",
  getToken: () => useSession.getState().token,
  // Resolved per call so a test can install its own fetch after this module
  // loaded — and so the preview's service worker can never freeze a stale one.
  fetchImpl: (...args) => globalThis.fetch(...args),
});

const initial = {
  entries: [],
  circles: [],
  blocks: [],
  mutes: [],
  /** id → {handle, display_name, city}, so a blocked person can be named. */
  people: {},
  reports: [],
  status: "idle",
  error: null,
  notice: null,
  lastLoadedAt: null,
};

function messageFor(error) {
  if (error instanceof ApiError) return error.message;
  return "Something went wrong. Try again in a moment.";
}

export const useLive = create((set, get) => {
  /** Route an error to the right place: refused → notice, ended → sign-out. */
  const fail = (error) => {
    if (error instanceof ApiError && error.status === 401) {
      useSession.getState().demote("Your session ended. Join again to keep taking part.");
      set({ status: "idle", entries: [], circles: [], error: null });
      return false;
    }
    set({ error: error instanceof ApiError && error.offline ? "offline" : messageFor(error) });
    return false;
  };

  const ready = () => useSession.getState().mode === "live" && Boolean(useSession.getState().token);

  return {
    ...initial,

    clear: () => set({ ...initial }),
    dismissNotice: () => set({ notice: null }),

    /** Load the ranked feed. `quiet` keeps the existing list on screen. */
    load: async ({ quiet = false } = {}) => {
      if (!ready()) return;
      if (!quiet) set({ status: get().entries.length ? "refreshing" : "loading", error: null });
      try {
        const payload = await api.feed({ limit: 50 });
        set({ entries: toEntries(payload), status: "ready", error: null, lastLoadedAt: Date.now() });
      } catch (error) {
        fail(error);
        set((state) => ({ status: state.entries.length ? "ready" : "error" }));
      }
    },

    react: async (postId, value) => {
      if (!ready()) return;
      const before = get().entries;
      const entry = before.find((item) => item.post.id === postId);
      const withdraw = entry?.viewerReaction === value;

      // Optimistic, and only the numbers this person just changed: which button
      // is pressed, and the two counts. Score, parts and confidence keep the
      // server's last answer until the reload below replaces them.
      set({
        entries: before.map((item) => {
          if (item.post.id !== postId) return item;
          const up = item.verdict.up + (item.viewerReaction === "up" ? -1 : value === "up" && !withdraw ? 1 : 0);
          const down =
            item.verdict.down + (item.viewerReaction === "down" ? -1 : value === "down" && !withdraw ? 1 : 0);
          return {
            ...item,
            viewerReaction: withdraw ? null : value,
            verdict: { ...item.verdict, up: Math.max(0, up), down: Math.max(0, down) },
          };
        }),
      });

      try {
        if (withdraw) await api.withdraw(postId);
        else await api.react(postId, value);
        // The authoritative answer — including the score the server derived
        // from this reaction — replaces the optimistic one.
        await get().load({ quiet: true });
      } catch (error) {
        set({ entries: before });
        fail(error);
      }
    },

    createPost: async (post) => {
      if (!ready()) return null;
      try {
        const created = await api.createPost(post);
        await get().load({ quiet: true });
        return created;
      } catch (error) {
        fail(error);
        return null;
      }
    },

    report: async (postId, reason, detail) => {
      if (!ready()) return null;
      try {
        const report = await api.report(postId, reason, detail);
        set((state) => ({
          reports: [report, ...state.reports],
          notice: `Case ${report.case_number} opened. The post stays up until a moderator decides.`,
        }));
        return report;
      } catch (error) {
        return fail(error);
      }
    },

    /** `kind` is "block" or "mute"; both hide the author from your feed only. */
    hide: async (targetId, kind) => {
      if (!ready()) return false;
      try {
        await api.block(targetId, kind);
        const key = kind === "block" ? "blocks" : "mutes";
        set((state) => ({
          [key]: [targetId, ...state[key].filter((id) => id !== targetId)],
          entries: state.entries.filter((item) => item.post.authorId !== targetId),
        }));
        return true;
      } catch (error) {
        return fail(error);
      }
    },

    unhide: async (targetId, kind) => {
      if (!ready()) return false;
      try {
        await api.unblock(targetId, kind);
        const key = kind === "block" ? "blocks" : "mutes";
        set((state) => ({ [key]: state[key].filter((id) => id !== targetId) }));
        await get().load({ quiet: true });
        return true;
      } catch (error) {
        return fail(error);
      }
    },

    /* ── circles ──────────────────────────────────────────────────────── */

    loadCircles: async () => {
      if (!ready()) return;
      try {
        set({ circles: await api.circles() });
      } catch (error) {
        fail(error);
      }
    },

    toggleFollow: async (circleId) => {
      if (!ready()) return false;
      const following = get().circles.find((circle) => circle.id === circleId)?.following;
      try {
        if (following) await api.unfollow(circleId);
        else await api.follow(circleId);
        await get().loadCircles();
        await get().load({ quiet: true });
        return !following;
      } catch (error) {
        return fail(error);
      }
    },

    /* ── everything the safety screen needs ───────────────────────────── */

    loadSafety: async () => {
      if (!ready()) return;
      try {
        const [reports, blocks, mutes] = await Promise.all([api.reports(), api.blocks("block"), api.blocks("mute")]);
        const people = {};
        for (const row of [...blocks, ...mutes]) {
          if (row.target) people[row.target.id] = row.target;
        }
        set({
          reports,
          blocks: blocks.map((row) => row.target_id),
          mutes: mutes.map((row) => row.target_id),
          people: { ...get().people, ...people },
        });
      } catch (error) {
        fail(error);
      }
    },
  };
});

export default useLive;
