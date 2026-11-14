import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, ArrowUpRight, Check, Circle } from "lucide-react";
import { RankLadder, RankChip } from "@/components/identity/Rank";
import { useAuthStore } from "@/stores/authStore";
import { useIdentityStore } from "@/stores/identityStore";
import { RANKS, rankFor } from "@/config/identity";

/**
 * Rank, explained in one screen: the current rung, the missing facts, and the
 * five levels that exist. No points balance, no streak, no leaderboard — those
 * measure time spent in an app, not exposure to a market.
 */
export default function RankPage() {
  const vendor = useAuthStore((s) => s.vendor);
  const identity = useIdentityStore();
  const loadIdentity = useIdentityStore((s) => s.load);

  useEffect(() => {
    loadIdentity();
  }, [loadIdentity]);

  const rank = rankFor({ vendor, identity });

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5">
      <Link to="/you" className="inline-flex items-center gap-1.5 text-2xs font-bold text-ink-3 hover:text-ink-1">
        <ArrowLeft size={13} aria-hidden="true" />
        You
      </Link>

      <header>
        <p className="eyebrow">Standing</p>
        <h1 className="mt-1.5 text-2xl font-extrabold tracking-tight text-ink-1">How rank works</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-ink-3">
          Rank is a measure of what you have made checkable: a page, a place, a
          contact route, a completed trade, a record, a confirmed institution.
          Paying for a plan does not move it.
        </p>
        <div className="mt-2">
          <RankChip rank={rank} />
        </div>
      </header>

      <RankLadder rank={rank} showAll />

      <section className="rounded-2xl border border-edge-1 bg-surface-1 p-4 sm:p-5">
        <h2 className="text-base font-extrabold tracking-tight text-ink-1">What raises you</h2>
        <p className="mt-0.5 text-2xs text-ink-3">
          Every item is a fact somebody can see. Nothing here is bought, and
          nothing is lost by changing what you sell.
        </p>
        <ul className="mt-3 divide-y divide-edge-1">
          {RANKS.slice(1).map((rung) => {
            const items = rank.items.filter((item) => item.step === rung.level);
            return (
              <li key={rung.key} className="py-3">
                <p className="flex items-center gap-2 text-2xs font-bold text-ink-1">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-surface-2 text-micro tabular-nums text-ink-3">
                    {rung.level}
                  </span>
                  {rung.label}
                  {rank.level >= rung.level && (
                    <span className="ml-auto inline-flex items-center gap-1 text-micro font-semibold text-brand-700 dark:text-brand-400">
                      <Check size={11} aria-hidden="true" /> reached
                    </span>
                  )}
                </p>
                <ul className="mt-1.5 space-y-1 pl-7">
                  {items.map((item) => (
                    <li key={item.key}>
                      <Link
                        to={item.to}
                        className="group flex items-start gap-2 text-2xs text-ink-3 hover:text-ink-1"
                      >
                        {item.done ? (
                          <Check size={12} className="mt-0.5 shrink-0 text-brand-600" aria-hidden="true" />
                        ) : (
                          <Circle size={12} className="mt-0.5 shrink-0 text-edge-3" aria-hidden="true" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{item.label}</span> — <span className="text-ink-4">{item.detail}</span>
                        </span>
                        <ArrowUpRight size={11} className="mt-0.5 shrink-0 text-ink-4 group-hover:text-ink-1" aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl border border-edge-1 bg-surface-0 p-4">
        <h2 className="text-xs font-extrabold text-ink-1">The rule that does not change</h2>
        <p className="mt-1 text-2xs leading-relaxed text-ink-3">
          A person may sell tomatoes in March and drive a boda in April. Their
          rank does not reset when the work changes; what they have already proved
          stays on record. Only the two claims at level five need a third party,
          and both can lapse if the licence or the affiliation expires.
        </p>
      </section>
    </div>
  );
}
