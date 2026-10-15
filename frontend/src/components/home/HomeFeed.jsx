import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, Compass, RefreshCw, Search, Store } from "lucide-react";
import CuratedShelf from "./CuratedShelf";
import ReferralBanner from "./ReferralBanner";
import DiscoveryShortcuts from "./DiscoveryShortcuts";
import CollapsedMyShop from "./CollapsedMyShop";
import ShelfEmptyState from "./ShelfEmptyState";
import { SHELVES_AFTER_BANNER, SHELVES_BEFORE_BANNER } from "@/config/homeShelves";
import { feedIsQuiet, useHomeFeedStore } from "@/stores/homeFeedStore";
import { needsMyAction, useStockStore } from "@/stores/stockStore";
import { useAuthStore } from "@/stores/authStore";
import { num } from "@/lib/formatters";

/**
 * HOME FEED — the marketplace, in shelves.
 *
 * The order is the product argument:
 *
 *   1. what six doors exist (compact shortcuts — links, not a taxonomy)
 *   2. four discovery shelves of real inventory from other vendors
 *   3. the invite banner, where a browsing vendor is most likely to act on it
 *   4. four more shelves widening the net: work, events, communities, markets
 *   5. anything waiting on the vendor, as ONE line — not a dashboard panel
 *   6. My Shop, folded shut, at the bottom
 *
 * Every shelf loads on its own clock and fails on its own; if the network has
 * nothing to show anywhere, the feed says so instead of padding itself with
 * products that do not exist.
 */
export default function HomeFeed({ onSource }) {
  const shelves = useHomeFeedStore((s) => s.shelves);
  const loadFeed = useHomeFeedStore((s) => s.loadFeed);
  const refreshFeed = useHomeFeedStore((s) => s.refreshFeed);
  const vendor = useAuthStore((s) => s.vendor);
  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);

  useEffect(() => {
    loadFeed();
    fetchMovements?.().catch(() => {});
  }, [loadFeed, fetchMovements]);

  const actionable = movements.filter(needsMyAction);
  const quiet = feedIsQuiet(shelves);

  return (
    <div className="space-y-8 sm:space-y-9">
      <DiscoveryShortcuts />

      {SHELVES_BEFORE_BANNER.map((shelf) => (
        <CuratedShelf key={shelf.key} shelf={shelf} state={shelves[shelf.key]} onSource={onSource} />
      ))}

      <ReferralBanner />

      {SHELVES_AFTER_BANNER.map((shelf) => (
        <CuratedShelf key={shelf.key} shelf={shelf} state={shelves[shelf.key]} onSource={onSource} />
      ))}

      {quiet && (
        <ShelfEmptyState
          icon={Search}
          title="The network is quiet right now"
          description="No other vendor has published stock, work or an event yet. Post what you need and it will reach them first."
          action={
            <span className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => refreshFeed()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge-2 bg-surface-0 px-3 text-xs font-semibold text-ink-1 transition-colors hover:bg-surface-2"
              >
                <RefreshCw size={13} aria-hidden="true" />
                Check again
              </button>
              <Link
                to="/browse"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-edge-2 bg-surface-0 px-3 text-xs font-semibold text-ink-1 transition-colors hover:bg-surface-2"
              >
                Post a request
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            </span>
          }
        />
      )}

      {actionable.length > 0 && (
        <Link
          to="/orders?needs=me"
          data-testid="home-needs-action"
          className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3 transition-colors hover:border-brand-500/50 hover:bg-surface-2"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300" aria-hidden="true">
            <ClipboardCheck size={17} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-xs font-semibold text-ink-1">
              {actionable.length === 1
                ? "1 trade needs your next step"
                : `${num(actionable.length)} trades need your next step`}
            </span>
            <span className="block text-micro text-ink-4">Confirm, ship or receive — the record is waiting in Work.</span>
          </span>
          <ArrowRight size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
        </Link>
      )}

      {vendor && (
        <div className="pt-1">
          <div className="mb-2.5 flex items-center gap-2">
            <Compass size={14} className="text-ink-4" aria-hidden="true" />
            <h2 className="text-2xs font-bold uppercase tracking-[0.14em] text-ink-4">Your business</h2>
          </div>
          <CollapsedMyShop />
        </div>
      )}

      <p className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-edge-1 pt-4 text-micro text-ink-4">
        <span className="inline-flex items-center gap-1.5">
          <Store size={12} className="text-brand-700 dark:text-brand-400" aria-hidden="true" />
          Your own shelf never appears in the shelves above.
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Compass size={12} className="text-brand-700 dark:text-brand-400" aria-hidden="true" />
          Prices and availability are stated by the vendor who published them.
        </span>
      </p>
    </div>
  );
}
