import React from 'react';
import { ArrowRight, Check, Lock } from 'lucide-react';
import type { Ladder, LadderRungId } from '../api/briefApi';
import { ladderProgress } from './ladder';

// ---------------------------------------------------------------------------
// NEXT STEP — the ladder, rendered as one card with one call to action.
//
// Progressive disclosure in its plainest form: the person sees the rung they
// are on and the single thing that opens the one above it. Not a checklist of
// twelve, not a tour, and never on a screen they navigated to on purpose (see
// showsLadder() in ladder.ts — Saved and Actions are deliberately quiet).
//
// Everything shown here is DERIVED from the server's ladder, which is itself
// derived from real rows. The card cannot claim progress that did not happen,
// and it disappears entirely once the last rung is reached rather than
// inventing a further step to keep a streak alive.
// ---------------------------------------------------------------------------

export interface NextStepProps {
  ladder: Ladder | null;
  /** Where the CTA should take them. Resolved by App, which owns navigation. */
  onAct: (rungId: LadderRungId) => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function NextStep({ ladder, onAct, onDismiss, compact = false }: NextStepProps) {
  if (!ladder || !ladder.nextStep) return null;

  const { done, total } = ladderProgress(ladder);
  const next = ladder.nextStep;
  const nextService = ladder.services.find((s) => s.requires === next.id && !s.unlocked) ?? null;

  return (
    <section
      data-testid="next-step"
      aria-label="Your next step"
      className="rounded-2xl border border-[#0891B2] bg-[color:var(--color-paper)] px-4 py-3.5 shadow-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-extrabold uppercase tracking-[0.18em] text-[var(--ink-60)]">
            Step {done + 1} of {total}
          </p>
          <h3 className="mt-0.5 text-[15px] font-extrabold tracking-tight text-[var(--brief-ink)]">{next.label}</h3>
          {!compact && <p className="mt-1 text-[12px] leading-snug text-[var(--ink-60)]">{next.detail}</p>}
        </div>
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.14em] text-[var(--ink-60)] hover:text-[var(--brief-ink)] cursor-pointer"
          >
            Hide
          </button>
        )}
      </div>

      <div className="mt-2.5 flex items-center gap-1">
        {ladder.rungs.map((rung) => (
          <span
            key={rung.id}
            title={rung.reached ? `${rung.label} — ${rung.how ?? 'done'}` : rung.label}
            className={`h-1.5 flex-1 rounded-full ${rung.reached ? 'bg-[#40916C]' : 'bg-[color:var(--brief-line)]'}`}
          />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onAct(next.id)}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[#40916C] px-3.5 py-2 text-[12px] font-extrabold text-[var(--accent-ink)] cursor-pointer"
        >
          {next.cta} <ArrowRight className="h-3 w-3" />
        </button>
        {nextService && (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ink-70)]">
            <Lock className="h-3 w-3" /> opens {nextService.label}
          </span>
        )}
      </div>

      {!compact && ladder.reached.length > 0 && (
        <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--ink-60)]">
          <Check className="h-3 w-3" />
          {ladder.rungs.filter((r) => r.reached).slice(-1)[0]?.how ?? 'Done so far'}
        </p>
      )}
    </section>
  );
}

export default NextStep;
