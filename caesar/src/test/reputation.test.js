/**
 * REPUTATION — what it counts, and the two things it must never count.
 *
 * The profile is the place where a social product quietly reintroduces status.
 * These specs pin the definition in the copy: a contribution needs a real
 * sample, disagreement never lands here, and only an upheld moderation decision
 * does.
 */
import { describe, expect, it } from "vitest";
import { isUsefulPost, reputationFor, USEFUL_MIN_CONFIDENCE, USEFUL_MIN_REACTIONS } from "@/lib/reputation.js";
import { RANKING } from "@/lib/ranking.js";

const NOW = Date.UTC(2026, 9, 25, 9, 0, 0);
const HOUR = 3_600_000;

const reactions = (up, down = 0, idPrefix = "r") => [
  ...Array.from({ length: up }, (_, i) => ({ id: `${idPrefix}u${i}`, userId: `${idPrefix}u${i}`, value: "up", at: NOW - HOUR })),
  ...Array.from({ length: down }, (_, i) => ({ id: `${idPrefix}d${i}`, userId: `${idPrefix}d${i}`, value: "down", at: NOW - HOUR })),
];

const post = (over = {}) => ({
  id: "p",
  circleId: "c1",
  authorId: "author",
  createdAt: new Date(NOW - 2 * HOUR).toISOString(),
  reactions: [],
  reportsUpheld: 0,
  ...over,
});

describe("what counts as a useful contribution", () => {
  it("needs a real sample, not two friends", () => {
    const twoFriends = post({ reactions: reactions(2) });
    expect(isUsefulPost(twoFriends)).toBe(false);
  });

  it("accepts a post five people mostly supported", () => {
    const supported = post({ reactions: reactions(6) });
    expect(isUsefulPost(supported)).toBe(true);
  });

  it("refuses a post with the volume but not the support", () => {
    const split = post({ reactions: reactions(5, 5) });
    expect(isUsefulPost(split)).toBe(false);
  });

  it("uses the same thresholds the profile states", () => {
    expect(USEFUL_MIN_REACTIONS).toBe(5);
    expect(USEFUL_MIN_CONFIDENCE).toBe(0.6);
  });
});

describe("disagreement never lands on the author", () => {
  it("does not count a heavily downvoted post as a mark against them", () => {
    const dogpiled = post({ reactions: [...reactions(3), ...reactions(0, 20, "x")] });
    const standing = reputationFor("author", { posts: [dogpiled] });
    expect(standing.upheldReports).toBe(0);
    expect(standing.useful).toBe(0);
    // Still "new" — not punished, just not credited.
    expect(standing.standing).toBe("new");
  });

  it("only moves down when a moderation decision upheld a report", () => {
    const useful = post({ id: "a", reactions: reactions(10) });
    const two = post({ id: "b", circleId: "c2", reactions: reactions(12) });
    const three = post({ id: "c", circleId: "c3", reactions: reactions(9) });
    const upheld = post({ id: "d", circleId: "c4", reactions: reactions(11), reportsUpheld: 1 });

    expect(reputationFor("author", { posts: [useful, two, three] }).standing).toBe("trusted");
    expect(reputationFor("author", { posts: [useful, two, three, upheld] }).standing).toBe("member");
  });
});

describe("the counts are checkable", () => {
  it("reports posts, useful posts, the hit rate and the circles reached", () => {
    const posts = [
      post({ id: "a", reactions: reactions(10) }),
      post({ id: "b", circleId: "c2", reactions: reactions(0, 4) }),
      post({ id: "c", circleId: "c3", reactions: reactions(7) }),
    ];
    const standing = reputationFor("author", { posts });
    expect(standing.posts).toBe(3);
    expect(standing.useful).toBe(2);
    expect(standing.usefulRate).toBeCloseTo(2 / 3, 5);
    expect(standing.circles).toBe(2);
  });

  it("says plainly when nothing has been counted yet", () => {
    const standing = reputationFor("nobody", { posts: [post()] });
    expect(standing.standing).toBe("new");
    expect(standing.note).toMatch(/5 reactions/);
  });
});

describe("the ranking and the reputation agree on the same numbers", () => {
  it("is not impressed by a post that is contested", () => {
    const contested = post({ reactions: reactions(6, 6) });
    const standing = reputationFor("author", { posts: [contested] });
    expect(standing.useful).toBe(0);
    expect(RANKING.contestedDissentShare).toBeLessThanOrEqual(0.5);
  });
});
