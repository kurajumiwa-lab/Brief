/**
 * PERSISTENCE — a prototype that forgets everything on reload is a slideshow.
 *
 * These specs cover the two ways local persistence breaks a demo: a payload
 * written by an older shape of the store, and a browser that refuses to store
 * anything at all (Safari private mode, a full quota). Neither may throw, and
 * neither may half-load.
 */
import { describe, expect, it, beforeEach, vi, afterEach } from "vitest";
import { SCHEMA_VERSION, STORAGE_KEY, clearState, loadState, saveState } from "@/lib/storage.js";
import { useApp } from "@/store/appStore.js";
import { resetStore } from "./helpers.js";

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loading", () => {
  it("falls back to a fresh seed when nothing has been stored", () => {
    window.localStorage.clear();
    const seed = loadState(() => ({ posts: ["fresh"] }));
    expect(seed.posts).toEqual(["fresh"]);
  });

  it("discards a payload written by an older version of the store", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: SCHEMA_VERSION - 1, posts: [{ id: "old" }], circles: [] })
    );
    const seed = loadState(() => ({ posts: ["fresh"] }));
    expect(seed.posts).toEqual(["fresh"]);
  });

  it("discards a payload that is the right version but the wrong shape", () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, posts: "nope" }));
    const seed = loadState(() => ({ posts: ["fresh"] }));
    expect(seed.posts).toEqual(["fresh"]);
  });

  it("survives unparseable JSON rather than crashing the app", () => {
    window.localStorage.setItem(STORAGE_KEY, "{not json");
    expect(() => loadState(() => ({ posts: ["fresh"] }))).not.toThrow();
    expect(loadState(() => ({ posts: ["fresh"] })).posts).toEqual(["fresh"]);
  });
});

describe("saving", () => {
  it("round-trips what it wrote", () => {
    expect(saveState({ posts: [{ id: "a" }], circles: [] })).toBe(true);
    const loaded = loadState(() => ({ posts: [] }));
    expect(loaded.posts).toEqual([{ id: "a" }]);
  });

  it("stamps the schema version on every write", () => {
    saveState({ posts: [], circles: [] });
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).version).toBe(SCHEMA_VERSION);
  });

  it("returns false instead of throwing when the browser refuses to store", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => saveState({ posts: [], circles: [] })).not.toThrow();
    expect(saveState({ posts: [], circles: [] })).toBe(false);
  });

  it("clears cleanly", () => {
    saveState({ posts: [], circles: [] });
    clearState();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("the store writes through as you act", () => {
  it("keeps a reaction after a reload", () => {
    const state = useApp.getState();
    state.react("p-tomato", "up");

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const post = stored.posts.find((entry) => entry.id === "p-tomato");
    expect(post.reactions.some((reaction) => reaction.userId === stored.viewerId)).toBe(true);
  });

  it("keeps queued offline work, so closing the tab does not lose it", () => {
    const state = useApp.getState();
    state.goOffline();
    state.react("p-kale", "down");

    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    expect(stored.queue).toHaveLength(1);
    expect(stored.preferences.offline).toBe(true);
  });

  it("resets to the written seed when asked", () => {
    const state = useApp.getState();
    state.react("p-tomato", "up");
    state.resetPrototype();

    const after = useApp.getState();
    expect(after.posts.find((post) => post.id === "p-tomato").reactions.some((r) => r.userId === after.viewerId)).toBe(false);
    expect(after.queue).toHaveLength(0);
  });
});
