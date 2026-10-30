import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MapPin } from "lucide-react";
import { marketsAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * MARKETS, AS A STRIP — not a card.
 *
 * Explore already knows where you are; this tells you which physical market is
 * trading around you and how busy it actually is, in two lines and roughly
 * 90 px. A full market card here would push the results it is supposed to
 * introduce below the fold, which is the opposite of the point.
 *
 * The numbers are the market shelf's own (active traders, listings, an
 * invitation when there is nothing yet) — a market with no registered vendors
 * says so and invites instead of showing a zero.
 */
export default function MarketStrip({ limit = 2, className }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    // `around` is optional decoration on this screen. If the client is mocked
    // or the call is unavailable, the strip disappears — the feed must not.
    if (!marketsAPI?.around) return undefined;
    let live = true;
    marketsAPI
      .around({ limit })
      .then((res) => { if (live) setData(res.data); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, [limit]);

  const markets = data?.markets || [];
  if (!markets.length) return null;

  return (
    <section aria-label="Markets around you" data-testid="market-strip" className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <h2 className="text-micro font-bold uppercase tracking-[0.12em] text-ink-4">
          Markets around you
        </h2>
        <Link
          to="/markets"
          className="text-micro font-semibold text-brand-700 underline-offset-2 hover:underline dark:text-brand-400"
        >
          See all
        </Link>
      </div>

      <ul className="divide-y divide-edge-1 overflow-hidden rounded-xl border border-edge-1 bg-surface-1">
        {markets.map((market) => (
          <li key={market.id}>
            <Link
              to={`/markets/${market.id}`}
              data-testid="market-strip-row"
              className={cn(
                "flex items-center gap-2 px-3 py-2 transition-colors hover:bg-surface-2",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/60",
              )}
            >
              <MapPin size={13} className="shrink-0 text-brand-600 dark:text-brand-300" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-2xs font-semibold text-ink-1">{market.name}</span>
                <span className="block truncate text-micro text-ink-4">
                  {[market.city, market.distance_km != null ? `${Math.round(market.distance_km)} km` : null]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
              <span className="shrink-0 text-right text-micro">
                {market.empty ? (
                  <span className="font-semibold text-brand-700 dark:text-brand-300">Be the first</span>
                ) : (
                  <>
                    <span className="block font-semibold tabular-nums text-ink-1">
                      {market.active_vendors} trading
                    </span>
                    <span className="block tabular-nums text-ink-4">{market.listings} listings</span>
                  </>
                )}
              </span>
              <ChevronRight size={13} className="shrink-0 text-ink-4" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
