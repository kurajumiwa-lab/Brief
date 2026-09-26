import React, { useState, useEffect, useCallback, useMemo } from 'react';
import * as briefApi from '../api/briefApi';
import type { ResaleTicket } from '../api/types';
import QRCode from 'qrcode';
import { QR_COLORS } from '../ui/qrPalette';
import {
  Ticket,
  Search,
  Copy,
  Check,
  CalendarDays,
  MapPin,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Download,
  Share2,
  RefreshCw,
  Gift,
  Tag,
  CheckCircle2,
  X,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  Info,
  Maximize2
} from 'lucide-react';

// ---------------------------------------------------------------------------
// MY TICKETS — My Layer → Kept ("My tickets")
//
// The holder's side of the resale & admission system. Each ticket shows the
// code that is valid RIGHT NOW: ownership changes bump the version, and only
// the current "CODE#version" admits at the gate — an old screenshot stops
// working the moment the seat changes hands.
//
// Selling is filed under Workflows → Sell (where the money lives); gifting
// is a direct ownership change with version bump.
// ---------------------------------------------------------------------------

const money = (amount: number, currency: string = 'KES') =>
  `${currency} ${Number(amount || 0).toLocaleString()}`;

export function TicketQr({ code, size = 176 }: { code: string; size?: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    QRCode.toDataURL(code, {
      width: size,
      margin: 1,
      color: QR_COLORS
    })
      .then((url) => { if (live) setDataUrl(url); })
      .catch(() => { if (live) setDataUrl(null); });
    return () => { live = false; };
  }, [code, size]);

  if (!dataUrl) {
    return (
      <div
        className="w-44 h-44 bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-2xl flex items-center justify-center animate-pulse"
        aria-label={`Gate code ${code}`}
      >
        <Ticket className="w-8 h-8 text-[var(--ink-30)]" />
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={`Gate code ${code}`}
      className="w-44 h-44 rounded-2xl border border-[var(--brief-line)] shadow-sm bg-white p-1"
    />
  );
}

const KIND_LABEL: Record<string, string> = {
  purchase: 'Sold / bought',
  gift: 'Gifted',
  refund_revert: 'Returned after a refund'
};

