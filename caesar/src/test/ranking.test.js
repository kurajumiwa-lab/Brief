/**
 * THE BALANCED VERDICT — the rules the product promises, tested as rules.
 *
 * These are not "does the function run" specs. Each one pins a promise made to
 * users in the interface copy, because a ranking nobody can hold to account is
 * the exact thing this product says it is not.
 */
import { describe, expect, it } from "vitest";
import {
  RANKING,
  burstWindow,
  computeVerdict,
  rankPosts,
  scorePost,
  whyThisAppears,
  wilsonLower,
} from "@/lib/ranking.js";

const HOUR = 3_600_000;
const NOW = Date.UTC(2026, 9, 25, 9, 0, 0);

const user = (id, over = {}) => ({ id, name: id, handle: id, reactionsGiven: 20, ...over });

const reaction = (userId, value, at) => ({ id: `${userId}-${at}`, userId, value, at });

/** n reactions of each value, spread over `hours`, all from established accounts. */
function reactions(up, down, { createdAt = NOW - 2 * HOUR, hours = 2, startId = 0 } = {}) {
  const span = hours * HOUR;
  const total = up + down;
  const list = [];
  for (let i = 0; i < total; i += 1) {
    const value = i < up ? "up" : "down";
    list.push({
      id: `r${startId + i}`,
      userId: `u${startId + i}`,
      value,
      at: Math.round(createdAt + (span * (i + 0.5)) / total),
    });
  }
  return list;
}

const post = (over = {}) => ({
  id: "p1",
  circleId: "c1",
  authorId: "author",
  createdAt: new Date(NOW - 2 * HOUR).toISOString(),
  reactions: [],
  ...over,
});

const usersFor = (list) => Object.fromEntries(list.map((entry) => [entry.id, entry]));

describe("a small sample cannot decide anything", () => {
  it("gives two unanimous reactions a confidence of about a third, not a hundred percent", () => {
    expect(wilsonLower(2, 2)).toBeCloseTo(0.342, 3);
  });

  it("needs a real sample before confidence approaches the raw share", () => {
    expect(wilsonLower(34, 37)).toBeGreaterThan(0.75);
    expect(wilsonLower(2, 2)).toBeLessThan(wilsonLower(34, 37));
  });

  it("says so in the card's own reasoning", () => {
    const entry = { post: post({ reactions: reactions(2, 0) }), verdict: computeVerdict(post({ reactions: reactions(2, 0) })) };
    expect(entry.verdict.needsMoreVoices).toBe(true);
    expect(whyThisAppears(entry).text).toMatch(/small sample/i);
  });
});

describe("disagreement lowers reach and never removes a post", () => {
  const contested = post({ reactions: reactions(6, 10, { hours: 6 }) });

  it("marks a post contested once enough people disagree", () => {
    const verdict = computeVerdict(contested);
    expect(verdict.participation).toBeGreaterThanOrEqual(RANKING.contestedMinReactions);
    expect(verdict.dissentShare).toBeGreaterThanOrEqual(RANKING.contestedDissentShare);
    expect(verdict.contested).toBe(true);
  });

  it("never drops a contested post from the ranking, whatever its score", () => {
    const ranked = rankPosts([contested], { now: NOW });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].post.id).toBe("p1");
  });

  it("holds a heavily downvoted post at the published floor", () => {
    const old = post({
      createdAt: new Date(NOW - 30 * 24 * HOUR).toISOString(), // a month old, out of circle
      reactions: reactions(0, 12, { createdAt: NOW - 30 * 24 * HOUR, hours: 2 }),
    });
    const verdict = computeVerdict(old, { now: NOW });
    const rank = scorePost(old, { verdict, viewerCircleIds: new Set(), now: NOW });
    expect(verdict.contested).toBe(true);
    expect(rank.raisedByFloor).toBe(true);
    expect(rank.score).toBe(RANKING.contestedFloor);
  });

  it("still ranks a dogpiled post below a well-supported one", () => {
    const good = post({ id: "good", reactions: reactions(30, 2) });
    const bad = post({ id: "bad", reactions: reactions(5, 20) });
    const ranked = rankPosts([bad, good], { now: NOW });
    expect(ranked[0].post.id).toBe("good");
  });

  it("gives contested posts a reason that says they stay up", () => {
    const verdict = computeVerdict(contested, { now: NOW });
    const entry = { post: contested, verdict, parts: { confidence: 0.2, participation: 0.5, recency: 0.9, circle: 1 } };
    expect(whyThisAppears(entry).text).toMatch(/dissent never hides a post/i);
  });
});

