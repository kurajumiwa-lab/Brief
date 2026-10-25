/**
 * SELECTORS — what the screens read.
 *
 * Kept out of the store so the visibility rules are one readable block:
 * a post is hidden from the feed for exactly three reasons, and none of them
 * is disagreement. Blocks and mutes are the viewer's choice; `status` is
 * moderation's. Reaction counts decide *order*, never existence.
 */
import { rankPosts } from "./ranking.js";

export function usersById(state) {
  return Object.fromEntries((state.users || []).map((user) => [user.id, user]));
}

export function viewerCircleIds(state) {
  return new Set(state.memberships || []);
}

export function circleMembers(circleId, users = []) {
  return new Set(users.filter((user) => (user.circles || []).includes(circleId)).map((user) => user.id));
}

function visiblePosts(state) {
  const blocked = new Set(state.blocks || []);
  const muted = new Set(state.mutes || []);
  return (state.posts || []).filter(
    (post) => post.status !== "removed" && !blocked.has(post.authorId) && !muted.has(post.authorId)
  );
}

/** The home feed, ranked, with the reason each entry sits where it does. */
export function feedEntries(state, now = Date.now()) {
  return rankPosts(visiblePosts(state), {
    usersById: usersById(state),
    viewerCircleIds: viewerCircleIds(state),
    now,
  });
}

export function circleEntries(state, circleId, now = Date.now()) {
  return feedEntries(state, now).filter((entry) => entry.post.circleId === circleId);
}

export function circleById(state, circleId) {
  return (state.circles || []).find((circle) => circle.id === circleId) || null;
}

export function userById(state, userId) {
  return (state.users || []).find((user) => user.id === userId) || null;
}

export function postById(state, postId) {
  return (state.posts || []).find((post) => post.id === postId) || null;
}

/** A circle's real membership: the declared base plus the viewer if joined. */
export function circleSize(state, circle) {
  const joined = (state.memberships || []).includes(circle.id);
  return circle.memberCount + (joined ? 1 : 0);
}

export function isJoined(state, circleId) {
  return (state.memberships || []).includes(circleId);
}

/** Everything the viewer has done, in one place, for the Safety centre. */
export function safetySummary(state) {
  return {
    reports: state.reports || [],
    blocked: (state.blocks || []).map((id) => userById(state, id)).filter(Boolean),
    muted: (state.mutes || []).map((id) => userById(state, id)).filter(Boolean),
    queue: state.queue || [],
  };
}

export default {
  feedEntries,
  circleEntries,
  circleById,
  userById,
  postById,
  circleSize,
  isJoined,
  safetySummary,
  usersById,
  viewerCircleIds,
  circleMembers,
};