function formatEventDate(startsAt?: string | null, endsAt?: string | null): string {
  if (!startsAt) return 'Date to be announced';
  try {
    const d = new Date(startsAt);
    if (isNaN(d.getTime())) return 'Upcoming';
    const dateStr = d.toLocaleDateString('en-KE', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    const timeStr = d.toLocaleTimeString('en-KE', {
      hour: '2-digit',
      minute: '2-digit'
    });
    if (endsAt) {
      try {
        const e = new Date(endsAt);
        if (!isNaN(e.getTime())) {
          const endTimeStr = e.toLocaleTimeString('en-KE', {
            hour: '2-digit',
            minute: '2-digit'
          });
          return `${dateStr} · ${timeStr} – ${endTimeStr}`;
        }
      } catch {
        /* fallback to start only */
      }
    }
    return `${dateStr} · ${timeStr}`;
  } catch {
    return 'Upcoming';
  }
}

function getCountdownLabel(startsAt?: string | null): string | null {
  if (!startsAt) return null;
  try {
    const start = new Date(startsAt).getTime();
    if (isNaN(start)) return null;
    const now = Date.now();
    const diffHours = Math.round((start - now) / 3600000);
    if (diffHours < 0 && diffHours > -12) return 'Happening today';
    if (diffHours < 0) return 'Past event';
    if (diffHours <= 24) return `Starts in ${Math.max(1, diffHours)}h`;
    const diffDays = Math.ceil(diffHours / 24);
    if (diffDays === 1) return 'Tomorrow';
    return `In ${diffDays} days`;
  } catch {
    return null;
  }
}

function downloadIcs(ticket: ResaleTicket) {
  try {
    const start = ticket.eventStartsAt ? new Date(ticket.eventStartsAt) : new Date(Date.now() + 86400000);
    const end = ticket.eventEndsAt ? new Date(ticket.eventEndsAt) : new Date(start.getTime() + 10800000);

    const pad = (n: number) => (n < 10 ? '0' + n : String(n));
    const toIcsDate = (d: Date) =>
      `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;

    const icsData = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Brief//Ticket Pass//EN',
      'CALSCALE:GREGORIAN',
      'BEGIN:VEVENT',
      `UID:ticket-${ticket.id}-${ticket.codeVersion}@brief.africa`,
      `DTSTAMP:${toIcsDate(new Date())}`,
      `DTSTART:${toIcsDate(start)}`,
      `DTEND:${toIcsDate(end)}`,
      `SUMMARY:${ticket.eventTitle || 'Event Entry'}`,
      `LOCATION:${ticket.eventLocation || 'Nairobi, Kenya'}`,
      `DESCRIPTION:Gate Pass Code: ${ticket.scanCode}\\nAdmittance pass issued via Brief. Show QR at gate.`,
      'STATUS:CONFIRMED',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n');

    const blob = new Blob([icsData], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(ticket.eventTitle || 'ticket').replace(/[^a-z0-9]/gi, '-').toLowerCase()}-pass.ics`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    /* best-effort */
  }
}

export interface MyTicketsProps {
  onSell?: () => void;
  onBrowseEvents?: () => void;
  onOpenEvent?: (slug: string) => void;
}

export function MyTickets({ onSell, onBrowseEvents, onOpenEvent }: MyTicketsProps) {
  const [load, setLoad] = useState<{
    status: 'loading' | 'ready' | 'error';
    data: ResaleTicket[] | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });

  const [engineBar, setEngineBar] = useState<briefApi.EngineTicketBar | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'listed' | 'checked_in' | 'void'>('all');
  const [expandedTicketId, setExpandedTicketId] = useState<string | null>(null);
  const [historyOpenIds, setHistoryOpenIds] = useState<Set<string>>(new Set());
  const [offlineSavedIds, setOfflineSavedIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('brief_offline_tickets');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const [giftFor, setGiftFor] = useState<string | null>(null);
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [pullingListingId, setPullingListingId] = useState<string | null>(null);

  const fetchTickets = useCallback(async () => {
    setLoad({ status: 'loading', data: null, error: null });
    const [res, engineRes] = await Promise.all([
      briefApi.getMyTickets(),
      briefApi.getEngineTicketBar().catch(() => null)
    ]);
    if (res.ok) {
      setLoad({ status: 'ready', data: res.data.tickets, error: null });
    } else {
      setLoad({ status: 'error', data: null, error: res.error });
    }
    if (engineRes && engineRes.ok) {
      setEngineBar(engineRes.data);
    }
  }, []);

  useEffect(() => {
    void fetchTickets();
  }, [fetchTickets]);

  const toggleHistory = (id: string) => {
    setHistoryOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOfflineSave = (id: string) => {
    setOfflineSavedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        setNotice('Ticket removed from offline storage.');
      } else {
        next.add(id);
        setNotice('Ticket saved for offline gate access.');
      }
      try {
        localStorage.setItem('brief_offline_tickets', JSON.stringify(Array.from(next)));
      } catch {
        /* storage full or disabled */
      }
      return next;
    });
  };

  const copyToClipboard = async (textToCopy: string, id: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedCode(id);
      setTimeout(() => setCopiedCode(null), 2500);
    } catch {
      /* fallback */
    }
  };

  const gift = async (ticketId: string) => {
    if (!handle.trim()) return;
    setBusy(true);
    setGiftError(null);
    setNotice(null);
    const cleanHandle = handle.trim().replace(/^@/, '');
    const res = await briefApi.giftTicketToHandle(ticketId, cleanHandle);
    setBusy(false);
    if (!res.ok) {
      setGiftError(res.error);
      return;
    }
    setGiftFor(null);
    setHandle('');
    setNotice(`Seat gifted to @${cleanHandle} — their code is live now, yours is not.`);
    void fetchTickets();
  };

  const pullListing = async (listingId: string) => {
    setPullingListingId(listingId);
    setNotice(null);
    const res = await briefApi.cancelResaleListing(listingId);
    setPullingListingId(null);
    if (res.ok) {
      setNotice('Listing pulled. The seat is yours to use or list again.');
      void fetchTickets();
    } else {
      setNotice(`Could not pull listing: ${res.error}`);
    }
  };

  const tickets = load.data ?? [];

  // Filter and search
  const filteredTickets = useMemo(() => {
    return tickets.filter((t) => {
      // Filter tab
      if (filter === 'active' && (t.status === 'void' || t.activeListingId || t.entryStatus === 'checked_in')) {
        return false;
      }
      if (filter === 'listed' && !t.activeListingId) return false;
      if (filter === 'checked_in' && t.entryStatus !== 'checked_in') return false;
      if (filter === 'void' && t.status !== 'void') return false;

      // Search query
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchTitle = (t.eventTitle || '').toLowerCase().includes(q);
        const matchCode = t.code.toLowerCase().includes(q);
        const matchScan = t.scanCode.toLowerCase().includes(q);
        const matchLoc = (t.eventLocation || '').toLowerCase().includes(q);
        const matchAtt = (t.attendeeName || '').toLowerCase().includes(q);
        return matchTitle || matchCode || matchScan || matchLoc || matchAtt;
      }
      return true;
    });
  }, [tickets, filter, search]);

  const counts = useMemo(() => {
    const all = tickets.length;
    const active = tickets.filter((t) => t.status === 'valid' && !t.activeListingId && t.entryStatus !== 'checked_in').length;
    const listed = tickets.filter((t) => Boolean(t.activeListingId)).length;
    const checkedIn = tickets.filter((t) => t.entryStatus === 'checked_in').length;
    const voidCount = tickets.filter((t) => t.status === 'void').length;
    return { all, active, listed, checkedIn, voidCount };
  }, [tickets]);

  const expandedTicket = tickets.find((t) => t.id === expandedTicketId);

  return (
    <div className="max-w-3xl mx-auto px-4 py-5 space-y-5">
      {/* --- Header & Intro --- */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-xl bg-[#40916C]/10 text-[#40916C]">
                <Ticket className="w-5 h-5" />
              </span>
              <h2 className="text-xl font-black text-[var(--brief-ink)] tracking-tight">My tickets</h2>
            </div>
            <p className="text-xs text-[var(--ink-70)] max-w-xl leading-relaxed">
              Seats you hold, with the code the gate accepts right now. Every transfer issues a
              fresh code — old screenshots stop working, on purpose.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void fetchTickets()}
              disabled={load.status === 'loading'}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border border-[var(--brief-line)] bg-[color:var(--color-well)] text-[var(--brief-ink)] hover:bg-[color:var(--brief-line)] transition cursor-pointer"
              title="Refresh tickets"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${load.status === 'loading' ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            {onBrowseEvents && (
              <button
                onClick={onBrowseEvents}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-bold bg-[#40916C] text-[var(--accent-ink)] hover:opacity-90 transition cursor-pointer"
              >
                <span>Find Events</span>
              </button>
            )}
          </div>
        </div>

        {/* --- Quick Metrics Strip --- */}
        {load.status === 'ready' && tickets.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-[var(--brief-line)]">
            <div className="bg-[color:var(--color-well)] rounded-2xl p-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-60)]">Total Passes</p>
              <p className="text-lg font-black text-[var(--brief-ink)] leading-tight mt-0.5">{counts.all}</p>
            </div>
            <div className="bg-[color:var(--color-well)] rounded-2xl p-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#059669]">Ready to Scan</p>
              <p className="text-lg font-black text-[#059669] leading-tight mt-0.5">{counts.active}</p>
            </div>
            <div className="bg-[color:var(--color-well)] rounded-2xl p-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#40916C]">On Resale</p>
              <p className="text-lg font-black text-[#40916C] leading-tight mt-0.5">{counts.listed}</p>
            </div>
            <div className="bg-[color:var(--color-well)] rounded-2xl p-2.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#0891B2]">Checked In</p>
              <p className="text-lg font-black text-[#0891B2] leading-tight mt-0.5">{counts.checkedIn}</p>
            </div>
          </div>
        )}
      </div>

      {/* --- Notification Toast --- */}
      {notice && (
        <div className="flex items-center justify-between text-xs bg-[color:var(--color-well)] border border-[#0891B2]/40 rounded-2xl px-4 py-3 text-[var(--brief-ink)] animate-in fade-in">
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 text-[#0891B2] shrink-0" />
            <span>{notice}</span>
          </div>
          <button
            onClick={() => setNotice(null)}
            className="text-[var(--ink-50)] hover:text-[var(--brief-ink)] cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* --- Search & Filter Bar --- */}
      {load.status === 'ready' && tickets.length > 0 && (
        <div className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--ink-40)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by event name, venue, or ticket code…"
                className="w-full bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl pl-10 pr-4 py-2.5 text-xs text-[var(--brief-ink)] placeholder:text-[var(--ink-40)] focus:border-[#0891B2] focus:outline-none transition"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--ink-40)] hover:text-[var(--brief-ink)]"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => setFilter('all')}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                filter === 'all'
                  ? 'bg-[#40916C] text-[var(--accent-ink)] shadow-xs'
                  : 'bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-70)] hover:text-[var(--brief-ink)]'
              }`}
            >
              All Passes ({counts.all})
            </button>
            <button
              onClick={() => setFilter('active')}
              className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                filter === 'active'
                  ? 'bg-[#40916C] text-[var(--accent-ink)] shadow-xs'
                  : 'bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-70)] hover:text-[var(--brief-ink)]'
              }`}
            >
              Ready to Scan ({counts.active})
            </button>
            {counts.listed > 0 && (
              <button
                onClick={() => setFilter('listed')}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                  filter === 'listed'
                    ? 'bg-[#40916C] text-[var(--accent-ink)] shadow-xs'
                    : 'bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-70)] hover:text-[var(--brief-ink)]'
                }`}
              >
                On Resale ({counts.listed})
              </button>
            )}
            {counts.checkedIn > 0 && (
              <button
                onClick={() => setFilter('checked_in')}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                  filter === 'checked_in'
                    ? 'bg-[#40916C] text-[var(--accent-ink)] shadow-xs'
                    : 'bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-70)] hover:text-[var(--brief-ink)]'
                }`}
              >
                Checked In ({counts.checkedIn})
              </button>
            )}
            {counts.voidCount > 0 && (
              <button
                onClick={() => setFilter('void')}
                className={`shrink-0 px-3 py-1.5 rounded-xl text-xs font-extrabold transition cursor-pointer ${
                  filter === 'void'
                    ? 'bg-[#40916C] text-[var(--accent-ink)] shadow-xs'
                    : 'bg-[color:var(--color-paper)] border border-[var(--brief-line)] text-[var(--ink-70)] hover:text-[var(--brief-ink)]'
                }`}
              >
                Void ({counts.voidCount})
              </button>
            )}
          </div>
        </div>
      )}

      {/* --- Loading State --- */}
      {load.status === 'loading' && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl p-10 text-center space-y-3">
          <RefreshCw className="w-6 h-6 animate-spin text-[#40916C] mx-auto" />
          <p className="text-xs font-bold text-[var(--brief-ink)]">Loading your tickets…</p>
          <p className="text-[12px] text-[var(--ink-60)]">Verifying live gate pass versions from the ledger.</p>
        </div>
      )}

      {/* --- Error State --- */}
      {load.status === 'error' && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl p-6 text-center space-y-3">
          <AlertTriangle className="w-6 h-6 text-[#40916C] mx-auto" />
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">{load.error || 'Failed to load tickets'}</p>
          <button
            onClick={() => void fetchTickets()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-[#40916C] text-[var(--accent-ink)] cursor-pointer"
          >
            Try again
          </button>
        </div>
      )}

      {/* --- Empty State --- */}
      {load.status === 'ready' && tickets.length === 0 && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl p-8 text-center space-y-4">
          <div className="w-16 h-16 rounded-3xl bg-[color:var(--color-well)] border border-[var(--brief-line)] flex items-center justify-center mx-auto text-[var(--brief-ink)]">
            <Ticket className="w-8 h-8 text-[#40916C]" />
          </div>
          <div className="max-w-md mx-auto space-y-1.5">
            <h3 className="text-base font-extrabold text-[var(--brief-ink)]">No tickets yet</h3>
            <p className="text-xs text-[var(--ink-70)] leading-relaxed">
              Register for an event and confirm your seat — a ticket appears here the moment it
              is yours. Seats from public links belong to whoever holds that code, not to an account.
            </p>
          </div>
          {onBrowseEvents && (
            <button
              onClick={onBrowseEvents}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#40916C] text-[var(--accent-ink)] text-xs font-black hover:opacity-90 transition cursor-pointer shadow-sm"
            >
              <span>Explore What's On</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Educational Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-6 border-t border-[var(--brief-line)] text-left">
            <div className="bg-[color:var(--color-well)] rounded-2xl p-3.5 space-y-1">
              <p className="text-xs font-extrabold text-[var(--brief-ink)] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#0891B2]" />
                <span>Anti-Fraud QR</span>
              </p>
              <p className="text-[11px] text-[var(--ink-70)] leading-relaxed">
                Codes are versioned. Old screenshots die instantly upon any resale or transfer.
              </p>
            </div>
            <div className="bg-[color:var(--color-well)] rounded-2xl p-3.5 space-y-1">
              <p className="text-xs font-extrabold text-[var(--brief-ink)] flex items-center gap-1.5">
                <Gift className="w-3.5 h-3.5 text-[#40916C]" />
                <span>Gift Instantly</span>
              </p>
              <p className="text-[11px] text-[var(--ink-70)] leading-relaxed">
                Gift a seat directly to any friend's @handle. Fresh code issues straight to their wallet.
              </p>
            </div>
            <div className="bg-[color:var(--color-well)] rounded-2xl p-3.5 space-y-1">
              <p className="text-xs font-extrabold text-[var(--brief-ink)] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#059669]" />
                <span>Official Resale</span>
              </p>
              <p className="text-[11px] text-[var(--ink-70)] leading-relaxed">
                Can't make it? List your seat on the event's official resale market in Workflows → Sell.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* --- Filtered Empty State --- */}
      {load.status === 'ready' && tickets.length > 0 && filteredTickets.length === 0 && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl p-8 text-center space-y-2">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">No tickets match this filter</p>
          <p className="text-[12px] text-[var(--ink-60)]">Try changing your search term or select "All Passes".</p>
          <button
            onClick={() => { setSearch(''); setFilter('all'); }}
            className="text-xs font-bold text-[#0891B2] underline cursor-pointer mt-2"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* --- Ticket Cards List --- */}
      {load.status === 'ready' && filteredTickets.map((t) => {
        const isVoid = t.status === 'void';
        const isListed = Boolean(t.activeListingId);
        const isCheckedIn = t.entryStatus === 'checked_in';
        const isOfflineSaved = offlineSavedIds.has(t.id);
        const countdown = getCountdownLabel(t.eventStartsAt);
        const hasDelta = engineBar?.deltas && engineBar.deltas.length > 0 && engineBar.ticket?.ticketCode === t.code;

        return (
          <div
            key={t.id}
            className={`bg-[color:var(--color-paper)] border ${
              isVoid
                ? 'border-[var(--brief-line)] opacity-80'
                : isListed
                ? 'border-[#40916C]/50 shadow-sm'
                : 'border-[var(--brief-line)] hover:border-[#0891B2]/40 shadow-xs'
            } rounded-3xl overflow-hidden transition-all space-y-0`}
          >
            {/* Top Pass Header */}
            <div className="p-4 sm:p-5 pb-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-[color:var(--color-well)] text-[var(--brief-ink)]">
                      {t.eventType || 'Event Entry'}
                    </span>
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[color:var(--color-well)] text-[var(--ink-70)]">
                      Code version {t.codeVersion}
                    </span>
                    {countdown && !isVoid && (
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#40916C]/10 text-[#40916C]">
                        {countdown}
                      </span>
                    )}
                  </div>
                  <h3 className="text-base sm:text-lg font-black text-[var(--brief-ink)] leading-tight truncate">
                    {t.eventTitle ?? 'Event'}
                  </h3>
                </div>

                {/* Status Badges */}
                <div className="shrink-0">
                  {isVoid ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold bg-[color:var(--color-well)] text-[var(--ink-60)]">
                      <X className="w-3 h-3" />
                      <span>VOID</span>
                    </span>
                  ) : isCheckedIn ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#059669]/10 text-[#059669] border border-[#059669]/20">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>CHECKED IN</span>
                    </span>
                  ) : isListed ? (
                    <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#40916C]/15 text-[var(--accent-ink)] border border-[#40916C]/30">
                      <Tag className="w-3 h-3 text-[#40916C]" />
                      <span>LISTED FOR RESALE</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-extrabold bg-[#059669]/10 text-[#059669] border border-[#059669]/30">
                      {/* A static fact gets a static dot: a pulse next to
                          "VALID PASS" reads as live movement, and nothing here
                          is moving — validity is checked on read. */}
                      <span className="w-1.5 h-1.5 rounded-full bg-[#059669]" />
                      <span>VALID PASS</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Event Schedule & Location */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 pt-3 border-t border-[var(--brief-line)]">
                <div className="flex items-center gap-2 text-xs text-[var(--ink-80)]">
                  <CalendarDays className="w-3.5 h-3.5 text-[#0891B2] shrink-0" />
                  <span className="truncate">{formatEventDate(t.eventStartsAt, t.eventEndsAt)}</span>
                </div>
                {t.eventLocation && (
                  <div className="flex items-center gap-2 text-xs text-[var(--ink-80)]">
                    <MapPin className="w-3.5 h-3.5 text-[#40916C] shrink-0" />
                    <span className="truncate">{t.eventLocation}</span>
                  </div>
                )}
              </div>

              {/* Dynamic Delta Notice (Engine Update) */}
              {hasDelta && (
                <div className="mt-3 flex items-start gap-2 bg-[color:var(--color-well)] border border-[#0891B2]/30 rounded-2xl p-2.5">
                  <AlertTriangle className="w-4 h-4 text-[#40916C] shrink-0 mt-0.5" />
                  <p className="text-[12px] text-[var(--brief-ink)] leading-snug">
                    <span className="font-extrabold">Event details updated:</span> The organiser updated event
                    timing or venue. Your gate pass code and version remain fully valid for entry.
                  </p>
                </div>
              )}
            </div>

            {/* Perforated Divider Ticket Notch */}
            <div className="relative flex items-center justify-between my-1 px-0 overflow-hidden">
              <div className="w-4 h-6 bg-[color:var(--color-well)] border-r border-[var(--brief-line)] rounded-r-full -ml-1" />
              <div className="flex-1 border-t-2 border-dashed border-[var(--brief-line)] mx-2" />
              <div className="w-4 h-6 bg-[color:var(--color-well)] border-l border-[var(--brief-line)] rounded-l-full -mr-1" />
            </div>

            {/* Gate Code & Scannable QR Body */}
            <div className="p-4 sm:p-5 pt-2">
              {!isVoid ? (
                <div className="flex flex-col sm:flex-row items-center gap-5">
                  <div className="relative shrink-0 group">
                    <TicketQr code={t.scanCode} />
                    <button
                      onClick={() => setExpandedTicketId(t.id)}
                      className="absolute inset-0 bg-black/40 text-white opacity-0 group-hover:opacity-100 transition rounded-2xl flex items-center justify-center gap-1.5 text-xs font-bold cursor-pointer"
                      title="Fullscreen Pass"
                    >
                      <Maximize2 className="w-4 h-4" />
                      <span>Expand Pass</span>
                    </button>
                  </div>

                  <div className="min-w-0 flex-1 space-y-2 text-center sm:text-left">
                    <div>
                      <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--ink-60)]">Gate Code</p>
                      <div className="flex items-center justify-center sm:justify-start gap-2 mt-0.5">
                        <p className="font-mono text-sm sm:text-base font-black text-[var(--brief-ink)] tracking-wider select-all break-all">
                          {t.scanCode}
                        </p>
                        <button
                          onClick={() => void copyToClipboard(t.scanCode, t.id)}
                          className="p-1.5 rounded-lg border border-[var(--brief-line)] bg-[color:var(--color-well)] hover:bg-[color:var(--brief-line)] text-[var(--brief-ink)] transition cursor-pointer"
                          title="Copy full code"
                        >
                          {copiedCode === t.id ? (
                            <Check className="w-3.5 h-3.5 text-[#059669]" />
                          ) : (
                            <Copy className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    <p className="text-[12px] text-[var(--ink-70)] leading-relaxed">
                      Show this at the gate. The <span className="font-bold text-[var(--brief-ink)]">#{t.codeVersion}</span> is the
                      version — a scan of an older version is refused.
                    </p>

                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 pt-1 text-[12px] text-[var(--ink-60)]">
                      <span>Admit: <strong className="text-[var(--brief-ink)] font-extrabold">1 Person</strong></span>
                      <span>·</span>
                      <span>Holder: <strong className="text-[var(--brief-ink)] font-extrabold">{t.attendeeName || 'You'}</strong></span>
                      {t.issuePrice !== undefined && (
                        <>
                          <span>·</span>
                          <span>Value: <strong className="text-[var(--brief-ink)] font-extrabold">{t.issuePrice > 0 ? money(t.issuePrice, t.currency) : 'Free'}</strong></span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-[color:var(--color-well)] rounded-2xl p-4 text-center space-y-1">
                  <p className="text-xs font-bold text-[var(--brief-ink)]">Pass Inactive / Void</p>
                  <p className="text-[12px] text-[var(--ink-60)]">
                    This ticket was voided by moderation review or returned after a refund. It cannot be scanned at the gate.
                  </p>
                </div>
              )}

              {/* Provenance & Seat History Timeline */}
              {t.transfers.length > 0 && (
                <div className="mt-4 pt-3 border-t border-[var(--brief-line)] space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-70)]">
                      This seat's history
                    </p>
                    <button
                      onClick={() => toggleHistory(t.id)}
                      className="text-[11px] font-bold text-[#0891B2] hover:underline cursor-pointer flex items-center gap-0.5"
                    >
                      <span>{historyOpenIds.has(t.id) ? 'Hide details' : `View ${t.transfers.length} events`}</span>
                      <ChevronDown className={`w-3 h-3 transition ${historyOpenIds.has(t.id) ? 'rotate-180' : ''}`} />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    {t.transfers.map((x, i) => (
                      <div key={i} className="flex items-center justify-between text-[12px] text-[var(--ink-70)] bg-[color:var(--color-well)] px-3 py-1.5 rounded-xl">
                        <span className="font-semibold text-[var(--brief-ink)]">
                          {KIND_LABEL[x.kind] ?? x.kind}
                        </span>
                        <span className="text-[11px] text-[var(--ink-60)]">
                          {new Date(x.at).toLocaleDateString('en-KE')} · code v{x.codeVersionAfter} issued
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Active Resale Listing Banner */}
              {isListed && (
                <div className="mt-4 p-3.5 rounded-2xl bg-[#40916C]/10 border border-[#40916C]/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-0.5">
                    <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                      Listed for resale {t.listingPrice ? `at ${money(t.listingPrice, t.currency)}` : ''}
                    </p>
                    <p className="text-[11px] text-[var(--ink-70)]">
                      Buyers can reserve this seat on the event's page. Money settles with you out-of-band.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      disabled={pullingListingId === t.activeListingId}
                      onClick={() => t.activeListingId && void pullListing(t.activeListingId)}
                      className="px-3 py-1.5 rounded-xl text-xs font-bold border border-[var(--brief-line)] bg-[color:var(--color-paper)] text-[var(--brief-ink)] hover:bg-[color:var(--color-well)] cursor-pointer disabled:opacity-40"
                    >
                      {pullingListingId === t.activeListingId ? 'Pulling…' : 'Pull listing'}
                    </button>
                    {onSell && (
                      <button
                        onClick={onSell}
                        className="px-3 py-1.5 rounded-xl text-xs font-bold bg-[#40916C] text-[var(--accent-ink)] hover:opacity-90 cursor-pointer"
                      >
                        Resale Desk
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Action Toolbar */}
              {!isVoid && !isListed && (
                <div className="mt-4 pt-3 border-t border-[var(--brief-line)] space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {onSell && (
                      <button
                        onClick={onSell}
                        className="text-xs font-bold px-3.5 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] hover:opacity-90 transition cursor-pointer shadow-xs"
                      >
                        Sell this seat
                      </button>
                    )}

                    {giftFor === t.id ? (
                      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto mt-2 sm:mt-0 p-2.5 bg-[color:var(--color-well)] rounded-2xl border border-[var(--brief-line)]">
                        <input
                          value={handle}
                          onChange={(e) => setHandle(e.target.value)}
                          placeholder="recipient handle (e.g. wanjiku)"
                          className="text-xs bg-[color:var(--color-paper)] text-[var(--brief-ink)] rounded-xl px-3 py-2 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none min-w-44"
                        />
                        <button
                          disabled={busy || !handle.trim()}
                          onClick={() => void gift(t.id)}
                          className="text-xs font-bold px-3 py-2 rounded-xl bg-[#0891B2] text-white cursor-pointer disabled:opacity-40"
                        >
                          {busy ? 'Gifting…' : 'Gift'}
                        </button>
                        <button
                          onClick={() => { setGiftFor(null); setHandle(''); setGiftError(null); }}
                          className="text-xs text-[var(--ink-60)] hover:text-[var(--brief-ink)] px-2 py-1 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setGiftFor(t.id); setGiftError(null); }}
                        className="text-xs font-bold px-3.5 py-2 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] hover:bg-[color:var(--color-well)] text-[var(--brief-ink)] transition cursor-pointer inline-flex items-center gap-1.5"
                      >
                        <Gift className="w-3.5 h-3.5 text-[#0891B2]" />
                        <span>Gift to someone</span>
                      </button>
                    )}

                    {/* Add to Calendar */}
                    <button
                      onClick={() => downloadIcs(t)}
                      className="text-xs font-bold px-3 py-2 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] hover:bg-[color:var(--color-well)] text-[var(--ink-80)] hover:text-[var(--brief-ink)] transition cursor-pointer inline-flex items-center gap-1.5"
                      title="Download calendar event (.ics)"
                    >
                      <Download className="w-3.5 h-3.5 text-[var(--ink-60)]" />
                      <span>Calendar</span>
                    </button>

                    {/* Offline Toggle */}
                    <button
                      onClick={() => toggleOfflineSave(t.id)}
                      className={`text-xs font-bold px-3 py-2 rounded-xl border transition cursor-pointer inline-flex items-center gap-1.5 ${
                        isOfflineSaved
                          ? 'border-[#059669]/40 bg-[#059669]/10 text-[#059669]'
                          : 'border-[var(--brief-line)] bg-[color:var(--color-paper)] hover:bg-[color:var(--color-well)] text-[var(--ink-80)]'
                      }`}
                      title="Save for offline access without internet"
                    >
                      <ShieldCheck className="w-3.5 h-3.5" />
                      <span>{isOfflineSaved ? 'Saved Offline' : 'Save Offline'}</span>
                    </button>
                  </div>

                  {giftFor === t.id && giftError && (
                    <p className="text-[12px] text-[#40916C] font-semibold">{giftError}</p>
                  )}
                </div>
              )}
            </div>
          </div>
        );
      })}

      {/* --- Expanded Fullscreen Pass Modal --- */}
      {expandedTicket && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-3xl max-w-md w-full p-6 space-y-5 shadow-2xl relative animate-in zoom-in-95">
            <button
              onClick={() => setExpandedTicketId(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-[color:var(--color-well)] text-[var(--brief-ink)] hover:bg-[color:var(--brief-line)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-center space-y-1">
              <span className="px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-[#40916C]/10 text-[#40916C]">
                {expandedTicket.eventType || 'Official Pass'}
              </span>
              <h3 className="text-lg font-black text-[var(--brief-ink)] leading-tight pt-1">
                {expandedTicket.eventTitle}
              </h3>
              <p className="text-xs text-[var(--ink-60)]">
                {formatEventDate(expandedTicket.eventStartsAt, expandedTicket.eventEndsAt)}
              </p>
            </div>

            <div className="flex flex-col items-center justify-center p-4 bg-[color:var(--color-well)] rounded-2xl border border-[var(--brief-line)]">
              <TicketQr code={expandedTicket.scanCode} size={220} />
              <p className="font-mono text-base font-black text-[var(--brief-ink)] mt-3 tracking-wider select-all">
                {expandedTicket.scanCode}
              </p>
              <p className="text-[11px] text-[var(--ink-60)] mt-1">
                Version {expandedTicket.codeVersion} · Present at venue entrance
              </p>
            </div>

            <div className="space-y-2 text-xs text-[var(--ink-80)]">
              {expandedTicket.eventLocation && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#40916C] shrink-0" />
                  <span>{expandedTicket.eventLocation}</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#059669] shrink-0" />
                <span>Holder: <strong>{expandedTicket.attendeeName || 'You'}</strong></span>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => downloadIcs(expandedTicket)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--brief-line)] text-xs font-bold text-[var(--brief-ink)] hover:bg-[color:var(--color-well)] cursor-pointer inline-flex items-center justify-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Save to Calendar</span>
              </button>
              <button
                onClick={() => setExpandedTicketId(null)}
                className="flex-1 py-2.5 rounded-xl bg-[color:var(--brief-ink)] text-white text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
