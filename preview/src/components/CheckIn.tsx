import React from 'react';
import * as briefApi from '../api/briefApi';
import type { Ticket } from '../api/types';
import QRCode from 'qrcode';
import { QR_COLORS } from '../ui/qrPalette';

// ---------------------------------------------------------------------------
// THE GATE — check-in
//
// The host's gate-operator surface. Enter or scan a ticket code, see who it is
// and whether they are paid, then check them in with one tap. Every state is
// the SERVER's word: not found, cancelled, unpaid, already in, checked in.
//
// The ticket code IS the scannable value: it is rendered as a QR for
// attendance display, and the same string is what any code scanner reads.
// ---------------------------------------------------------------------------

const TONE = {
  dim: 'text-[var(--ink-60)]',
  faint: 'text-[var(--ink-60)]',
  gold: 'text-[var(--brief-ink)]',
  accent: 'text-[var(--brief-ink)]',
  danger: 'text-[var(--brief-ink)]',
  warn: 'text-[var(--brief-ink)]'
};

function TicketQr({ code, size = 168 }: { code: string; size?: number }) {
  const [dataUrl, setDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    QRCode.toDataURL(code, { width: size, margin: 1, color: QR_COLORS })
      .then((url) => { if (live) setDataUrl(url); })
      .catch(() => { if (live) setDataUrl(null); });
    return () => { live = false; };
  }, [code, size]);

  if (!dataUrl) return <div className="w-40 h-40 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg" />;
  return <img src={dataUrl} alt={`Ticket ${code}`} className="w-40 h-40 rounded-lg" />;
}

export function CheckIn() {
  const [code, setCode] = React.useState('');
  const [ticket, setTicket] = React.useState<Ticket | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ already?: boolean; checkedInCount?: number } | null>(null);

  const lookup = async (c: string) => {
    if (!c.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await briefApi.getTicket(c.trim());
    setBusy(false);
    if (res.ok) {
      setTicket(res.data);
      if (res.data.status === 'checked_in') setResult({ already: true });
    } else {
      setTicket(null);
      setError(res.error);
    }
  };

  const checkIn = async () => {
    if (!ticket) return;
    setBusy(true);
    setError(null);
    const res = await briefApi.checkInTicket(ticket.code);
    setBusy(false);
    if (res.ok) {
      setResult({ already: Boolean(res.data.already), checkedInCount: res.data.checkedInCount });
      if (res.data.ticket) setTicket(res.data.ticket);
    } else {
      // The server's honest reason (cancelled / unpaid / invalid transition).
      setError(res.error);
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-extrabold text-[var(--brief-ink)]">The Gate</h2>
        <p className="text-[11px] text-[var(--ink-60)]">check-in</p>
      </div>

      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3 space-y-2">
        <input
          value={code}
          onChange={(e) => { setCode(e.target.value); setTicket(null); setError(null); setResult(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void lookup(code); }}
          placeholder="Ticket code, e.g. BRF-XXXX-XXXX-XXXX"
          className="w-full bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-lg px-3 py-2.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-60)] outline-none focus:border-[#0891B2]"
        />
        <button
          onClick={() => void lookup(code)}
          disabled={busy || !code.trim()}
          className="w-full py-2 rounded-lg bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold border border-[var(--brief-line)] cursor-pointer disabled:opacity-40"
        >
          {busy ? 'Looking up…' : 'Look up ticket'}
        </button>
      </div>

      {error && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3">
          <p className="text-[12px] font-extrabold text-[var(--brief-ink)]">Not admitted</p>
          <p className="text-[12px] text-[var(--ink-60)] mt-0.5">{error}</p>
        </div>
      )}

      {ticket && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-extrabold text-[var(--brief-ink)]">{ticket.name ?? 'Guest'}</p>
              <p className="text-[11px] text-[var(--ink-60)] truncate">{ticket.campaignTitle ?? '—'}</p>
            </div>
            <span className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
              ticket.status === 'checked_in'
                ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
                : ticket.paid
                  ? 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
                  : 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]'
            }`}>
              {ticket.status}
            </span>
          </div>

          <div className="flex items-center gap-3">
            <TicketQr code={ticket.code} />
            <div className="space-y-1 min-w-0">
              <p className="text-[11px] text-[var(--ink-60)]">Ticket code</p>
              <p className="text-[12px] text-[var(--brief-ink)] break-all select-all">{ticket.code}</p>
              <p className={`text-[11px] ${ticket.paid ? TONE.accent : TONE.danger}`}>
                {ticket.paid ? 'Paid' : 'Unpaid'}
                {ticket.checkedInAt ? ` · in at ${new Date(ticket.checkedInAt).toLocaleTimeString('en-KE', { hour: '2-digit', minute: '2-digit' })}` : ''}
              </p>
            </div>
          </div>

          {result?.already ? (
            <p className="text-[11px] text-[var(--brief-ink)] font-bold">
              Already checked in{result.checkedInCount !== undefined ? ` · ${result.checkedInCount} admitted` : ''}
            </p>
          ) : ticket.status !== 'checked_in' && (
            <button
              onClick={checkIn}
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-[#40916C] text-[var(--accent-ink)] text-[12px] font-extrabold cursor-pointer disabled:opacity-40"
            >
              {busy ? 'Checking in…' : 'Check in'}
            </button>
          )}

          {result?.already && result.checkedInCount !== undefined && (
            <p className="text-[11px] text-[var(--ink-60)]">Total admitted: {result.checkedInCount}</p>
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--ink-60)] leading-snug">
        The code is the scannable value. A gate operator can scan it with any
        QR reader, or type it by hand. Admission is recorded once and never
        double-counted.
      </p>
    </div>
  );
}

export default CheckIn;
