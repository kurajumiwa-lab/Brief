import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Circle, ShieldCheck, Sparkles } from "lucide-react";
import { RANKS } from "@/config/identity";
import { cn } from "@/lib/utils";

/**
 * RANK, SAID SMALL.
 *
 * A rank is a fact about exposure, so it is rendered as a fact: a word, a level
 * and the single next thing that would move it. No medals, no flames, no
 * percentage of a whole life. The one place it gets to be a large number is the
 * owner's own ladder, because that is where the question "how do I go up?" is
 * actually being asked.
 */

const TONE = {
  quiet: {
    chip: "bg-surface-2 text-ink-2 border-edge-1",
    bar: "bg-ink-3",
    mark: "text-ink-3",
  },
  brand: {
    chip: "bg-brand-50 text-brand-800 border-brand-200 dark:bg-brand-500/15 dark:text-brand-300 dark:border-brand-500/30",
    bar: "bg-brand-600",
    mark: "text-brand-700",
  },
  amber: {
    chip: "bg-accent-50 text-accent-800 border-accent-200 dark:bg-accent-500/15 dark:text-accent-300 dark:border-accent-500/30",
    bar: "bg-accent-500",
    mark: "text-accent-700",
  },
};

export function RankChip({ rank, className, showLevel = true }) {
  if (!rank) return null;
  const tone = TONE[rank.tone] || TONE.quiet;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-bold",
        tone.chip,
        className,
      )}
      title={rank.blurb}
      data-testid="rank-chip"
      data-rank={rank.key}
    >
      <ShieldCheck size={13} strokeWidth={2.2} aria-hidden="true" />
      {rank.label}
      {showLevel && (
        <span className="tabular-nums opacity-60" aria-label={`Level ${rank.level} of 5`}>
          {rank.level}/5
        </span>
      )}
    </span>
  );
}

/** The five marks, used beside a heading where words would be too long. */
export function RankMark({ level = 0, className }) {
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-hidden="true">
      {RANKS.map((rank) => (
        <span
          key={rank.key}
          className={cn(
            "h-1.5 rounded-full transition-all",
            rank.level <= level ? "w-4 bg-brand-600" : "w-1.5 bg-edge-2",
          )}
        />
      ))}
    </span>
  );
}

/**
 * The owner's ladder. Renders the next rung, not all six at equal weight, and
 * names the missing facts underneath. `items` comes from `rankFor`.
 */
export function RankLadder({ rank, compact = false, showAll = false }) {
  if (!rank) return null;
  const tone = TONE[rank.tone] || TONE.quiet;
  const remaining = rank.nextItems || [];

  return (
    <section
      className={cn(
        "rounded-2xl border border-edge-1 bg-surface-1",
        compact ? "p-4" : "p-5",
      )}
      aria-labelledby="rank-heading"
      data-testid="rank-ladder"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">Your standing</p>
          <h2 id="rank-heading" className="mt-1 flex flex-wrap items-baseline gap-x-2 text-lg font-extrabold tracking-tight text-ink-1">
            {rank.label}
            <span className="text-xs font-semibold text-ink-4">level {rank.level} of 5</span>
          </h2>
        </div>
        <Sparkles size={18} className={cn("mt-1 shrink-0", tone.mark)} aria-hidden="true" />
      </div>

      <p className="mt-1.5 text-xs leading-relaxed text-ink-3">{rank.blurb}</p>

      {rank.level < 5 ? (
        <div className="mt-4">
          <div className="flex items-baseline justify-between gap-3 text-2xs">
            <span className="font-bold text-ink-2">Next: {rank.next.label}</span>
            <span className="tabular-nums text-ink-4">{rank.progress}%</span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-3"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rank.progress}
            aria-label={`Progress to ${rank.next.label}`}
          >
            <div className={cn("h-full rounded-full transition-all", tone.bar)} style={{ width: `${rank.progress}%` }} />
          </div>
          <p className="mt-1.5 text-2xs text-ink-4">{rank.next.blurb}</p>
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-2xs font-medium text-brand-800 dark:bg-brand-500/15 dark:text-brand-300">
          A third party has confirmed your claim. This is the highest rung and
          it cannot be bought or self-awarded.
        </p>
      )}

      {remaining.length > 0 && (
        <ul className="mt-4 space-y-1.5">
          {remaining.map((item) => (
            <li key={item.key}>
              <Link
                to={item.to}
                className="group flex items-start gap-2.5 rounded-xl px-2 py-2 -mx-2 hover:bg-surface-2 focus-visible:ring-2 focus-visible:ring-brand-500"
              >
                <Circle size={13} className="mt-0.5 shrink-0 text-edge-3" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold text-ink-1">{item.label}</span>
                  <span className="block text-2xs leading-snug text-ink-4">{item.detail}</span>
                </span>
                <ArrowUpRight size={13} className="mt-0.5 shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {showAll && (
        <details className="mt-3 border-t border-edge-1 pt-3">
          <summary className="cursor-pointer text-2xs font-semibold text-ink-3 hover:text-ink-1">
            How the five levels work
          </summary>
          <ol className="mt-2 space-y-1.5">
            {RANKS.map((rung) => {
              const done = rung.level <= rank.level;
              return (
                <li key={rung.key} className="flex items-start gap-2 text-2xs">
                  {done ? (
                    <Check size={12} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                  ) : (
                    <Circle size={12} className="mt-0.5 shrink-0 text-edge-3" aria-hidden="true" />
                  )}
                  <span className={done ? "font-semibold text-ink-2" : "text-ink-3"}>
                    {rung.level}. {rung.label} — {rung.blurb}
                  </span>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}

/** A claim is not a badge until somebody else has checked it. */
export function ClaimBadge({ claim, className }) {
  if (!claim) return null;
  const map = {
    pending: ["Waiting", "bg-accent-50 text-accent-800 border-accent-200"],
    verified: ["Confirmed", "bg-brand-50 text-brand-800 border-brand-200"],
    rejected: ["Not confirmed", "bg-surface-2 text-ink-3 border-edge-2"],
  };
  const [label, classes] = map[claim.status] || map.rejected;
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-micro font-bold", classes, className)}>
      {claim.status === "verified" ? <Check size={11} aria-hidden="true" /> : <Circle size={11} aria-hidden="true" />}
      {label}
    </span>
  );
}
