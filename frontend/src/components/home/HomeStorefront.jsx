import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, BadgeCheck, Compass, Sparkles } from "lucide-react";
import CuratedShelf from "./CuratedShelf";
import { SHELVES } from "@/config/homeShelves";
import { feedIsQuiet, useHomeFeedStore } from "@/stores/homeFeedStore";
import { useAuthStore } from "@/stores/authStore";
import { cn } from "@/lib/utils";

/**
 * HOME STOREFRONT — a premium wrapper around the existing home shelves.
 *
 * It adds the familiar store rhythm to Home and nothing else:
 *
 *   1. a row of category chips (each one a real door into a real screen)
 *   2. a swipeable hero row (real records from the shelves, plus one card that
 *      always exists: checked shops)
 *   3. the existing shelves, unchanged, each hiding itself when it has no record
 *
 * The rule from `homeShelves.js` still holds: nothing here invents inventory,
 * prices, ratings or ads. A hero card is only ever a real offer or stock item
 * that the shelf already showed, or the Brief trust door. When the whole network
 * is quiet, the page still has the chips and the trust door, so a new user never
 * lands on an empty screen.
 */

const CHIPS = [
  { label: "Checked shops", to: "/trust", tone: "brand" },
  { label: "Offers", to: "/offers" },
  { label: "Templates", to: "/templates" },
  { label: "Learn", to: "/learn" },
  { label: "Search", to: "/search" },
];

const HERO_LIMIT = 4;

function heroFromShelves(shelves) {
  const picks = [];
  for (const shelf of SHELVES) {
    const state = shelves[shelf.key] || {};
    if (state.status !== "ready") continue;
    for (const item of state.items || []) {
      if (picks.length >= HERO_LIMIT - 1) return picks;
      if (!item?.to || !item?.title) continue;
      picks.push({ ...item, shelfTitle: shelf.title });
    }
  }
  return picks;
}

export default function HomeStorefront({ className }) {
  const shelves = useHomeFeedStore((s) => s.shelves);
  const loadFeed = useHomeFeedStore((s) => s.loadFeed);
  const resetFeed = useHomeFeedStore((s) => s.reset);
  const vendorId = useAuthStore((s) => s.vendor?.id ?? null);
  const loadedFor = useRef(vendorId);

  useEffect(() => {
    // The store outlives the session, so a different person at this browser
    // must not inherit the previous merchant's shelves.
    if (loadedFor.current !== vendorId) {
      loadedFor.current = vendorId;
      resetFeed();
    }
    loadFeed();
  }, [loadFeed, resetFeed, vendorId]);

  const hero = useMemo(() => heroFromShelves(shelves), [shelves]);
  const quiet = feedIsQuiet(shelves);

  return (
    <div className={cn("space-y-6 sm:space-y-7", className)} data-testid="home-storefront">
      {/* 1 · category chips — real doors, horizontally scrollable */}
      <nav aria-label="Browse Brief" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <ul className="flex gap-2 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {CHIPS.map((chip) => (
            <li key={chip.to}>
              <Link
                to={chip.to}
                className={cn(
                  "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-sm font-medium transition-colors",
                  chip.tone === "brand"
                    ? "border-brand-200 bg-brand-50 text-brand-800 hover:bg-brand-100 dark:border-brand-800 dark:bg-brand-950/40 dark:text-brand-200"
                    : "border-ink-200 bg-white text-ink-800 hover:bg-ink-50 dark:border-ink-700 dark:bg-ink-900 dark:text-ink-100",
                )}
              >
                {chip.tone === "brand" ? <BadgeCheck className="h-4 w-4" aria-hidden="true" /> : null}
                {chip.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {/* 2 · hero row — swipe between real features */}
      <section aria-label="Featured" data-testid="home-hero">
        <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <Link
            to="/trust"
            data-testid="hero-trust"
            className="group relative flex min-h-[176px] w-[86%] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-3xl bg-gradient-to-br from-brand-600 via-brand-700 to-ink-900 p-5 text-white shadow-lg shadow-brand-900/20 sm:w-[420px]"
          >
            <span className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 text-xs font-semibold">
              <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> Brief Trust
            </span>
            <span>
              <span className="block text-xl font-semibold leading-tight">Shops you can check before you buy</span>
              <span className="mt-1 block text-sm text-white/80">
                Approved by Brief staff in Kenya, Ethiopia and Uganda. Reviews come from real till codes.
              </span>
            </span>
            <span className="mt-4 inline-flex items-center gap-1 text-sm font-semibold">
              Open Brief Trust <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </span>
          </Link>

          {hero.map((item) => (
            <Link
              key={`hero-${item.id}`}
              to={item.to}
              data-testid="hero-item"
              className="group relative flex min-h-[176px] w-[86%] shrink-0 snap-start flex-col justify-end overflow-hidden rounded-3xl bg-ink-900 text-white shadow-lg sm:w-[420px]"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt=""
                  loading="lazy"
                  className="absolute inset-0 h-full w-full object-cover opacity-80 transition-transform duration-500 group-hover:scale-105"
                />
              ) : (
                <span className="absolute inset-0 bg-gradient-to-br from-ink-700 to-brand-800" aria-hidden="true" />
              )}
              <span className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" aria-hidden="true" />
              <span className="relative p-5">
                <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-white/75">
                  {item.shelfTitle}
                </span>
                <span className="block line-clamp-2 text-lg font-semibold leading-snug">{item.title}</span>
                {item.vendorName ? <span className="mt-1 block text-sm text-white/80">{item.vendorName}</span> : null}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* 3 · the existing shelves, each hiding itself when empty */}
      {SHELVES.map((shelf) => (
        <CuratedShelf key={shelf.key} shelf={shelf} state={shelves[shelf.key]} />
      ))}

      {quiet ? (
        <section
          className="rounded-3xl border border-ink-200 bg-white p-5 text-center dark:border-ink-700 dark:bg-ink-900"
          data-testid="home-quiet"
        >
          <Sparkles className="mx-auto h-6 w-6 text-brand-600" aria-hidden="true" />
          <h2 className="mt-2 text-base font-semibold text-ink-900 dark:text-ink-50">The network is quiet right now</h2>
          <p className="mt-1 text-sm text-ink-600 dark:text-ink-300">
            New offers and stock appear here as businesses list them. You can already check shops.
          </p>
          <Link
            to="/trust"
            className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
          >
            <Compass className="h-4 w-4" aria-hidden="true" /> Browse checked shops
          </Link>
        </section>
      ) : null}
    </div>
  );
}
