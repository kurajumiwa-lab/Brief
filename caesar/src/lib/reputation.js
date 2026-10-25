/**
 * REPUTATION — what someone has actually contributed, counted in the open.
 *
 * There is no follower count on this product, and no "influencer" score. The
 * profile answers a narrower question: *has this person's posting been useful
 * to a community, and has it been fair?* Every number below is defined in
 * words on the profile screen, because a reputation signal nobody can explain
 * is just status with extra steps.
 *
 *   Useful contribution   a post that reached 60% support at 95% confidence
 *                         with at least 5 reactions. Five people is the floor:
 *                         one friend agreeing is not a contribution.
 *   Trusted circle        a circle where you have at least one useful
 *                         contribution and no upheld report.
 *   Upheld report         a moderation decision that found a rule broken.
 *                         Separate system, separate count — dissent is not
 *                         misbehaviour and never lands here.
 */
import { computeVerdict } from "./ranking.js";

export const USEFUL_MIN_REACTIONS = 5;
export const USEFUL_MIN_CONFIDENCE = 0.6;

export const STANDING = {
  new: { label: "New here", tone: "quiet", note: "No post has reached 5 reactions at 60% confidence yet." },
  member: { label: "Contributor", tone: "green", note: "At least one useful contribution." },
  trusted: { label: "Trusted voice", tone: "gold", note: "Three or more useful contributions, no upheld reports." },
};

/** A post counts as useful when a real sample mostly supports it. */
export function isUsefulPost(post) {
  const verdict = computeVerdict(post);
  return (
    verdict.participation >= USEFUL_MIN_REACTIONS &&
    verdict.confidence >= USEFUL_MIN_CONFIDENCE
  );
}

export function reputationFor(userId, { posts = [] } = {}) {
  const authored = posts.filter((post) => post.authorId === userId);
  const useful = authored.filter(isUsefulPost);
  const upheldReports = authored.reduce((sum, post) => sum + (post.reportsUpheld || 0), 0);

  const circles = new Set(useful.map((post) => post.circleId));
  let standing = "new";
  if (useful.length >= 3 && upheldReports === 0) standing = "trusted";
  else if (useful.length >= 1) standing = "member";

  return {
    standing,
    ...STANDING[standing],
    posts: authored.length,
    useful: useful.length,
    usefulRate: authored.length ? useful.length / authored.length : 0,
    circles: circles.size,
    upheldReports,
  };
}

export default { reputationFor, isUsefulPost, STANDING };
