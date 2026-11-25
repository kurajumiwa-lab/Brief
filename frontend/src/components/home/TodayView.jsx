import { Link } from "react-router-dom";
import {
  ArrowRight, ChevronRight, Inbox, MapPin, Sparkles,
} from "lucide-react";
import { RankMark } from "@/components/identity/Rank";
import ReceiptScanCard from "@/components/receipts/ReceiptScanCard";
import TownDoors from "@/components/home/TownDoors";
import StreetDoor from "@/components/home/StreetDoor";
import HappeningShelf from "@/components/home/HappeningShelf";
import NearbyShelf from "@/components/home/NearbyShelf";
import FeaturedDealsShelf from "@/components/home/FeaturedDealsShelf";
import IdentityStrip from "@/components/home/IdentityStrip";
import CounterShelf from "@/components/home/CounterShelf";
import DiscoveryBand from "@/components/home/DiscoveryBand";
import MapDiscovery from "@/components/home/MapDiscovery";
import CommunityShelf from "@/components/home/CommunityShelf";
import HomeHero from "@/components/home/HomeHero";
import PromoBanner from "@/components/home/PromoBanner";

/**
 * HOME — discovery first, ownership second.
 *
 * The redesign asked for a Home that answers "what can I do here?" in the
 * first two seconds, and for the marketplace to feel like ONE product rather
 * than a dozen competing features. That is a change of ORDER, not of
 * inventory: everything that was here is still here, but the page now opens on
 * what a person came for.
 *
 *   1. WHERE AM I, AND WHAT DO I WANT?   → the hero (location + search)
 *   2. WHAT KIND OF THING IS IT?         → four category doors
 *   3. WHERE IS IT?                      → the map door
 *   4. WHAT CAN I BUY OR JOIN?           → nearby trade, live deals, dated rounds
 *   5. WHAT IS THE NEIGHBOURHOOD SAYING? → community activity
 *   6. WHAT IS MINE?                     → identity, next step, the counter,
 *                                           receipts
 *   7. AND THE SECONDARY THINGS          → rewards, referrals, the plate
 *
 * Rewards and referral doors sit LAST on purpose. They are real and they are
 * worth money, but a marketplace that leads with points is a points app that
 * happens to sell things. The same rule applies to the business's own books:
 * they are still on Home, one screen further down than they used to be.
 *
 * The full region feed lives in Explore. Home carries only what can be acted
 * on — a search, four doors, the map, and dated rounds — because "what is
 * listed?" is browsing and "what can I join today?" is an action.
 */

export default function TodayView({
  name = "there",
  firstName,
  rank,
  region,
  happening = [],
  nearby = [],
  deals = [],
  community = [],
  page = {},
  institution = null,
  unread = 0,
  now = new Date(),
}) {
  const place = region?.name || region?.hub || null;

  return (
    <div className="ds-stack mx-auto w-full max-w-2xl">
      {/* ── 1. Where you are, and what you are looking for ──────────────── */}
      <HomeHero
        name={name}
        firstName={firstName}
        rank={rank}
        place={place}
        placeTo="/regions"
        now={now}
      />

      {/* ── 2. Four ways in ──────────────────────────────────────────────── */}
      <DiscoveryBand />

      {/* ── 3. The map, as a door ────────────────────────────────────────── */}
      <MapDiscovery items={nearby} place={place} />

      {/* ── 4. What can be bought or joined ─────────────────────────────── */}
      <NearbyShelf items={nearby} region={region} />

      <FeaturedDealsShelf deals={deals} />

      <HappeningShelf items={happening} region={region} />

      {/* ── 5. The neighbourhood talking ─────────────────────────────────── */}
      <CommunityShelf items={community} />

      {/* ── 6. What is mine ──────────────────────────────────────────────── */}
      {/* Identity sits under discovery: one box, one share action, and the
          office the person belongs to. */}
      <IdentityStrip name={name} page={page} institution={institution} />

      {/* The one thing to do next */}
      {rank && rank.level < 5 ? (
        <section
          // The card is a *filled* surface: solid brand-600, not a gradient and
          // not a near-black. White on it measures 5.00:1 light and 4.69:1
          // dark, and the white/75–85 supporting text still clears 4.5:1 on
          // both — measured in src/test/contrast.test.js, not guessed.
          className="relative overflow-hidden rounded-2xl bg-brand-600 p-5 text-white shadow-sm sm:p-6"
          aria-labelledby="next-step"
        >
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-white/75">
                Next step · level {rank.level} of 5
              </p>
              <RankMark level={rank.level} className="[&>span]:bg-white/80" />
            </div>
            <h2 id="next-step" className="mt-2 text-lg font-extrabold leading-snug tracking-tight sm:text-xl">
              {rank.nextAction ? rank.nextAction.label : `Reach ${rank.next.label}`}
            </h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-white/85">
              {rank.nextAction
                ? rank.nextAction.detail
                : rank.next.blurb}
            </p>
            {rank.nextAction && (
              <Link
                to={rank.nextAction.to}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-brand-800 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-white/70 dark:text-brand-900"
              >
                {rank.nextAction.label}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-500/30 dark:bg-brand-500/10">
          <p className="flex items-center gap-2 text-sm font-extrabold text-brand-800 dark:text-brand-300">
            <Sparkles size={16} aria-hidden="true" />
            Confirmed by a third party
          </p>
          <p className="mt-1 text-xs leading-relaxed text-brand-800/80 dark:text-brand-200">
            Your institution or licence is on record. Keep the record current —
            an expired check returns you to the rung below.
          </p>
        </section>
      )}

      {/* Your own books. Settings & records used to be a small text link at
          the foot of another screen. */}
      <CounterShelf />

      {/* Receipts live in the feed, not behind a settings door: the value of a
          receipt is highest while the person is still in the shop. */}
      <ReceiptScanCard />

      {/* ── 7. The secondary things ──────────────────────────────────────── */}
      {/* One promotional plate, and it is deliberately last: it is the only
          saturated block on the page, which is what makes it read as an offer
          rather than as wallpaper. */}
      <PromoBanner plate="city" />

      <TownDoors />

      <StreetDoor />

      {unread > 0 && (
        <Link
          to="/inbox"
          className="soft-card flex items-center gap-3 rounded-2xl bg-surface-1 px-4 py-3 hover:bg-surface-2"
        >
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <Inbox size={16} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1 text-xs font-semibold text-ink-1">
            {unread} {unread === 1 ? "thing is" : "things are"} waiting in your inbox
          </span>
          <ChevronRight size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
        </Link>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-micro text-ink-4">
        <MapPin size={11} aria-hidden="true" />
        Order is by proximity and record. Nothing here is paid placement.
      </p>
    </div>
  );
}
