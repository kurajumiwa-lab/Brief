import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, BadgeCheck, Clock, Sprout, TrendingDown, TrendingUp } from "lucide-react";
import { meritAPI } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * THE TRUST TICKER — a page's record, stated plainly.
 *
 * The brief wanted a page that behaves like a live ticker. The useful half of
 * that is true: a stranger can see how many orders were delivered, how many
 * documents were checked, and how recently anything happened. The half that
 * would be a lie is the *price*: a business is not a share, its score is not
 * worth money, and nothing here can be bought.
 *
 * So: a small, quiet band. Tier, score, the three strongest reasons, and a
 * one-line trend. No animation chasing a number, no "invest", no shillings.
 * The sentence at the bottom is not decoration — it is the thing that keeps
 * this a record rather than a valuation.
 */

const TIER_SKIN = {
  seed: {
    chip: "bg-surface-2 text-ink-2 border-edge-2",
    icon: Sprout,
    blurb: "New here. Not much on record yet.",
  },
  verified: {
    chip: "bg-tech-50 text-tech-800 border-tech-200 dark:bg-tech-500/10 dark:text-tech-200 dark:border-tech-500/30",
    icon: BadgeCheck,
    blurb: "Has enough on record to take a chance on.",
  },
  blue_chip: {
    chip: "bg-brand-50 text-brand-800 border-brand-200 dark:bg-brand-500/10 dark:text-brand-200 dark:border-brand-500/30",
    icon: TrendingUp,
    blurb: "A long, checked record across more than one kind of work.",
  },
};

export default function TrustTicker({ handle, compact = false }) {
  const [card, setCard] = useState(null);
  const [ticker, setTicker] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!handle) return undefined;
    // Optional all the way down: the page still works without its trust card,
    // and a test double that does not know about merit must not break a page.
    meritAPI
      ?.card?.(handle)
      ?.then(({ data }) => { if (alive) setCard(data); })
      ?.catch(() => { if (alive) setFailed(true); });
    meritAPI
      ?.ticker?.(handle, 30)
      ?.then(({ data }) => { if (alive) setTicker(data); })
      ?.catch(() => {});
    return () => {
      alive = false;
    };
  }, [handle]);

  if (failed || !card) return null;

  const skin = TIER_SKIN[card.tier] || TIER_SKIN.seed;
  const Icon = skin.icon;
  const points = (ticker?.points || []).map((p) => p.score);
  const first = points[0];
  const last = points[points.length - 1];
  const trend = points.length >= 2 ? last - first : 0;

  // The three components that actually carry the score. A component with zero
  // is omitted: "nothing yet" repeated three times is noise, not a record.
  const reasons = (card.components || [])
    .filter((c) => c.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, compact ? 2 : 3);

  return (
    <section
      data-testid="trust-ticker"
      className="mt-4 rounded-2xl border border-edge-1 bg-surface-1 p-3.5"
      aria-label="Trust record"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-2xs font-bold",
              skin.chip,
            )}
          >
            <Icon size={11} aria-hidden="true" />
            {card.tier_label}
          </span>
          {card.streak_weeks >= 4 && (
            <span className="inline-flex items-center gap-1 text-micro font-bold text-ink-3">
              <Activity size={10} aria-hidden="true" /> {card.streak_weeks} weeks running
            </span>
          )}
        </div>
        <div className="text-right">
          <p className="text-lg font-extrabold leading-none tabular-nums text-ink-1">
            {Math.round(card.score)}
            <span className="text-micro font-semibold text-ink-4"> / {card.max_score}</span>
          </p>
          {points.length >= 2 && (
            <p
              className={cn(
                "mt-0.5 inline-flex items-center gap-0.5 text-micro font-bold",
                trend > 0 ? "text-tech-700" : trend < 0 ? "text-ink-4" : "text-ink-4",
              )}
            >
              {trend > 0 ? <TrendingUp size={10} aria-hidden="true" /> : trend < 0 ? <TrendingDown size={10} aria-hidden="true" /> : null}
              {trend === 0 ? "steady" : `${trend > 0 ? "+" : ""}${Math.round(trend)} in 30 days`}
            </p>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-micro leading-relaxed text-ink-3">{skin.blurb}</p>

      {reasons.length > 0 && (
        <ul className="mt-2 space-y-1">
          {reasons.map((c) => (
            <li key={c.key} className="flex items-start gap-1.5 text-micro leading-relaxed text-ink-2">
              <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-ink-3" aria-hidden="true" />
              <span>
                <span className="font-semibold">{c.points.toFixed(0)}</span> · {c.reason}
              </span>
            </li>
          ))}
        </ul>
      )}

      {card.decay < 1 && (
        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-surface-2 px-2 py-1.5 text-micro leading-relaxed text-ink-3">
          <Clock size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
          {card.quiet_days} days since the last recorded activity, so{" "}
          {Math.round(card.decay * 100)}% of the earned record is showing.{" "}
          <span className="font-semibold text-ink-2">Nothing was lost.</span>
        </p>
      )}

      <p className="mt-2 border-t border-edge-1 pt-2 text-micro leading-relaxed text-ink-4">
        A count of things this business did, published so anyone can check it. Not money,
        not collateral, and not a promise of credit.{" "}
        {card.unlocks?.length > 0 && (
          <span className="text-ink-3">
            At this tier: {card.unlocks[0].toLowerCase()}
            {card.unlocks.length > 1 ? `, and ${card.unlocks.length - 1} more` : ""}.
          </span>
        )}{" "}
        <Link to={`/merit/${handle}`} className="font-bold text-brand-700 hover:underline dark:text-brand-300">
          The full record
        </Link>
      </p>
    </section>
  );
}
