/**
 * LOCAL PERSISTENCE for the prototype.
 *
 * There is no server. Everything the user does — reactions, posts, joins,
 * reports, blocks, language, data saver, the offline queue — is written to
 * localStorage under one versioned key, so a reload behaves the way a real
 * account would.
 *
 * The version matters: a prototype's shape changes as it is built, and reading
 * an old payload into a new store is how a demo dies on stage. A version
 * mismatch discards the payload and reseeds, which is the correct trade here —
 * losing a prototype's reactions costs nothing, serving a half-migrated store
 * costs the demo.
 */

export const STORAGE_KEY = "caesar.prototype";
export const SCHEMA_VERSION = 1;

function safeStorage() {
  try {
    // Safari private mode throws on setItem; file:// and jsdom can throw on
    // access. The prototype must run either way, just without persistence.
    const probe = "__caesar_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadState(buildInitial) {
  const store = safeStorage();
  if (!store) return buildInitial();
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return buildInitial();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== SCHEMA_VERSION) return buildInitial();
    if (!Array.isArray(parsed.posts) || !Array.isArray(parsed.circles)) return buildInitial();
    return parsed;
  } catch {
    return buildInitial();
  }
}

export function saveState(state) {
  const store = safeStorage();
  if (!store) return false;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: SCHEMA_VERSION }));
    return true;
  } catch {
    // Quota or private mode: the session still works, it just will not survive
    // a reload. Never throw from a save.
    return false;
  }
}

export function clearState() {
  const store = safeStorage();
  if (!store) return;
  try {
    store.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to do */
  }
}

export default { STORAGE_KEY, SCHEMA_VERSION, loadState, saveState, clearState };
