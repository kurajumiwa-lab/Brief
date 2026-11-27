import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft, Briefcase, CalendarDays, ChevronRight, GraduationCap, HeartHandshake,
  Package, Sparkles, Users, Wallet,
} from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import { PageSpinner } from "@/components/ui/Spinner";
import { earningsAPI, apiError } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * MY OPPORTUNITIES & EARNINGS — the member's economic identity, as evidence.
 *
 * Every number on this page is a count or a sum of stored rows, fetched from
 * the caller's own records and nobody else's. Pending is not due; due is not
 * paid; points are never money. What the platform cannot honestly measure is
 * listed at the bottom rather than estimated.
 */

const CHANNEL_ICONS = {
  projects: Briefcase,
  referrals: HeartHandshake,
  events: CalendarDays,
  partnerships: Users,
  knowledge: GraduationCap,
  rentals: Package,
};

const kes = (n) => `KSh ${Number(n || 0).toLocaleString("en-KE")}`;
const num = (n) => Number(n || 0).toLocaleString("en-KE");

export default function EarningsPage() {
  const [state, setState] = useState({ loading: true, error: null, data: null });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const { data } = await earningsAPI.me();
      setState({ loading: false, error: null, data });
    } catch (err) {
      setState({ loading: false, error: apiError(err, "Your earnings could not be loaded."), data: null });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (state.loading) return <PageSpinner label="Adding up your record…" />;

  if (state.error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm font-semibold text-ink-1">{state.error}</p>
        <Button className="mt-3" size="sm" variant="secondary" onClick={load}>Try again</Button>
      </div>
    );
  }

  const { summary, commissions, channels, recent, not_measured: notMeasured, note } = state.data;
  const allZero =
    !summary.completed_projects &&
    !summary.successful_referrals &&
    !summary.event_connections &&
    !summary.active_opportunities &&
    !commissions.pending_count &&
    !commissions.due_count &&
    !commissions.paid_count;

  return (
    <div className="min-h-screen bg-surface-1">
      <header className="border-b border-edge-1 bg-surface-0">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-4 py-3">
          <Link to="/you" className="inline-flex items-center gap-1.5 text-sm font-bold text-ink-1">
            <ArrowLeft size={14} aria-hidden="true" /> Profile
          </Link>
          <span className="inline-flex items-center gap-1.5 text-2xs font-semibold text-ink-3">
            <Wallet size={13} aria-hidden="true" /> Your record, not a score
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl space-y-5 px-4 py-5">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink-1">My opportunities &amp; earnings</h1>
          <p className="mt-0.5 text-2xs text-ink-3">What your participation actually produced — counts and sums of your own records.</p>
        </div>

        {allZero && (
          <EmptyState
            icon={Sparkles}
            title="Nothing to measure yet"
            description="Every number here is earned, not claimed. Start with one request answered, one referral verified, or one event attended."
            action={<Button as={Link} to="/work" size="sm">See opportunities</Button>}
          />
        )}

        {/* The four headline counts */}
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Summary" data-testid="earnings-stats">
          <StatCard label="Completed projects" value={summary.completed_projects} />
          <StatCard label="Successful referrals" value={summary.successful_referrals} />
          <StatCard label="Event connections" value={summary.event_connections} />
          <StatCard label="Active opportunities" value={summary.active_opportunities} />
        </section>

        {/* Money in motion — three states, never one number */}
        <Card className="p-4" data-testid="earnings-commissions">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-extrabold text-ink-1">Commissions</h2>
            <Badge variant="outline" size="xs">verified transactions only</Badge>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x divide-edge-1 text-center">
            <div className="px-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">Pending</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-ink-1">{kes(commissions.pending_kes)}</p>
              <p className="text-2xs text-ink-4">{num(commissions.pending_count)} awaiting verification</p>
            </div>
            <div className="px-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">Due</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-ink-1">{kes(commissions.due_kes)}</p>
              <p className="text-2xs text-ink-4">{num(commissions.due_count)} approved, unpaid</p>
            </div>
            <div className="px-2">
              <p className="text-micro font-semibold uppercase tracking-wide text-ink-4">Paid</p>
              <p className="mt-1 text-lg font-extrabold tabular-nums text-brand-700 dark:text-brand-300">{kes(commissions.paid_kes)}</p>
              <p className="text-2xs text-ink-4">{num(commissions.paid_count)} recorded paid</p>
            </div>
          </div>
          <dl className="mt-3 space-y-1 border-t border-edge-1 pt-3 text-2xs text-ink-3">
            <div className="flex items-center justify-between gap-2">
              <dt>Reward points (not money)</dt>
              <dd className="tabular-nums font-semibold text-ink-1">{num(commissions.reward_points)} pts</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>Project payouts recorded as completed</dt>
              <dd className="tabular-nums font-semibold text-ink-1">{kes(commissions.project_payouts_recorded_kes)} · {num(commissions.project_payouts_recorded_count)} recorded</dd>
            </div>
            <div className="flex items-center justify-between gap-2">
              <dt>Event value (estimate: seats × entry fee)</dt>
              <dd className="tabular-nums font-semibold text-ink-1">{kes(commissions.event_value_estimate_kes)} est.</dd>
            </div>
          </dl>
          <p className="mt-3 text-2xs leading-relaxed text-ink-4">{note}</p>
        </Card>

        {/* My earning channels */}
        <Card className="divide-y divide-edge-1 p-0" data-testid="earnings-channels">
          <h2 className="px-4 pb-1 pt-4 text-sm font-extrabold text-ink-1">My earning channels</h2>
          {channels.map((channel) => {
            const Icon = CHANNEL_ICONS[channel.key] || Sparkles;
            return (
              <Link
                key={channel.key}
                to={channel.to}
                className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-surface-2 text-ink-3">
                  <Icon size={17} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-ink-1">{channel.name}</span>
                  <span className="block text-2xs text-ink-4">{channel.detail}</span>
                </span>
                {channel.count === null ? (
                  <Badge variant="gray" size="xs">not tracked yet</Badge>
                ) : (
                  <Badge variant="brand" size="xs">{num(channel.count)}</Badge>
                )}
                <ChevronRight size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
              </Link>
            );
          })}
        </Card>

        {/* Recent events that built the record */}
        {recent.length > 0 && (
          <Card className="p-4" data-testid="earnings-recent">
            <h2 className="text-sm font-extrabold text-ink-1">Recent</h2>
            <ul className="mt-2 divide-y divide-edge-1">
              {recent.map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-2xs font-semibold text-ink-1">{item.label}</span>
                    <span className="block text-micro text-ink-4">{item.to && <Link className="hover:underline" to={item.to}>{item.kind}</Link>} · {item.occurred_at ? new Date(item.occurred_at).toLocaleDateString("en-KE", { day: "numeric", month: "short" }) : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {item.amount_kes ? <span className="text-2xs font-bold tabular-nums text-ink-1">{kes(item.amount_kes)}</span> : null}
                    <Badge variant={item.status === "paid" ? "brand" : "gray"} size="xs">{item.status}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* What this page cannot count yet — on purpose */}
        <Card className="p-4" data-testid="earnings-not-measured">
          <h2 className="text-2xs font-semibold uppercase tracking-wide text-ink-4">What this page cannot honestly count yet</h2>
          <ul className="mt-2 space-y-2">
            {notMeasured.map((entry) => (
              <li key={entry.what} className="text-2xs leading-relaxed text-ink-3">
                <span className="font-semibold text-ink-2">{entry.what}.</span> {entry.why}
              </li>
            ))}
          </ul>
        </Card>
      </main>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-2xl border border-edge-1 bg-surface-0 p-3 text-left">
      <p className="text-micro font-semibold uppercase tracking-wide text-ink-4 leading-tight">{label}</p>
      <p className="mt-1.5 text-2xl font-extrabold tabular-nums leading-none text-ink-1">{num(value)}</p>
    </div>
  );
}
