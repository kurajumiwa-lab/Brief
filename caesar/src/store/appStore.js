/**
 * THE STORE — one object, one persisted snapshot, no server.
 *
 * Everything a real client would POST is applied locally first and then either
 * "sent" (online) or queued (offline). That order is deliberate: the product's
 * promise is that a weak connection never stops you participating, and a
 * prototype that only works online would not show that.
 *
 * The queue is the honest part of being offline. Queued actions are marked in
 * the interface, survive a reload, and are cleared together when the network
 * returns — so "offline" is a visible state, not a lie told by an optimistic
 * button.
 */
import { create } from "zustand";
import { buildSeed } from "@/data/seed.js";
import { clearState, loadState, saveState } from "@/lib/storage.js";

/** Only data is persisted; actions and toasts are rebuilt on every load. */
const DATA_KEYS = [
  "version",
  "viewerId",
  "users",
  "circles",
  "posts",
  "memberships",
  "preferences",
  "queue",
  "reports",
  "blocks",
  "mutes",
];

const snapshot = (state) => Object.fromEntries(DATA_KEYS.map((key) => [key, state[key]]));

function seeded() {
  return loadState(buildSeed);
}

let toastSeq = 0;

export const useApp = create((set, get) => {
  /** Apply a change and write it through to storage in the same step. */
  const commit = (patch) => {
    set(patch);
    saveState(snapshot(get()));
  };

  return {
    ...seeded(),
    toasts: [],

    /* ── ephemeral ─────────────────────────────────────────────────────── */

    toast: (message, tone = "green") => {
      const id = ++toastSeq;
      set((state) => ({ toasts: [...state.toasts, { id, message, tone }] }));
      window.setTimeout(() => {
        set((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== id) }));
      }, 3600);
    },

    dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),

    /* ── preferences ───────────────────────────────────────────────────── */

    setPreference: (key, value) => {
      commit({ preferences: { ...get().preferences, [key]: value } });
    },

    /** Back online: everything queued is "sent" at once. */
    goOnline: () => {
      const queued = get().queue || [];
      commit({
        preferences: { ...get().preferences, offline: false },
        queue: [],
      });
      if (queued.length) {
        get().toast(
          queued.length === 1 ? "1 queued action sent" : `${queued.length} queued actions sent`,
          "gold"
        );
      }
    },

    goOffline: () => {
      commit({ preferences: { ...get().preferences, offline: true } });
      get().toast("You are offline. Actions will be queued.", "gold");
    },

    /* ── reactions ─────────────────────────────────────────────────────── */

    react: (postId, value) => {
      const { viewerId, posts, preferences, queue } = get();
      const post = posts.find((entry) => entry.id === postId);
      if (!post) return;

      const mine = post.reactions.find((reaction) => reaction.userId === viewerId);
      let reactions;
      let nextValue = value;

      if (mine && mine.value === value) {
        // Pressing the same button again withdraws the reaction. A decision the
        // community can see should also be one a person can take back.
        reactions = post.reactions.filter((reaction) => reaction.userId !== viewerId);
        nextValue = null;
      } else if (mine) {
        reactions = post.reactions.map((reaction) =>
          reaction.userId === viewerId ? { ...reaction, value, at: Date.now() } : reaction
        );
      } else {
        reactions = [
          ...post.reactions,
          { id: `${postId}-mine-${Date.now()}`, userId: viewerId, value, at: Date.now() },
        ];
      }

      const nextQueue = preferences.offline
        ? upsertQueued(queue, {
            key: `reaction:${postId}`,
            type: "reaction",
            postId,
            value: nextValue,
            at: Date.now(),
          })
        : queue;

      commit({
        posts: posts.map((entry) => (entry.id === postId ? { ...entry, reactions } : entry)),
        queue: nextQueue,
      });
    },

    /* ── posts ─────────────────────────────────────────────────────────── */

    addPost: ({ circleId, body, image = null, voice = null, lang = "en" }) => {
      const { viewerId, posts, preferences, queue } = get();
      const id = `p-mine-${Date.now()}`;
      const post = {
        id,
        circleId,
        authorId: viewerId,
        lang,
        body: String(body || "").trim(),
        image,
        imageAlt: image ? "Image attached to the post" : "",
        voice,
        createdAt: new Date().toISOString(),
        reactions: [],
        status: "published",
        reportsUpheld: 0,
        dataKb: Math.round((1.2 + (voice?.kb || 0) + (image ? 140 : 0)) * 10) / 10,
      };

      const nextQueue = preferences.offline
        ? upsertQueued(queue, { key: `post:${id}`, type: "post", postId: id, at: Date.now() })
        : queue;

      commit({ posts: [post, ...posts], queue: nextQueue });
      return post;
    },

    /* ── circles ───────────────────────────────────────────────────────── */

    toggleJoin: (circleId) => {
      const { memberships, circles } = get();
      const joined = memberships.includes(circleId);
      const next = joined ? memberships.filter((id) => id !== circleId) : [...memberships, circleId];
      commit({ memberships: next });
      const circle = circles.find((entry) => entry.id === circleId);
      get().toast(
        joined ? `Left ${circle?.name || "circle"}` : `Joined ${circle?.name || "circle"}`,
        joined ? "green" : "gold"
      );
    },

    /* ── moderation ────────────────────────────────────────────────────── */

    /**
     * A report never removes the post. It opens a case. Only a moderator
     * decision does anything to what other people can see — which is why
     * reporting is here and downvoting is in `react`.
     */
    report: (postId, reason) => {
      const { reports } = get();
      const entry = { id: `rep-${Date.now()}`, postId, reason, at: new Date().toISOString(), status: "received" };
      commit({ reports: [entry, ...reports] });
      get().toast("Report received. A moderator will review it.", "gold");
      return entry;
    },

    block: (userId) => {
      const { blocks } = get();
      if (blocks.includes(userId)) return;
      commit({ blocks: [...blocks, userId], mutes: get().mutes.filter((id) => id !== userId) });
      get().toast("Blocked. Their posts no longer appear for you.");
    },

    unblock: (userId) => commit({ blocks: get().blocks.filter((id) => id !== userId) }),

    mute: (userId) => {
      const { mutes } = get();
      if (mutes.includes(userId)) return;
      commit({ mutes: [...mutes, userId] });
      get().toast("Muted. Their posts are hidden from your feed.");
    },

    unmute: (userId) => commit({ mutes: get().mutes.filter((id) => id !== userId) }),

    /* ── the whole prototype ───────────────────────────────────────────── */

    resetPrototype: () => {
      clearState();
      const fresh = buildSeed();
      set({ ...fresh, toasts: [] });
      saveState(snapshot(get()));
      get().toast("Prototype reset to its starting data.");
    },
  };
});

/** One queued intent per thing; re-pressing a button replaces, never stacks. */
function upsertQueued(queue, entry) {
  const rest = queue.filter((item) => item.key !== entry.key);
  return [...rest, entry];
}

export default useApp;
