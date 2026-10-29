import { useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ClipboardCheck, Compass, RefreshCw, Search, Store } from "lucide-react";
import CuratedShelf from "./CuratedShelf";
import ReferralBanner from "./ReferralBanner";
import DiscoveryShortcuts from "./DiscoveryShortcuts";
import LocationPrompt from "./LocationPrompt";
import LocationBar from "@/components/outside/LocationBar";
import CollapsedMyShop from "./CollapsedMyShop";
import BusinessPulseSimplified from "./BusinessPulseSimplified";
import BusinessBillboard from "./BusinessBillboard";
import { SHELVES_AFTER_BANNER, SHELVES_BEFORE_BANNER } from "@/config/homeShelves";
import { feedIsQuiet, useHomeFeedStore } from "@/stores/homeFeedStore";
import { needsMyAction, useStockStore } from "@/stores/stockStore";
import { useAuthStore } from "@/stores/authStore";
import { num } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * HOME FEED — the marketplace, in shelves (v3.3).
 *
 * v3.3 re-cut the order around one hierarchy: **trade first, your business
 * second, the rest of the network after that.** The shelves are unchanged in
 * where they come from; where they sit and how heavy they look changed.
 *
 *   1. the six doors (compact shortcuts — links, not a taxonomy)
 *   2. four discovery shelves of real inventory from other vendors
 *   3. anything waiting on the vendor — ONE quiet line, not a dashboard panel
 *   4. the business band: the simplified pulse row and My Shop, folded shut
 *   5. the invite banner, where a browsing vendor is most likely to act on it
 *   6. four more shelves widening the net: work, events, communities, markets
 *   7. the two trust claims, in one small footer
 *
 * Every shelf still loads on its own clock and fails on its own. When the whole
 * network is empty the feed says so once, in a designed panel that offers the
 * three things that genuinely help — look again, post a request, browse the
 * standing catalogue — instead of padding itself with products that do not
 * exist.
 *
 * What changed in v3.3:
 *   - Business Pulse simplified to focus on growth only
 *   - Duplicate metrics removed (now on dedicated screens)
 *   - Single source of truth principle enforced
 */
export default function HomeFeed({ onSource, className }) {
  const shelves = useHomeFeedStore((s) => s.shelves);
  const loadFeed = useHomeFeedStore((s) => s.loadFeed);
  const refreshFeed = useHomeFeedStore((s) => s.refreshFeed);
  const resetFeed = useHomeFeedStore((s) => s.reset);
  const vendor = useAuthStore((s) => s.vendor);
  const movements = useStockStore((s) => s.movements);
  const fetchMovements = useStockStore((s) => s.fetchMovements);
  const vendorId = vendor?.id ?? null;
  const loadedFor = useRef(vendorId);

  useEffect(() => {
    // A shelf answers for a *vendor*, and this store outlives the session. If
    // the person at this browser changes, the old shelves are another
    // merchant's records — and `ready` shelves are not re-fetched for five
    // minutes, so they would simply stay. Drop them and load again.
    if (loadedFor.current !== vendorId) {
      loadedFor.current = vendorId;
      resetFeed();
    }
    loadFeed();
    fetchMovements?.().catch(() => {});

    // A phone that drops signal and comes back should heal the feed by itself.
    const onOnline = () => useHomeFeedStore.getState().retryFailedShelves?.();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadFeed, fetchMovements, resetFeed, vendorId]);

  const actionable = movements.filter(needsMyAction);
  const quiet = feedIsQuiet(shelves);

  return (
    <div className={cn("space-y-6 sm:space-y-7", className)}>
      <LocationPrompt />
      <LocationBar />
      <DiscoveryShortcuts />

      {SHELVES_BEFORE_BANNER.map((shelf) => (
        <CuratedShelf key={shelf.key} shelf={shelf} state={shelves[shelf.key]} onSource={onSource} />
      ))}

      {actionable.length > 0 && (
        <Link
          to="/orders?needs=me"
          data-testid="home-needs-action"
          className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-0 px-4 py-3 shadow-xs transition-colors hover:border-brand-500/50 hover:bg-surface-1"
        >
          <span
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-500/10 dark:text-accent-300"
            aria-hidden="true"
          >
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

      {quiet && <QuietNetworkPanel onRefresh={refreshFeed} />}

      {/* ── your business: a billboard, then the shelf behind it ─────────── */}
      {vendor && (
        <div className="space-y-2.5">
          <BusinessBillboard vendor={vendor} headingId="home-your-business" />
          <BusinessPulseSimplified headingId="home-your-business-pulse" />
          <CollapsedMyShop />
        </div>
      )}

      <ReferralBanner />

      {SHELVES_AFTER_BANNER.map((shelf) => (
        <CuratedShelf key={shelf.key} shelf={shelf} state={shelves[shelf.key]} onSource={onSource} />
      ))}

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

/**
 * THE NETWORK HAS NOTHING TO SHOW YET — said properly.
 *
 * A designed empty state, not an apology: what is actually true (nobody has
 * published anything yet), what it means (you are early, not broken), and the
 * three doors that help — look again, ask the network for what you need, or
 * read the standing catalogue while the shelves fill up. The two-word buttons
 * the old version used are gone; each door says what it does.
 */
function QuietNetworkPanel({ onRefresh }) {
  const doors = [
    {
      to: "/browse?request=1",
      icon: ClipboardCheck,
      title: "Post a request",
      body: "Say what you need and the vendors who match it see it first.",
    },
    {
      to: "/storefront",
      icon: Store,
      title: "Browse the catalogue",
      body: "Services and tools that are already on offer in the network.",
    },
    {
      to: "/network",
      icon: Compass,
      title: "Find businesses",
      body: "The vendors already registered around you, with what they trade.",
    },
  ];

  return (
    <section
      aria-labelledby="network-quiet-title"
      data-testid="home-network-quiet"
      className="rounded-3xl border border-edge-1 bg-surface-0 p-4 shadow-xs sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-micro font-bold uppercase tracking-[0.14em] text-ink-4">
            <Search size={12} aria-hidden="true" /> The network is quiet right now
          </p>
          <h2 id="network-quiet-title" className="mt-1.5 text-base font-bold tracking-tight text-ink-1 sm:text-lg">
            Nothing has been published yet today
          </h2>
          <p className="mt-1.5 max-w-lg text-2xs leading-relaxed text-ink-3">
            No vendor has put stock, work or an event in front of the network yet. Being early is fine — what you
            ask for now is what the next vendor answers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onRefresh()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl border border-edge-2 bg-surface-1 px-3 text-xs font-semibold text-ink-1 transition-colors hover:bg-surface-2 sm:h-9"
        >
          <RefreshCw size={13} aria-hidden="true" />
          Check again
        </button>
      </div>

      <ul className="mt-4 grid gap-2 sm:grid-cols-3">
        {doors.map(({ to, icon: Icon, title, body }) => (
          <li key={to}>
            <Link
              to={to}
              className="flex h-full items-start gap-2.5 rounded-2xl border border-edge-1 bg-surface-1 px-3 py-2.5 transition-colors hover:border-brand-500/50 hover:bg-brand-50 dark:hover:bg-brand-500/10"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300" aria-hidden="true">
                <Icon size={15} />
              </span>
              <span className="min-w-0">
                <span className="block text-xs font-bold text-ink-1">{title}</span>
                <span className="mt-0.5 block text-micro leading-snug text-ink-4">{body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
