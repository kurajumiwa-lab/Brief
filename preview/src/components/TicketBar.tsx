import React, { useEffect, useState } from 'react';
import { Ticket, AlertTriangle, X } from 'lucide-react';
import { getEngineTicketBar, type EngineTicketBar } from '../api/briefApi';

// ---------------------------------------------------------------------------
// TICKET BAR — the "Dynamic Ticket & Rerouting" package.
//
// When the user holds an active event entry, the gate pass locks to the
// bottom of the screen: "Event Entry: Active — Ticket #9921". If the event
// changed after the ticket was issued, the engine's delta payload surfaces
// as an INLINE ALERT BANNER on the stub — an adapted ticket, not a bulk
// email. Dismissal is per-session; the entry itself stays.
// ---------------------------------------------------------------------------

export function TicketBar({ onOpenTickets }: { onOpenTickets?: () => void } = {}) {
  const [bar, setBar] = useState<EngineTicketBar | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [dismissedDelta, setDismissedDelta] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      const res = await getEngineTicketBar();
      if (!live) return;
      if (res.ok) setBar(res.data);
      else setBar({ active: false, reason: res.error });
    })();
    return () => { live = false; };
  }, []);

  if (!bar?.active || !bar.ticket || dismissed) return null;
  const t = bar.ticket;
  const delta = bar.deltas?.[0] ?? null;
  const showDelta = delta && dismissedDelta !== `${t.registrationId}:${delta.at}`;

  const stateLabel = t.entryState === 'checked-in' ? 'Checked in' : t.entryState === 'active' ? 'Active' : 'Upcoming';
  const shortCode = t.ticketCode.replace(/^BRF-/, '').slice(0, 4);

  return (
    <div
      className="fixed inset-x-3 bottom-[68px] z-[54] md:inset-x-auto md:bottom-6 md:right-6 md:w-80"
      role="status"
      aria-label="Active event entry"
    >
      <div className="overflow-hidden rounded-2xl border border-[#0891B2] bg-[color:var(--color-paper)] shadow-lg">
        {/* the locked gate pass */}
        <div className="flex items-center gap-3 px-3.5 py-2.5">
          <div
            onClick={onOpenTickets}
            className={`flex items-center gap-3 min-w-0 flex-1 ${onOpenTickets ? 'cursor-pointer' : ''}`}
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
              style={{ background: t.entryState === 'upcoming' ? 'var(--color-well)' : '#40916C', border: '1px solid #40916C' }}
            >
              <Ticket className="h-4 w-4" style={{ color: t.entryState === 'upcoming' ? '#40916C' : 'var(--color-paper)' }} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-extrabold text-[var(--brief-ink)]">{t.eventTitle}</p>
              <p className="text-[11px] font-mono text-[var(--ink-60)]">
                Event Entry: {stateLabel} — Ticket #{shortCode}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="shrink-0 text-[var(--ink-60)] cursor-pointer hover:text-[var(--brief-ink)]"
            aria-label="Hide ticket bar"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* the inline delta alert — the engine's rerouting notice */}
        {showDelta && (
          <div className="flex items-start gap-2 border-t border-dashed border-[var(--brief-line)] bg-[color:var(--color-well)] px-3.5 py-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brief-ink)]" />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold leading-snug text-[var(--brief-ink)]">
                Event details changed since your ticket was issued.
              </p>
              <p className="text-[11px] leading-snug text-[var(--ink-60)]">Check the event page — your entry stays valid.</p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedDelta(`${t.registrationId}:${delta.at}`)}
              className="shrink-0 text-[11px] font-extrabold text-[var(--ink-70)] cursor-pointer hover:text-[var(--brief-ink)]"
            >
              Got it
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default TicketBar;
