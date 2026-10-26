/**
 * THE SIX THINGS THE BRIEF ASKS TO BE JUDGED ON.
 *
 * Every assertion here is about a number the Measure screen prints. They are
 * unit tests rather than click-tests because the point is the arithmetic: a
 * metric that disagrees with the state it summarises is worse than no metric.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { measure } from "@/lib/metrics.js";
import { computeVerdict } from "@/lib/ranking.js";
import { isUsefulPost } from "@/lib/reputation.js";
import { useApp } from "@/store/appStore.js";
import { resetStore } from "./helpers.js";

const byKey = (metrics, key) => metrics.find((metric) => metric.key === key);

const NOW = Date.UTC(2026, 9, 25, 9, 0, 0);

/** The seed builds relative to the wall clock; freeze it so numbers are stable. */
const freshState = (overrides = {}) => {
  const state = resetStore(overrides);
  return { ...state, now: NOW };
};

beforeEach(() => {
  resetStore();
});

describe("what the prototype will and will not report", () => {
  it("offers all six of the brief's measures, in order", () => {
    const metrics = measure(freshState(), { now: NOW });
    expect(metrics.map((metric) => metric.key)).toEqual([
      "retention",
      "data",
      "quality",
      "fairness",
      "language",
      "moderation",
    ]);
  });

  it("refuses to invent a retention number", () => {
    const retention = byKey(measure(freshState(), { now: NOW }), "retention");
    expect(retention.measurable).toBe(false);
    expect(retention.headline).toBe("Not measurable here");
    expect(retention.note).toMatch(/no accounts/i);
  });
});

describe("data consumption", () => {
  it("sums the per-post bytes the cards print", () => {
    const state = freshState();
    const total = state.posts.reduce((sum, post) => sum + post.dataKb, 0);
    const data = byKey(measure(state, { now: NOW }), "data");

    expect(data.measurable).toBe(true);
    expect(data.headline).toBe(
      total < 1024 ? `${Math.round(total)} KB` : `${(total / 1024).toFixed(1)} MB`
    );
  });

  it("separates text, photographs and voice — and says what saver withholds", () => {
    const state = freshState();
    const data = byKey(measure(state, { now: NOW }), "data");
    const withheld = data.rows.find((row) => row.label === "Withheld by data saver");
    const voice = data.rows.find((row) => row.label === "Voice notes");

    expect(withheld.value).not.toBe("nothing to withhold");
    // The seed's voice note is the expensive item, so it must move the total.
    expect(voice.value).not.toMatch(/^<1 KB/);
    expect(data.note).toMatch(/gates voice as well as photographs/i);
  });

  it("names the heaviest post, because that is the one worth compressing", () => {
    const state = freshState();
    const heaviest = [...state.posts].sort((a, b) => b.dataKb - a.dataKb)[0];
    const data = byKey(measure(state, { now: NOW }), "data");
    expect(data.note).toContain(String(Math.round(heaviest.dataKb)) + " KB");
  });
});

describe("content quality", () => {
  it("counts the same useful posts the profile screen counts", () => {
    const state = freshState();
    const expected = state.posts.filter(isUsefulPost).length;
    const quality = byKey(measure(state, { now: NOW }), "quality");
    expect(quality.rows.find((row) => row.label.startsWith("Useful =")).value).toBe(String(expected));
    expect(quality.sub).toContain(`of ${state.posts.length} posts`);
  });
});

describe("fairness", () => {
  it("shows contested posts surviving the ranking, and never as hidden", () => {
    const state = freshState();
    const usersById = Object.fromEntries(state.users.map((user) => [user.id, user]));
    const contested = state.posts.filter(
      (post) => computeVerdict(post, { usersById, now: NOW }).contested
    );

    const fairness = byKey(measure(state, { now: NOW }), "fairness");
    expect(fairness.headline).toBe(`${contested.length} of ${contested.length}`);
    expect(fairness.rows.find((row) => row.label === "Hidden for disagreement").value).toBe(
      "0 — no code path can do it"
    );
  });

  it("still counts a post a moderator removed, and says so", () => {
    const state = freshState();
    const posts = state.posts.map((post, index) =>
      index === 0 ? { ...post, status: "removed" } : post
    );
    const fairness = byKey(measure({ ...state, posts }, { now: NOW }), "fairness");
    expect(fairness.rows.find((row) => row.label === "Removed by moderation").value).toBe("1");
  });
});

describe("language participation", () => {
  it("counts posts per language tag, not per interface language", () => {
    const state = freshState();
    const language = byKey(measure(state, { now: NOW }), "language");
    const swahili = state.posts.filter((post) => post.lang === "sw").length;
    const row = language.rows.find((entry) => entry.label.startsWith("Kiswahili"));
    expect(row.value.startsWith(String(swahili))).toBe(true);
  });

  it("changes when the reader switches interface language", () => {
    const state = freshState();
    const english = byKey(measure(state, { now: NOW }), "language");
    const swahili = byKey(
      measure({ ...state, preferences: { ...state.preferences, locale: "sw" } }, { now: NOW }),
      "language"
    );
    expect(english.sub).toContain("en interface");
    expect(swahili.sub).toContain("sw interface");
    expect(english.headline).not.toBe(swahili.headline);
  });
});

describe("moderation outcomes", () => {
  it("counts reports by status so a queue that never drains is visible", () => {
    const state = freshState();
    const reports = [
      { id: "r1", postId: state.posts[0].id, reason: "spam", at: new Date(NOW).toISOString(), status: "received" },
      { id: "r2", postId: state.posts[1].id, reason: "spam", at: new Date(NOW).toISOString(), status: "upheld" },
      { id: "r3", postId: state.posts[2].id, reason: "spam", at: new Date(NOW).toISOString(), status: "dismissed" },
    ];
    const moderation = byKey(measure({ ...state, reports }, { now: NOW }), "moderation");

    expect(moderation.headline).toBe("3");
    expect(moderation.rows.find((row) => row.label === "Awaiting a moderator").value).toBe("1");
    expect(moderation.rows.find((row) => row.label === "Upheld").value).toBe("1");
    expect(moderation.rows.find((row) => row.label === "Dismissed").value).toBe("1");
  });

  it("starts at zero rather than pretending cases exist", () => {
    const moderation = byKey(measure(freshState(), { now: NOW }), "moderation");
    expect(moderation.headline).toBe("0");
    expect(moderation.note).toMatch(/no moderator console/i);
  });
});
