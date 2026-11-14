import { Link } from "react-router-dom";
import {
  ArrowRight, ArrowUpRight, Building2, ChevronRight, Inbox, MapPin,
  PenLine, Sparkles,
} from "lucide-react";
import Button from "@/components/ui/Button";
import { RankChip, RankMark } from "@/components/identity/Rank";
import { ItemRow } from "@/components/regions/Rows";
import { regionPath } from "@/config/regions";

/**
 * TODAY — the whole home screen.
 *
 * Three questions, in the order a person asks them when they open an app:
 *
 *   1. Is anything waiting for me?       → the next step, and the inbox line
 *   2. What is happening where I am?     → the region pulse
 *   3. Is my page doing its job?         → the page strip
 *
 * Nothing else. No setup meter, no status shelf, no radar, no hero carousel,
 * no four-card grid, no second copy of the tab bar's destinations. The old Home
 * had 11 sections and 5,080 lines of components; this has three and one card.
 *
 * A block with no content renders nothing. There are no placeholders to scroll
 * past, and no "0" statistics pretending to be information.
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
  identity,
  region,
  pulse = [],
  pulseLoading = false,
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
  const published = page.published !== false;

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
          {!published && identity?.intent !== "explore" && (
            <Link
              to="/you/page"
              className="inline-flex items-center gap-1 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-2xs font-bold text-accent-800 dark:border-accent-500/30 dark:bg-accent-500/15 dark:text-accent-300"
            >
              Page not published
              <ArrowUpRight size={12} aria-hidden="true" />
            </Link>
          )}
        </div>
      </header>

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

      {unread > 0 && (
        <Link
          to="/inbox"
          className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-3 hover:border-edge-2"
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

      {/* ── 2. Where you are ─────────────────────────────────────────────── */}
      <section aria-labelledby="region-heading">
        <div className="flex items-baseline justify-between gap-3 border-b border-edge-1 pb-2.5">
          <div>
            <h2 id="region-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              {region ? region.name : "Your region"}
            </h2>
            {region && (
              <p className="mt-0.5 text-2xs text-ink-4">
                {region.hub} · {region.knownFor.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
          <Link
            to={region ? regionPath(region) : "/regions"}
            className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            {region ? "Open region" : "Choose a region"}
          </Link>
        </div>

        {region ? (
          <>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">{region.summary}</p>
            {pulseLoading ? (
              <div className="mt-2 space-y-2" aria-hidden="true">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-14 animate-pulse rounded-xl bg-surface-2" />
                ))}
              </div>
            ) : pulse.length > 0 ? (
              <ul className="mt-1 divide-y divide-edge-1">
                {pulse.slice(0, 3).map((item) => (
                  <ItemRow key={`${item.kind}:${item.id}`} item={item} />
                ))}
              </ul>
            ) : (
              <p className="mt-3 rounded-2xl border border-dashed border-edge-2 bg-surface-0 px-4 py-4 text-2xs leading-relaxed text-ink-3">
                Nothing has been published in {region.hub} yet. A region starts
                with one honest page —{" "}
                <Link to="/create" className="font-bold text-brand-700 hover:underline dark:text-brand-400">
                  publish what you do
                </Link>{" "}
                and the next person has something to find.
              </p>
            )}
          </>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-4">
            <p className="max-w-xs text-2xs leading-relaxed text-ink-3">
              Tell us the town you work from. Everything you see here is ordered
              by it, and you can change it whenever you move.
            </p>
            <Button as={Link} to="/regions" size="sm" variant="secondary">
              Choose
            </Button>
          </div>
        )}
      </section>

      {/* ── 3. Your page ─────────────────────────────────────────────────── */}
      <section aria-labelledby="page-heading" className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="page-heading" className="text-base font-extrabold tracking-tight text-ink-1">
              Your page
            </h2>
            <p className="mt-0.5 truncate text-2xs text-ink-4">
              {page.url || "A page buyers can read before they call."}
            </p>
          </div>
          <Link
            to="/you"
            className="shrink-0 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Open
          </Link>
        </div>

        {page.counts ? (
          <dl className="mt-4 grid grid-cols-3 divide-x divide-edge-1 rounded-xl border border-edge-1 bg-surface-0 py-3">
            {[
              ["On the page", page.counts.offers ?? 0],
              ["Trades", page.counts.trades ?? 0],
              ["Confirmed", page.counts.verified ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="px-3 text-center">
                <dd className="text-base font-extrabold tabular-nums text-ink-1">{value}</dd>
                <dt className="mt-0.5 text-micro text-ink-4">{label}</dt>
              </div>
            ))}
          </dl>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button as={Link} to="/you/page" size="sm" variant="secondary" icon={PenLine}>
            Edit page
          </Button>
          {page.href && (
            <Button as={Link} to={page.href} size="sm" variant="ghost">
              View as a visitor
            </Button>
          )}
        </div>
      </section>

      {/* ── Your institution, if you belong to one ───────────────────────── */}
      {institution && (
        <section className="flex items-center gap-3 rounded-2xl border border-edge-1 bg-surface-1 px-4 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-2">
            <Building2 size={18} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="eyebrow">Home office</p>
            <p className="truncate text-sm font-bold text-ink-1">{institution.name}</p>
            <p className="text-2xs text-ink-4">{institution.line}</p>
          </div>
          <Link
            to="/office"
            className="inline-flex shrink-0 items-center gap-1 text-micro font-bold text-brand-700 hover:underline dark:text-brand-400"
          >
            Open
            <ArrowUpRight size={12} aria-hidden="true" />
          </Link>
        </section>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-micro text-ink-4">
        <MapPin size={11} aria-hidden="true" />
        Order is by proximity and record. Nothing here is paid placement.
      </p>
    </div>
  );
}
