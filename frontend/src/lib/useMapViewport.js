import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { mapAPI, apiError } from "@/lib/api";
import { lastKnownView, rememberView } from "@/lib/mapViewport";

// ─────────────────────────────────────────────────────────────────────────────
// useMapViewport — one screenful at a time.
//
// Three things a mobile map must do that a naive `useEffect(fetch)` does not:
//
//   1. DEBOUNCE. A pan fires `moveend` once, but a flung map can fire several
//      in a second. Only the last one is worth a request.
//   2. CANCEL. When the viewport changes, the in-flight response is already
//      stale — abort it instead of letting it land and re-render the map with
//      pins from the previous neighbourhood.
//   3. GUARD. Even aborted, a response can win a race. A request id decides
//      which one is allowed to write to state.
//
// Plus an offline path: if the network is gone, the hook falls back to the last
// screenful it loaded (our own data, cached in localStorage) rather than
// blanking the map. Map tiles are never cached — see mapViewport.js.
// ─────────────────────────────────────────────────────────────────────────────

const defaultFetcher = (params, opts) => mapAPI.viewport(params, opts);

export default function useMapViewport({
  bbox,
  zoom,
  kind = "all",
  q = "",
  filter = "",
  category = "",
  scope = "viewport",
  external = "hide",
  limit,
  debounceMs = 250,
  enabled = true,
  fetcher = defaultFetcher,
} = {}) {
  const [state, setState] = useState({ data: null, loading: false, error: "", offline: false });
  const [nonce, setNonce] = useState(0);
  const latest = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;
    if (scope !== "network" && !bbox) return undefined;
    // A network-wide request with no real search term is the original bug —
    // it would ask for every place in the directory. Refuse it here as well as
    // in the API, because a client that can ask for it will eventually ask.
    if (scope === "network" && q.trim().length < 2) return undefined;

    const id = ++latest.current;
    const controller = new AbortController();
    let timer = null;

    setState((s) => ({ ...s, loading: true }));

    const run = async () => {
      try {
        const res = await fetcher(
          { bbox: scope === "network" ? undefined : bbox, zoom, kind, q: q || undefined,
            filter: filter || undefined, category: category || undefined, scope,
            external: scope === "network" ? undefined : external, limit },
          { signal: controller.signal },
        );
        if (id !== latest.current) return;                 // a newer view won
        if (res?.status === 304) {                          // browser revalidated
          setState((s) => ({ ...s, loading: false, error: "", offline: false }));
          return;
        }
        rememberView(res.data);
        setState({ data: res.data, loading: false, error: "", offline: false });
      } catch (err) {
        if (axios.isCancel(err) || controller.signal.aborted || id !== latest.current) return;
        const cached = lastKnownView();
        setState({
          data: cached,
          loading: false,
          error: apiError(err, "This area could not be loaded"),
          offline: Boolean(cached),
        });
      }
    };

    // The first paint should not wait: a map with no pins at all looks broken.
    const wait = latest.current === 1 ? 0 : debounceMs;
    timer = setTimeout(run, wait);
    return () => {
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  }, [bbox, zoom, kind, q, filter, category, scope, external, limit, debounceMs, enabled, fetcher, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { ...state, refresh };
}
