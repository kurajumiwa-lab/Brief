import React, { useState } from 'react';
import { Lock, Check } from 'lucide-react';
import type { EngineGuardrail } from '../api/briefApi';
import { requestEngineTier } from '../api/briefApi';

// ---------------------------------------------------------------------------
// TIER GUARDRAIL — the Inline Tier Controller.
//
// The premium surface for the engine's access tiers. Locked capabilities are
// rendered blurred with crisp micro-copy stating EXACTLY what unlocks — no
// hard "Access Denied" wall. The caps shown here are the SERVER's guardrail
// projection; the upgrade attempt posts to the server and surfaces its honest
// answer (today: billing is not connected, so the refusal is shown verbatim —
// the client never pretends a purchase happened).
// ---------------------------------------------------------------------------

export interface TierGuardrailProps {
  guardrail: EngineGuardrail | null;
}

function CapRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1">
      <span className="text-[11px] text-[var(--ink-60)]">{label}</span>
      <span className="text-[11px] font-mono font-bold text-[var(--brief-ink)]">{value}</span>
    </div>
  );
}

export function TierGuardrail({ guardrail }: TierGuardrailProps) {
  const [attempt, setAttempt] = useState<{ ok: boolean; unlocks?: string; detail?: string; reason?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  if (!guardrail) {
    return (
      <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4">
        <p className="text-[11px] text-[var(--ink-60)]">Tier guardrail unavailable.</p>
      </div>
    );
  }

  const tryUpgrade = async () => {
    if (!guardrail.next || busy) return;
    setBusy(true);
    const res = await requestEngineTier(guardrail.next.tier);
    setBusy(false);
    // The server's honest answer (402 today) arrives as an error payload —
    // surface its detail rather than masking it as a generic failure.
    const body: any = res.ok ? res.data : res.errorBody;
    setAttempt({
      ok: res.ok,
      unlocks: body?.unlocks,
      detail: body?.detail,
      reason: res.ok ? undefined : res.error
    });
  };

  return (
    <div className="rounded-2xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-extrabold uppercase tracking-[0.16em] text-[var(--brief-ink)]">
          Tier
        </h3>
        <span className="rounded-md bg-[#40916C] px-2 py-0.5 text-[11px] font-extrabold text-[var(--accent-ink)]">
          {guardrail.label}
        </span>
      </div>

      {/* current caps — the server's projection, verbatim */}
      <div className="divide-y divide-[var(--brief-line)]">
        <CapRow label="Sync heartbeat" value={`every ${Math.round(guardrail.caps.syncIntervalMs / 1000)}s`} />
        <CapRow label="Routing routes" value={guardrail.caps.maxRoutes == null ? 'unlimited' : String(guardrail.caps.maxRoutes)} />
        <CapRow label="Pipeline depth" value={guardrail.caps.pipelineDepth} />
      </div>
      <p className="text-[11px] text-[var(--ink-60)] leading-snug">{guardrail.micro}</p>

      {/* the next tier: visible, blurred, precisely described */}
      {guardrail.next && (
        <div className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-3">
          <div className="flex items-center justify-between gap-2" style={{ filter: 'blur(1.2px)', opacity: 0.65 }}>
            <span className="text-[12px] font-extrabold text-[var(--brief-ink)]">
              {guardrail.next.label}
            </span>
            <Lock className="h-3.5 w-3.5 text-[var(--brief-ink)]" />
          </div>
          <p className="mt-1 text-[11px] text-[var(--ink-70)] leading-snug" style={{ filter: 'blur(1.2px)', opacity: 0.7 }}>
            {guardrail.next.micro}
          </p>
          <button
            type="button"
            onClick={() => void tryUpgrade()}
            disabled={busy}
            className="mt-2.5 w-full h-8 rounded-lg text-[12px] font-extrabold cursor-pointer disabled:opacity-40"
            style={{ background: '#40916C', color: 'var(--brief-ink)' }}
          >
            {busy ? 'Checking…' : `Unlock ${guardrail.next.label}`}
          </button>
        </div>
      )}

      {/* the honest answer, verbatim */}
      {attempt && (
        <div className="rounded-xl border border-[var(--brief-line)] bg-[var(--color-well)] p-2.5">
          {attempt.ok ? (
            <p className="text-[11px] text-[var(--brief-ink)] flex items-center gap-1.5">
              <Check className="h-3 w-3" /> Tier changed.
            </p>
          ) : (
            <>
              <p className="text-[11px] font-bold text-[var(--brief-ink)] leading-snug">
                {attempt.detail ?? 'The upgrade could not complete yet.'}
              </p>
              {attempt.unlocks && (
                <p className="mt-1 text-[11px] text-[var(--ink-60)] leading-snug">
                  What {guardrail.next?.label} unlocks: {attempt.unlocks}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default TierGuardrail;
