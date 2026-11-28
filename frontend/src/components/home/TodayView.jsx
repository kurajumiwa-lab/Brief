import { useCallback, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, MapPin, Sparkles } from "lucide-react";
import { RankMark } from "@/components/identity/Rank";
import ReceiptScanCard from "@/components/receipts/ReceiptScanCard";
import TownDoors from "@/components/home/TownDoors";
import StreetDoor from "@/components/home/StreetDoor";
import HappeningShelf from "@/components/home/HappeningShelf";
import WeekBand from "@/components/home/WeekBand";
import NearbyShelf from "@/components/home/NearbyShelf";
import FeaturedDealsShelf from "@/components/home/FeaturedDealsShelf";
import IdentityStrip from "@/components/home/IdentityStrip";
import CounterShelf from "@/components/home/CounterShelf";
import DiscoveryBand from "@/components/home/DiscoveryBand";
import CommunityShelf from "@/components/home/CommunityShelf";
import HomeHero from "@/components/home/HomeHero";
import MarketBriefing from "@/components/home/MarketBriefing";

/**
 * HOME — the marketplace first, the person's own records second.
 *
 * The brief is explicit about the order, and this file follows it exactly:
 *
 *   1. greeting and notifications   → the hero
 *   2. compact location             → the hero
 *   3. primary search               → the hero
 *   4. browse categories            → the image-led grid
 *   5. nearby listings              → the standard card grid
 *   6. recommendations              → real deals, expiring soonest first
 *   7. relevant activity            → dated rounds and what the neighbourhood
 *                                    is saying
 *
 * and then, below all of that, the person's OWN records: their page, the one
 * thing to do next, their trade record and their receipts.
 *
 * What is gone, and why it had to go:
 *
 *   · THE PROMO BANNER. A saturated plate of marketing copy sitting between
 *     the listings and the person. It was the loudest thing on a page whose
 *     job is to show what is for sale.
 *   · THE MAP DOOR. Explore already has the map, and it has it next to the
 *     results it maps. A second map entrance on Home was one more way to
 *     leave the page.
 *   · THE ASSUMED PLACE. The hero used to print a town it had inferred. It
 *     does that no more: the location control says what the app knows, and
 *     "Location unavailable" when it does not know.
 *
 * The ownership block stays, because a marketplace still has to be where a
 * business keeps its own books. It is simply no longer in the way.
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
  attention,
  unread = 0,
  now = new Date(),
  // The week band. These arrived from the Inbox, which is now only Chats and
  // Notifications; the props are passed straight through so this stays a view.
  agenda = [],
  agendaLoading = false,
  agendaError = "",
  onRetryAgenda,
  onOpenPass,
  onConfirmTrade,
  confirmingId,
  taskDays = [],
  taskData = null,
  onTasksChanged,
  defaultRegion,
  town,
  sharePrompts = [],
  onShared,
}) {
  const [term, setTerm] = useState("");

  // Typing on Home narrows what is already on the screen. It does not invent
  // anything and it does not reach for a second feed: the records that are
  // loaded are the records that can match.
  const needle = term.trim().toLowerCase();
  const matches = useCallback(
    (item) =>
      !needle
      || `${item.title || ""} ${item.summary || ""} ${item.category || ""} ${item.location || ""}`
        .toLowerCase()
        .includes(needle),
    [needle],
  );

  const nearbyMatches = useMemo(() => nearby.filter(matches), [nearby, matches]);
  const happeningMatches = useMemo(() => happening.filter(matches), [happening, matches]);
  const communityMatches = useMemo(() => community.filter(matches), [community, matches]);
  const dealMatches = useMemo(
    () => deals.filter((deal) => matches({
      title: deal.title || deal.name,
      summary: deal.summary || deal.description,
      location: deal.location,
    })),
    [deals, matches],
  );

  return (
    <div className="ds-stack mx-auto w-full max-w-2xl">
      {/* ── 1–3 · greeting, notifications, location, search ──────────────── */}
      <HomeHero
        name={name}
        firstName={firstName}
        attention={attention || { chats: 0, notifications: unread, waiting: 0 }}
        unread={unread}
        term={term}
        onTermChange={setTerm}
        now={now}
      />

      <MarketBriefing />

      {/* ── 4 · the five categories, as doors ────────────────────────────── */}
      <DiscoveryBand />

      {/* ── what is on this week ──────────────────────────────────────────
          Rounds and RSVPs, work and routines. These moved here from the Inbox
          so that screen could be messages and nothing else. Placed after the
          doors and before the shelves: a thing with a date outranks a thing
          you might like. */}
      <WeekBand
        agenda={agenda}
        agendaLoading={agendaLoading}
        agendaError={agendaError}
        onRetryAgenda={onRetryAgenda}
        onOpenPass={onOpenPass}
        onConfirmTrade={onConfirmTrade}
        confirmingId={confirmingId}
        taskDays={taskDays}
        taskData={taskData}
        onTasksChanged={onTasksChanged}
        defaultRegion={defaultRegion}
        town={town}
        sharePrompts={sharePrompts}
        onShared={onShared}
      />

      {/* ── 5 · what is within reach ─────────────────────────────────────── */}
      <NearbyShelf items={nearbyMatches} region={region} />

      {/* ── 6 · recommendations: real deals, expiring soonest first ──────── */}
      <FeaturedDealsShelf deals={dealMatches} />

      {/* ── 7 · what is happening, and what the neighbourhood is saying ──── */}
      <HappeningShelf items={happeningMatches} region={region} />

      <CommunityShelf items={communityMatches} />

      {/* ── and then, the person's own records ───────────────────────────── */}
      {/* Identity sits under discovery: one box, one share action, and the
          office the person belongs to. */}
      <IdentityStrip name={name} page={page} institution={institution} />

      {/* The one thing to do next */}
      {rank && rank.level < 5 ? (
        <section
          // The card is a *filled* surface: solid brand-600, not a gradient and
          // not a near-black. White on it measures 12.37:1 light and 4.69:1
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

      {/* Feature doors stay available, but no longer compete with attention
          and live opportunities. One disclosure replaces two more cards; the
          destinations and the no-paid-placement promise are unchanged. */}
      <details
        data-testid="home-tools"
        className="group rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-xs font-bold text-ink-1 marker:hidden">
          More business tools
          <span aria-hidden="true" className="text-micro font-semibold text-ink-4 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="mt-3 space-y-3 border-t border-edge-1 pt-3">
          <TownDoors />
          <StreetDoor />
          <p className="flex items-center justify-center gap-1.5 text-center text-micro text-ink-4">
            <MapPin size={11} aria-hidden="true" />
            Order is by proximity and record. Nothing here is paid placement.
          </p>
        </div>
      </details>
    </div>
  );
}
