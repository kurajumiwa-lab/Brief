import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Offline support, kept small and honest (v2.15).
 *
 * The requirement is narrow: on a Kenyan mobile connection a vendor must be able
 * to *open* the brief or their receipts and see the last thing they saw, with a
 * label saying exactly how old it is. Nothing here pretends to be a sync engine.
 *
 * Three rules that matter:
 *
 *   1. The cache is per account. A shared phone is normal here, so a cached
 *      brief from another session is deleted rather than shown to the next user.
 *   2. Cached data is never labelled current. Every cached read carries the time
 *      it was written, and callers must show it.
 *   3. The cache is a convenience, never a source of truth. It is read only when
 *      the network is unavailable or slow; a successful fetch always wins.
 */

const PREFIX = "brief.cache.v1";

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null; // private mode, or a policy block — degrade, don't crash
  }
};

export function cacheKey(name, accountId) {
  return `${PREFIX}:${accountId || "anon"}:${name}`;
}

export function readCache(name, accountId) {
  const store = storage();
  if (!store) return null;
  try {
    dropOtherAccounts(accountId);
    const raw = store.getItem(cacheKey(name, accountId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || !parsed.savedAt) return null;
    return parsed; // { savedAt: ISO string, accountId, data }
  } catch {
    return null;
  }
}

export function writeCache(name, accountId, data) {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(cacheKey(name, accountId), JSON.stringify({
      savedAt: new Date().toISOString(),
      accountId: accountId || null,
      data,
    }));
  } catch {
    // Quota or serialisation failure: the live response still rendered.
  }
}

/** Remove cached documents that belong to a different account on this device. */
export function dropOtherAccounts(accountId) {
  const store = storage();
  if (!store) return;
  try {
    const keep = `${PREFIX}:${accountId || "anon"}:`;
    const stale = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (key && key.startsWith(`${PREFIX}:`) && !key.startsWith(keep)) stale.push(key);
    }
    stale.forEach((key) => store.removeItem(key));
  } catch {
    // ignore
  }
}

export function clearCache(accountId) {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(cacheKey("brief", accountId));
    store.removeItem(cacheKey("receipts", accountId));
  } catch {
    // ignore
  }
}

/** Live connectivity, following the pattern already used by the home shelves. */
export function useOnlineStatus() {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine
  );

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  return online;
}

/**
 * One cached document: paint from cache, refresh from the network, keep the
 * older copy if the refresh fails.
 *
 * Returns:
 *   data      — newest data available (live or cached)
 *   savedAt   — when the cached copy was written (null for live data)
 *   fromCache — true while `data` has not been confirmed by the network
 *   online    — navigator.onLine
 *   error     — message from the last failed fetch
 *   loading / reload
 */
export function useCachedResource({ name, accountId, fetcher, errorFallback }) {
  const online = useOnlineStatus();
  const [data, setData] = useState(null);
  const [savedAt, setSavedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);
  // The fallback is often an inline arrow; holding it in a ref keeps it out of
  // the callback deps, otherwise every render produces a new `load`, which
  // re-runs the effect, which renders again — an effect loop, not a fetch loop.
  const fallbackRef = useRef(errorFallback);
  fallbackRef.current = errorFallback;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Paint the last known copy before the request even leaves the device.
  useEffect(() => {
    const cached = readCache(name, accountId);
    if (!cached) return;
    setData((current) => current ?? cached.data);
    setSavedAt((current) => current ?? cached.savedAt);
    setFromCache((current) => (current === null ? true : current));
  }, [name, accountId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetcher();
      if (!mounted.current) return;
      setData(next);
      setSavedAt(null);
      setFromCache(false);
      setError(null);
      writeCache(name, accountId, next);
    } catch (err) {
      if (!mounted.current) return;
      // Keep whatever is on screen; say why it is not advancing.
      const fallback = fallbackRef.current;
      setError(typeof fallback === "function" ? fallback(err) : fallback);
      setFromCache(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [fetcher, name, accountId]);

  useEffect(() => {
    if (online) load();
    else setLoading(false); // nothing to wait for; the cached copy is the answer
  }, [online, load]);

  return { data, savedAt, fromCache, online, error, loading, reload: load };
}
