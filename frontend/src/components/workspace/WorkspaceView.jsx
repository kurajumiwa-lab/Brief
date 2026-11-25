import { Link } from "react-router-dom";
import {
  ArrowUpRight, BadgeCheck, ClipboardList, FileText, Receipt, ShieldCheck, Store,
} from "lucide-react";
import { RankChip } from "@/components/identity/Rank";
import { cn } from "@/lib/utils";

/**
 * THE BUSINESS WORKSPACE — one screen that says where a business stands.
 *
 * The redesign asked for a business workspace that is *distinct* from the
 * consumer side of the product, and — this is the important part — that never
 * implies the platform holds money when it does not.
 *
 * So the four numbers on this screen are four different things, and the copy
 * names which is which:
 *
 *   RECORDED      movements that settled and are on the record
 *   OUTSTANDING   movements agreed but not settled yet
 *   RECEIPT-BACKED confirmations a receipt supports, on either side
 *   PEOPLE        counterparties you have traded with
 *
 * None of them is a balance, an earning, a payout or a pot of money. Wasta
 * records trades and holds no funds, so the screen says so in one line and
 * means it: there is no number here that anyone can withdraw.
 *
 * Everything here is a door to a screen that already exists. The workspace
 * does not invent a workflow; it makes the existing ones findable from one
 * place and says what each one is waiting for.
 */

const STAT = {
  tone: {
    brand: "bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
    tech: "bg-tech-50 text-tech-700 dark:bg-tech-500/15 dark:text-tech-300",
    neutral: "bg-surface-2 text-ink-2",
  },
};

function StatCard({ icon: Icon, tone = "neutral", label, value, hint, to, action }) {
  const body = (
    <>
      <span className={cn("grid h-8 w-8 place-items-center rounded-xl", STAT.tone[tone] || STAT.tone.neutral)}>
        <Icon size={15} aria-hidden="true" />
      </span>
      <span className="mt-2 block text-2xl font-extrabold tabular-nums leading-none text-ink-1">
        {value}
      </span>
      <span className="mt-1 block text-xs font-bold text-ink-1">{label}</span>
      <span className="mt-0.5 block text-2xs leading-snug text-ink-4">{hint}</span>
    </>
  );
  const classes =
    "ds-card ds-card-interactive ds-focus block p-3 text-left";

  if (to) {
    return (
      <Link to={to} className={classes} data-testid="workspace-stat">
        {body}
        {action && (
          <span className="mt-2 inline-flex items-center gap-1 text-2xs font-bold text-brand-700 dark:text-brand-300">
            {action}
            <ArrowUpRight size={12} aria-hidden="true" />
          </span>
        )}
      </Link>
    );
  }
  return <div className="ds-card p-3" data-testid="workspace-stat">{body}</div>;
}

export default function WorkspaceView({
  vendor = null,
  rank = null,
  stats = {},
  pending = [],
  listings = 0,
  records = [],
}) {
  const name = vendor?.business_name || vendor?.vendor_handle || "Your business";

  return (
    <div className="ds-stack mx-auto w-full max-w-2xl">
      <header>
        <p className="ds-eyebrow">Business workspace</p>
        <h1 className="ds-display mt-1.5">{name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {rank && <RankChip rank={rank} />}
          {vendor?.vendor_handle && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-2xs font-bold text-ink-2">
              <Store size={12} aria-hidden="true" />
              /p/{vendor.vendor_handle}
            </span>
          )}
        </div>
      </header>

      {/* ── Where the business stands ──────────────────────────────────── */}
      <section aria-labelledby="workspace-standing" className="space-y-3">
        <h2 id="workspace-standing" className="ds-title">
          Where you stand
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={BadgeCheck}
            tone="brand"
            label="Recorded"
            value={stats.recorded ?? "—"}
            hint="Movements that settled and are on the record."
            to="/orders"
            action="Open the record"
          />
          <StatCard
            icon={ClipboardList}
            tone="amber"
            label="Outstanding"
            value={stats.outstanding ?? "—"}
            hint="Agreed but not settled yet. Not a debt — an open movement."
            to="/orders?filter=open"
            action="Settle them"
          />
          <StatCard
            icon={Receipt}
            tone="tech"
            label="Receipt-backed"
            value={stats.confirmed ?? "—"}
            hint="Trades a receipt supports, on either side of the trade."
            to="/trades/proofs"
            action="Confirm a trade"
          />
          <StatCard
            icon={ShieldCheck}
            tone="neutral"
            label="People"
            value={stats.people ?? "—"}
            hint="Counterparties you have traded with in this window."
            to="/analytics"
            action="See the detail"
          />
        </div>
        <p className="text-2xs leading-relaxed text-ink-4" data-testid="workspace-money-note">
          Wasta holds no money for you and lends you none. Every number above
          is a record of a trade that already happened — there is no pot of
          money behind this screen.
        </p>
      </section>

      {/* ── What is waiting on you ─────────────────────────────────────── */}
      <section aria-labelledby="workspace-pending" className="space-y-3">
        <h2 id="workspace-pending" className="ds-title">
          Waiting on you
        </h2>
        {pending.length === 0 ? (
          <div className="ds-card p-4">
            <p className="text-sm font-bold text-ink-1">Nothing is waiting</p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              Your page, your listings and your records are all in order. When
              something needs you, it will be listed here.
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((item) => (
              <li key={item.id}>
                <Link
                  to={item.to}
                  data-testid="workspace-pending-row"
                  className="ds-card ds-card-interactive ds-focus ds-tap-row px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink-1">{item.title}</span>
                    <span className="mt-0.5 block text-2xs leading-snug text-ink-4">{item.body}</span>
                  </span>
                  <ArrowUpRight size={15} className="shrink-0 text-ink-4" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Your shelf and your records ────────────────────────────────── */}
      <section aria-labelledby="workspace-records" className="space-y-3">
        <h2 id="workspace-records" className="ds-title">
          Your shelf and your records
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Store}
            tone="neutral"
            label="Listings"
            value={listings}
            hint="Items on your shelf that the network can see."
            to="/stock"
            action="Manage the shelf"
          />
          {records.map((record) => (
            <StatCard
              key={record.label}
              icon={record.icon || FileText}
              tone="neutral"
              label={record.label}
              value={record.value}
              hint={record.hint}
              to={record.to}
              action={record.action}
            />
          ))}
        </div>
      </section>

      {/* ── Verification ───────────────────────────────────────────────── */}
      <section aria-labelledby="workspace-verification" className="space-y-3">
        <h2 id="workspace-verification" className="ds-title">
          Verification
        </h2>
        <div className="ds-card flex items-start gap-3 p-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
            <ShieldCheck size={17} aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-ink-1">
              {rank?.level >= 5 ? "Verified by a third party" : "Not verified yet"}
            </p>
            <p className="mt-1 text-2xs leading-relaxed text-ink-3">
              {rank?.nextAction
                ? rank.nextAction.detail
                : "A licence, an institution or a trade proof is what moves a business from a promise to a record."}
            </p>
            <Link to="/you/identity" className="ds-action mt-1">
              {rank?.nextAction ? rank.nextAction.label : "See what you can claim"}
              <ArrowUpRight size={13} aria-hidden="true" />
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
