/**
 * ONE SET OF ACTIONS, TWO PLACES THEY CAN GO.
 *
 * Every screen in Caesar asks the same question — "what happens when I press
 * this?" — and the answer depends only on where the session points:
 *
 *   · **local** → the seeded network in this browser (`store/appStore.js`).
 *   · **live**  → `/api/social` on the Brief backend, which ranks real rows.
 *
 * Putting the switch in one hook rather than in each card is what keeps the two
 * modes from drifting: a component never knows which one it is in, and the
 * ranking explanation on a live card is produced by the same function as the
 * demo's (see `lib/liveFeed.js`).
 */
import { useMemo } from "react";
import { useApp } from "@/store/appStore.js";
import { useSession } from "@/store/session.js";
import { useLive } from "@/store/live.js";
import { circleById, isJoined } from "@/lib/selectors.js";

export function useSocial() {
  const mode = useSession((state) => state.mode);
  const account = useSession((state) => state.account);
  const liveNotices = useLive((state) => state.notice);
  const liveError = useLive((state) => state.error);
  const liveStatus = useLive((state) => state.status);
  const liveEntries = useLive((state) => state.entries);
  const liveCircles = useLive((state) => state.circles);

  const users = useApp((state) => state.users);
  const circles = useApp((state) => state.circles);
  const memberships = useApp((state) => state.memberships);
  const viewerId = useApp((state) => state.viewerId);
  const toast = useApp((state) => state.toast);
  const queue = useApp((state) => state.queue);

  // Selected one by one: these are stable function references in the store, so
  // the hook never re-renders because it built a fresh object.
  const localReact = useApp((state) => state.react);
  const localMute = useApp((state) => state.mute);
  const localBlock = useApp((state) => state.block);
  const localReport = useApp((state) => state.report);
  const localJoin = useApp((state) => state.toggleJoin);
  const localActions = useMemo(
    () => ({ react: localReact, mute: localMute, block: localBlock, report: localReport, toggleJoin: localJoin }),
    [localReact, localMute, localBlock, localReport, localJoin]
  );

  return useMemo(() => {
    const live = mode === "live";
    const usersById = Object.fromEntries(users.map((user) => [user.id, user]));

    return {
      mode,
      live,
      account,
      viewerId: live ? account?.id ?? null : viewerId,
      status: liveStatus,
      error: liveError,
      notice: liveNotices,
      queue: live ? [] : queue,

      /** The author of an entry, in whichever vocabulary holds them. */
      authorOf: (entry) =>
        live
          ? entry.author
            ? {
                id: entry.author.id,
                name: entry.author.display_name || entry.author.handle || "Member",
                handle: entry.author.handle || "member",
                city: entry.author.city,
              }
            : { id: entry.post.authorId, name: "Member", handle: "member" }
          : usersById[entry.post.authorId] || null,

      circleOf: (circleId) =>
        live
          ? liveCircles.find((circle) => circle.id === circleId) || null
          : circleById({ circles }, circleId),

      joined: (circleId) =>
        live
          ? Boolean(liveCircles.find((circle) => circle.id === circleId)?.following)
          : isJoined({ memberships }, circleId),

      /** Which button is pressed for this reader. */
      reactionOf: (entry) =>
        live
          ? entry.viewerReaction || null
          : entry.post.reactions.find((reaction) => reaction.userId === viewerId)?.value || null,

      /** Deduplicated: pressing an entry the server already answered for still works. */
      react: (postId, value) => {
        if (!live) return localActions.react(postId, value);
        const entry = liveEntries.find((item) => item.post.id === postId);
        const withdrawing = entry?.viewerReaction === value;
        return useLive
          .getState()
          .react(postId, value)
          .then(() => {
            const error = useLive.getState().error;
            if (error && error !== "offline") toast(error, "terra");
            else toast(withdrawing ? "Reaction withdrawn." : "Reaction counted.", withdrawing ? "quiet" : "gold");
          });
      },

      mute: (authorId) => {
        if (!live) return localActions.mute(authorId);
        return useLive
          .getState()
          .hide(authorId, "mute")
          .then((ok) => ok && toast("Muted. Their posts are hidden from your feed."));
      },

      block: (authorId) => {
        if (!live) return localActions.block(authorId);
        return useLive
          .getState()
          .hide(authorId, "block")
          .then((ok) => ok && toast("Blocked. Their posts no longer appear for you."));
      },

      report: (postId, reason, detail) => {
        if (!live) return localActions.report(postId, reason, detail);
        return useLive
          .getState()
          .report(postId, reason, detail)
          .then((report) => {
            const state = useLive.getState();
            if (report) toast(`Case ${report.case_number} opened. The post stays up.`, "gold");
            else if (state.error && state.error !== "offline") toast(state.error, "terra");
            return report;
          });
      },

      toggleJoin: (circleId) => {
        if (!live) return localActions.toggleJoin(circleId);
        return useLive.getState().toggleFollow(circleId);
      },
    };
  }, [
    mode,
    account,
    liveStatus,
    liveError,
    liveNotices,
    liveEntries,
    liveCircles,
    users,
    circles,
    memberships,
    viewerId,
    toast,
    queue,
    localActions,
  ]);
}

export default useSocial;
