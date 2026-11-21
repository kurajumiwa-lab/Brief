import { Link } from "react-router-dom";
import {
  ArrowRight, ChevronRight, Inbox, MapPin, Sparkles,
} from "lucide-react";
import { RankChip, RankMark } from "@/components/identity/Rank";
import ReceiptScanCard from "@/components/receipts/ReceiptScanCard";
import TownDoors from "@/components/home/TownDoors";
import StreetDoor from "@/components/home/StreetDoor";
import HappeningShelf from "@/components/home/HappeningShelf";
import IdentityStrip from "@/components/home/IdentityStrip";

/**
 * TODAY — the command centre, not a second discovery feed.
 *
 * Four questions, in the order a returning person asks them:
 *
 *   1. Who am I here, and what do I send?   → the identity strip
 *   2. What is my next step?                → the ladder card
 *   3. What can I claim or join now?        → receipt wallet + happening shelf
 *   4. Is anything waiting on a reply?      → the inbox line
 *
 * The full region feed lives in Regions. Home carries only dated rounds and
 * events, because "what can I join this week?" is an action, while "what is
 * listed?" is browsing. No setup meter, no duplicate listing rows, no second
 * copy of the tab bar.
 */

function greetingFor(hour) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TodayView({
  name = "there",
  firstName,
  rank,
  region,
  happening = [],
  page = {},
  institution = null,
  unread = 0,
  now = new Date(),
}) {
  const hour = now instanceof Date ? now.getHours() : new Date(now).getHours();
  const dateLabel = now instanceof Date
    ? now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })
    : "";
  const displayName = firstName || name;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-7 sm:space-y-9">
      {/* ── 1. Who and how today is going ─────────────────────────────────── */}
      <header>
        <p className="eyebrow">{dateLabel}</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1 sm:text-3xl">
          {greetingFor(hour)}, {displayName}
        </h1>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <RankChip rank={rank} />
        </div>
      </header>

      {/* Identity sits immediately under the greeting: one box, one share
          action, and the office the person belongs to. */}
      <IdentityStrip name={name} page={page} institution={institution} />

      {/* ── The one thing to do next ─────────────────────────────────────── */}
      {rank && rank.level < 5 ? (
        <section
          className="relative overflow-hidden rounded-3xl bg-brand-700 p-5 text-white shadow-sm sm:p-6"
          aria-labelledby="next-step"
        >
          <div className="pointer-events-none absolute -right-10 -top-12 h-40 w-40 rounded-full bg-brand-500/30 blur-2xl" aria-hidden="true" />
          <div className="relative">
            <div className="flex items-center justify-between gap-3">
              <p className="text-micro font-bold uppercase tracking-[0.14em] text-brand-200">
                Next step · level {rank.level} of 5
              </p>
              <RankMark level={rank.level} className="[&>span]:bg-white/80" />
            </div>
            <h2 id="next-step" className="mt-2 text-lg font-extrabold leading-snug tracking-tight sm:text-xl">
              {rank.nextAction ? rank.nextAction.label : `Reach ${rank.next.label}`}
            </h2>
            <p className="mt-1 max-w-md text-xs leading-relaxed text-brand-100">
              {rank.nextAction
                ? rank.nextAction.detail
                : rank.next.blurb}
            </p>
            {rank.nextAction && (
              <Link
                to={rank.nextAction.to}
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-white px-4 py-2.5 text-xs font-bold text-brand-800 transition-colors hover:bg-brand-50 focus-visible:ring-2 focus-visible:ring-white/70"
              >
                {rank.nextAction.label}
                <ArrowRight size={14} aria-hidden="true" />
              </Link>
            )}
          </div>
        </section>
      ) : (
        <section className="rounded-3xl border border-brand-200 bg-brand-50 p-5 dark:border-brand-500/30 dark:bg-brand-500/10">
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

      {/* Receipts live in the feed, not behind a settings door: the value of a
          receipt is highest while the person is still in the shop. */}
      <ReceiptScanCard />

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

      {/* Dated rounds only. The full region feed lives in Regions; Home shows
          what can be joined this week and nothing else. */}
      <HappeningShelf items={happening} region={region} />

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-micro text-ink-4">
        <MapPin size={11} aria-hidden="true" />
        Order is by proximity and record. Nothing here is paid placement.
      </p>
    </div>
  );
}
