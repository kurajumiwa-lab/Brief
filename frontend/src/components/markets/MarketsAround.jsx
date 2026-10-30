import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Store } from "lucide-react";
import MarketActivityCard from "@/components/markets/MarketActivityCard";
import { marketsAPI } from "@/lib/api";

/**
 * "MARKETS AROUND YOU" — the home shelf, loaded on its own.
 *
 * The old market shelf asked the reader to press **Scan**, then chose from a
 * radius menu that started at 150 km. This loads by itself, at a walking
 * radius, and only widens when the reader asks:
 *
 *   · no button, no menu — the shelf arrives with the page;
 *   · **25 km first**, because that is a matatu ride, not a region;
 *   · "Widen to 100 km" appears only when the first ring is thin, so the
 *     control exists exactly when it is useful;
 *   · an empty ring is a designed state, not a hole — it says how many markets
 *     are further out and offers the widening as the action.
 *
 * The rankings and the invitation sentences come from the server, so Home, the
 * Markets screen and the market's own page cannot disagree about which market
 * is busiest or how an empty one should be described.
 */

const RINGS = [25, 100, 300];

export default function MarketsAround({ limit = 3, className = "", showWiden = true }) {
  const [radius, setRadius] = useState(RINGS[0]);
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(
    async (r) => {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const res = await marketsAPI.around({ radius_km: r, limit: 6 });
        setState({ loading: false, error: null, data: res.data });
      } catch (err) {
        setState({ loading: false, error: err, data: null });
      }
    },
    []
  );

  useEffect(() => {
    load(radius);
  }, [load, radius]);

  const markets = state.data?.markets || [];
  const shown = markets.slice(0, limit);
  const wider = state.data?.wider || [];
  // `wider` mixes trading and quiet markets. The copy must not promise a shelf
  // that is not there — "12 further out are trading" when all 12 are empty is
  // exactly the kind of zero it is this card's job to stop telling.
  const widerActive = wider.filter((m) => !m.empty).length;
  const canWiden = showWiden && radius !== RINGS[RINGS.length - 1];

  // Nothing to say is a valid answer, and it must not leave a hole in the page.
  if (!state.loading && (!state.data || shown.length === 0)) {
    if (wider.length === 0) return null;
  }

  return (
    <section aria-labelledby="markets-around" data-testid="markets-around" className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <h2 id="markets-around" className="text-xs font-bold tracking-tight text-ink-1">
            Markets around you
          </h2>
          <p className="mt-0.5 text-micro text-ink-4">
            Trading communities within {radius} km, busiest first.
          </p>
        </div>
        <Link
          to="/markets"
          className="shrink-0 text-micro font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          See all
        </Link>
      </div>

      {state.loading && (
        <div className="space-y-2" aria-busy="true">
          {[0, 1].map((i) => (
            <div key={i} className="h-[76px] animate-pulse rounded-2xl bg-surface-2" />
          ))}
        </div>
      )}

      {!state.loading && state.error && (
        <p className="rounded-2xl border border-dashed border-edge-1 px-3 py-3 text-micro text-ink-4">
          The markets didn't load.{" "}
          <button
            type="button"
            onClick={() => load(radius)}
            className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-400"
          >
            Try again
          </button>
        </p>
      )}

      {!state.loading && !state.error && shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((market) => (
            <li key={market.id}>
              <MarketActivityCard market={market} compact />
            </li>
          ))}
        </ul>
      )}

      {!state.loading && !state.error && shown.length === 0 && (
        <div className="rounded-2xl border border-dashed border-edge-1 px-3 py-4 text-center">
          <Store size={16} className="mx-auto mb-1 text-ink-4" aria-hidden="true" />
          <p className="text-2xs text-ink-3">
            No market within {radius} km has a shelf yet.
            {widerActive > 0
              ? ` ${widerActive} further out ${widerActive === 1 ? "is" : "are"} trading.`
              : wider.length === 1
                ? " The nearest one is further out, still waiting for a first trader."
                : wider.length > 1
                  ? ` The nearest ${wider.length} are further out, all still waiting for a first trader.`
                  : ""}
          </p>
          {canWiden && wider.length > 0 && (
            <button
              type="button"
              onClick={() => setRadius(RINGS[RINGS.indexOf(radius) + 1])}
              className="mt-1.5 inline-flex items-center gap-1 text-micro font-bold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
            >
              Look up to {RINGS[RINGS.indexOf(radius) + 1]} km
              <ArrowRight size={10} aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {!state.loading && !state.error && shown.length > 0 && canWiden && (
        <button
          type="button"
          onClick={() => setRadius(RINGS[RINGS.indexOf(radius) + 1])}
          className="mt-1.5 inline-flex items-center gap-1 text-micro font-semibold text-ink-3 underline-offset-2 hover:text-ink-1 hover:underline"
        >
          Look further out ({RINGS[RINGS.indexOf(radius) + 1]} km)
          <ArrowRight size={10} aria-hidden="true" />
        </button>
      )}
    </section>
  );
}