describe("coordinated bursts are damped, not banned", () => {
  const base = NOW - 6 * HOUR;
  const organic = [0, 1, 2, 3, 4].map((i) => reaction(`u${i}`, "up", base + i * HOUR));
  const burst = Array.from({ length: 14 }, (_, i) => reaction(`fresh${i}`, "down", base + 5 * HOUR + i * 2000));
  const packed = post({ reactions: [...organic, ...burst] });

  it("finds the window when a third of reactions land inside a minute", () => {
    const found = burstWindow(packed.reactions);
    expect(found.suspected).toBe(true);
    expect(found.count).toBe(14);
    expect(found.share).toBeGreaterThan(RANKING.burstShare);
  });

  it("leaves a slow, honest crowd alone", () => {
    const spread = Array.from({ length: 20 }, (_, i) => reaction(`u${i}`, "down", base + i * 20 * 60_000));
    expect(burstWindow(spread).suspected).toBe(false);
  });

  it("counts the burst at half weight and says so", () => {
    const verdict = computeVerdict(packed);
    expect(verdict.coordination.suspected).toBe(true);
    expect(verdict.coordination.factor).toBe(RANKING.burstDamping);
    // 5 organic up + 14 damped down = 5 + 7 weighted, not 19.
    expect(verdict.weightedParticipation).toBeLessThan(verdict.participation);
    expect(verdict.participation).toBe(19);
  });

  it("does not ban, hide or delete anyone — the post still ranks", () => {
    const ranked = rankPosts([packed], { now: NOW });
    expect(ranked).toHaveLength(1);
    expect(ranked[0].post.reactions).toHaveLength(19);
  });
});

describe("the published weights are the ones applied", () => {
  it("sum to 1, so the score is on a 0–1 scale", () => {
    const total = Object.values(RANKING.weights).reduce((sum, weight) => sum + weight, 0);
    expect(total).toBeCloseTo(1, 5);
  });

  it("returns the four parts the panel prints", () => {
    const sample = post({ reactions: reactions(10, 2) });
    const rank = scorePost(sample, { verdict: computeVerdict(sample, { now: NOW }), viewerCircleIds: new Set(["c1"]), now: NOW });
    expect(Object.keys(rank.parts).sort()).toEqual(["circle", "confidence", "participation", "recency"]);
    for (const value of Object.values(rank.parts)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("uses the same numbers the feed sorted by", () => {
    const entry = rankPosts([post({ reactions: reactions(9, 1) })], { now: NOW })[0];
    const verdict = computeVerdict(entry.post, { now: NOW });
    const recomputed = scorePost(entry.post, { verdict, now: NOW });
    expect(recomputed.score).toBe(entry.score);
  });
});

describe("freshness and circle fit are real, but small", () => {
  it("ranks a fresh post above an identical old one", () => {
    const fresh = post({ id: "fresh", createdAt: new Date(NOW - 1 * HOUR).toISOString(), reactions: reactions(8, 0) });
    const old = post({ id: "old", createdAt: new Date(NOW - 3 * 24 * HOUR).toISOString() });
    const ranked = rankPosts([old, fresh], { now: NOW });
    expect(ranked[0].post.id).toBe("fresh");
  });

  it("ranks a post inside your circles above the same post outside them", () => {
    const inside = post({ id: "in", circleId: "c1" });
    const outside = post({ id: "out", circleId: "c-other" });
    const ranked = rankPosts([outside, inside], { viewerCircleIds: new Set(["c1"]), now: NOW });
    expect(ranked[0].post.id).toBe("in");
  });

  it("does not let freshness outrank a strong community verdict", () => {
    const strong = post({
      id: "strong",
      createdAt: new Date(NOW - 10 * HOUR).toISOString(),
      reactions: reactions(40, 2, { hours: 10 }),
    });
    const brandNew = post({ id: "new", circleId: "c2", createdAt: new Date(NOW - 60_000).toISOString() });
    const ranked = rankPosts([brandNew, strong], { viewerCircleIds: new Set(["c1"]), now: NOW });
    expect(ranked[0].post.id).toBe("strong");
  });
});

describe("account standing is weighted, not trusted blindly", () => {
  it("counts a first-time account's reaction for slightly less", () => {
    const newbie = { id: "newbie", reactionsGiven: 0 };
    const veteran = { id: "veteran", reactionsGiven: 50 };
    const withNewbie = post({ reactions: [reaction("newbie", "up", NOW - HOUR)] });
    const withVeteran = post({ reactions: [reaction("veteran", "up", NOW - HOUR)] });

    const a = computeVerdict(withNewbie, { usersById: usersFor([newbie]) });
    const b = computeVerdict(withVeteran, { usersById: usersFor([veteran]) });
    expect(a.weightedUp).toBeLessThan(b.weightedUp);
    // …but they can still be counted, and their vote still exists.
    expect(a.up).toBe(1);
  });
});

describe("determinism", () => {
  it("produces the same order from the same data and clock", () => {
    const posts = [
      post({ id: "a", reactions: reactions(5, 1) }),
      post({ id: "b", reactions: reactions(9, 3) }),
      post({ id: "c", circleId: "c2", reactions: reactions(1, 0) }),
    ];
    const first = rankPosts(posts, { now: NOW }).map((entry) => entry.post.id);
    const second = rankPosts([...posts].reverse(), { now: NOW }).map((entry) => entry.post.id);
    expect(first).toEqual(second);
  });
});
