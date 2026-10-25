import { buildSeed } from "@/data/seed.js";
import { useApp } from "@/store/appStore.js";

/**
 * Every spec starts from the same network, built just now, so a post is
 * "2 h ago" in a test exactly as it is in the app.
 */
export function resetStore(overrides = {}) {
  const seed = buildSeed();
  useApp.setState({ ...seed, toasts: [], ...overrides });
  return useApp.getState();
}

export function posts() {
  return useApp.getState().posts;
}

export function postBy(id) {
  return posts().find((post) => post.id === id);
}
