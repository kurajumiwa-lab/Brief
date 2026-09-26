import React from 'react';
import * as briefApi from '../api/briefApi';
import type { ResaleListingRow, ResaleTicket, TicketOrder } from '../api/types';

// ---------------------------------------------------------------------------
// RESALE DESK — Workflows → Sell → Resale
//
// The seller's operating surface for the ticket market: list a seat you hold,
// watch its orders, confirm money that arrived out-of-band (which is what
// moves the seat — Brief never pretends it collected the money itself),
// refund when the ledger row says refunded, and cancel what is still yours.
//
// Every state here is the server's word: a refusal, a pending order, a sold
// listing. No optimistic "success" is ever shown.
// ---------------------------------------------------------------------------

const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString()}`;

const LISTING_LABEL: Record<string, string> = {
  active: 'Listed',
  pending: 'Held for a buyer',
  sold: 'Sold',
  cancelled: 'Cancelled',
  expired: 'Expired',
  removed: 'Removed by review'
};

const ORDER_LABEL: Record<string, string> = {
  pending: 'Waiting on payment',
  completed: 'Completed',
  cancelled: 'Cancelled',
  refunded: 'Refunded'
};

type Panel<T> = {
  status: 'loading' | 'ready' | 'error';
  data: T | null;
  error: string | null;
};

export function ResaleDesk() {
  const [tickets, setTickets] = React.useState<Panel<ResaleTicket[]>>({ status: 'loading', data: null, error: null });
  const [desk, setDesk] = React.useState<Panel<{ listings: ResaleListingRow[]; orders: TicketOrder[] }>>({ status: 'loading', data: null, error: null });

  const [listFor, setListFor] = React.useState<string | null>(null);
  const [price, setPrice] = React.useState('');
  const [note, setNote] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setTickets((p) => ({ ...p, status: 'loading', error: null }));
    setDesk((p) => ({ ...p, status: 'loading', error: null }));
    const [t, d] = await Promise.all([briefApi.getMyTickets(), briefApi.getMyResaleDesk()]);
    setTickets(t.ok ? { status: 'ready', data: t.data.tickets, error: null } : { status: 'error', data: null, error: t.error });
    setDesk(d.ok ? { status: 'ready', data: d.data, error: null } : { status: 'error', data: null, error: d.error });
  }, []);

  React.useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(true); setActionError(null); setNotice(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) { setActionError(res.error ?? 'that did not work'); return; }
    setNotice(done);
    setListFor(null); setPrice(''); setNote('');
    void load();
  };

  const listable = (tickets.data ?? []).filter((t) => t.status === 'valid' && !t.activeListingId);
  const listings = desk.data?.listings ?? [];
  const orders = desk.data?.orders ?? [];
  const activeListings = listings.filter((l) => l.status === 'active' || l.status === 'pending');
  const finishedListings = listings.filter((l) => l.status !== 'active' && l.status !== 'pending');

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h2 className="text-base font-extrabold text-[var(--brief-ink)]">Resale</h2>
        <p className="text-xs text-[var(--ink-60)] mt-1">
          Sell a seat you hold. Brief sets the price you type and never lets a buyer pay less;
          when money arrives out-of-band you confirm it — that confirmation is what moves the seat.
        </p>
      </div>

      {notice && (
        <div className="text-xs bg-[color:var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2.5 text-[var(--brief-ink)]">{notice}</div>
      )}
      {actionError && (
        <div className="text-xs border border-[#0891B2] rounded-xl px-3 py-2.5 text-[var(--brief-ink)]">{actionError}</div>
      )}

      {/* --- your seats ------------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)]">Seats you can list</h3>
        {tickets.status === 'loading' && <p className="text-xs text-[var(--ink-70)]">Loading your seats…</p>}
        {tickets.status === 'error' && (
          <div className="border border-[var(--brief-line)] rounded-xl p-4 text-center space-y-2">
            <p className="text-xs text-[var(--ink-70)]">{tickets.error}</p>
            <button onClick={() => void load()} className="text-xs font-bold text-[var(--brief-ink)] underline cursor-pointer">Try again</button>
          </div>
        )}
        {tickets.status === 'ready' && listable.length === 0 && (
          <div className="border border-[var(--brief-line)] rounded-xl p-5 text-center">
            <p className="text-xs font-bold text-[var(--brief-ink)]">Nothing to list right now</p>
            <p className="text-[12px] text-[var(--ink-60)] mt-1">
              Seats you hold appear here (My Layer → Kept → My tickets) unless they are already listed.
            </p>
          </div>
        )}
        {tickets.status === 'ready' && listable.map((t) => (
          <div key={t.id} className="border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs font-extrabold text-[var(--brief-ink)] truncate">{t.eventTitle ?? 'Event'}</p>
              <span className="text-[11px] text-[var(--ink-70)] shrink-0">code v{t.codeVersion}</span>
            </div>
            {listFor === t.id ? (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    inputMode="numeric"
                    placeholder="price in whole KES"
                    className="text-xs bg-[color:var(--color-paper)] text-[var(--brief-ink)] rounded-xl px-3 py-2 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none w-40"
                  />
                  <input
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="why you're selling (optional)"
                    className="flex-1 min-w-40 text-xs bg-[color:var(--color-paper)] text-[var(--brief-ink)] rounded-xl px-3 py-2 border border-[var(--brief-line)] focus:border-[#0891B2] focus:outline-none"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy || !price.trim()}
                    onClick={() => void act(
                      () => briefApi.createResaleListing(t.id, Number(price), note.trim() || undefined),
                      `Listed at ${money(Number(price), 'KES')}. Buyers see it in the event's resale section.`
                    )}
                    className="text-xs font-bold px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
                  >
                    Put it up for sale
                  </button>
                  <button onClick={() => { setListFor(null); setPrice(''); setNote(''); }} className="text-xs text-[var(--ink-60)] cursor-pointer">
                    Not now
                  </button>
                </div>
                <p className="text-[11px] text-[var(--ink-70)]">
                  Whole shillings only. The server refuses anything else — a fraction is a price nobody set.
                </p>
              </div>
            ) : (
              <button
                onClick={() => { setListFor(t.id); setActionError(null); }}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] cursor-pointer"
              >
                List this seat
              </button>
            )}
          </div>
        ))}
      </section>

      {/* --- active listings --------------------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)]">Your listings</h3>
        {desk.status === 'loading' && <p className="text-xs text-[var(--ink-70)]">Loading listings…</p>}
        {desk.status === 'error' && <p className="text-xs text-[var(--ink-70)]">{desk.error}</p>}
        {desk.status === 'ready' && activeListings.length === 0 && (
          <p className="text-[12px] text-[var(--ink-60)] border border-[var(--brief-line)] rounded-xl p-4">
            No active listings. When you list a seat it appears here with its orders.
          </p>
        )}
        {desk.status === 'ready' && activeListings.map((l) => {
          const held = orders.find((o) => o.listingId === l.id && o.status === 'pending');
          return (
            <div key={l.id} className="border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">{money(l.price, l.currency)}</p>
                  <p className="text-[11px] text-[var(--ink-70)] mt-0.5">{LISTING_LABEL[l.status] ?? l.status}</p>
                </div>
                {l.status === 'active' && (
                  <button
                    disabled={busy}
                    onClick={() => void act(() => briefApi.cancelResaleListing(l.id), 'Listing pulled. The seat is yours to list again.')}
                    className="text-xs px-3 py-2 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] cursor-pointer disabled:opacity-40"
                  >
                    Pull listing
                  </button>
                )}
              </div>
              {held && (
                <div className="border-t border-[var(--brief-line)] pt-2 space-y-2">
                  <p className="text-[12px] text-[var(--ink-80)]">
                    A buyer is holding this seat at {money(held.total, held.currency)} ({ORDER_LABEL[held.status]}).
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      disabled={busy}
                      onClick={() => void act(
                        () => briefApi.confirmTicketOrderReceived(held.id),
                        `Payment confirmed — the seat moved to the buyer and their code is live. Recorded in the ledger.`
                      )}
                      className="text-xs font-bold px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
                    >
                      I received {money(held.total, held.currency)}
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => void act(() => briefApi.refundTicketOrder(held.id), 'Refunded — the seat is back with you and the buyer\u2019s code is dead.')}
                      className="text-xs px-3 py-2 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] cursor-pointer disabled:opacity-40"
                    >
                      Refund instead
                    </button>
                  </div>
                  <p className="text-[11px] text-[var(--ink-70)]">
                    Only confirm money that actually arrived. The confirmation writes a settled row to
                    the ledger under your name — it is your attestation, auditable.
                  </p>
                </div>
              )}
            </div>
          );
        })}
        {desk.status === 'ready' && finishedListings.length > 0 && (
          <div className="space-y-1">
            {finishedListings.map((l) => (
              <p key={l.id} className="text-[11px] text-[var(--ink-70)] flex items-center justify-between border-b border-[#EFF1F4] pb-1">
                <span>{money(l.price, l.currency)} · {LISTING_LABEL[l.status] ?? l.status}{l.removedReason ? ` — ${l.removedReason}` : ''}</span>
                <span>{new Date(l.createdAt).toLocaleDateString()}</span>
              </p>
            ))}
          </div>
        )}
      </section>

      {/* --- orders where you are the buyer -------------------------------- */}
      <section className="space-y-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)]">Seats you are buying</h3>
        {desk.status !== 'ready' && <p className="text-xs text-[var(--ink-70)]">Loading orders…</p>}
        {(() => {
          if (desk.status !== 'ready') return null;
          // Seller orders are the ones sitting under my own listings; every
          // other order has me on the buyer side.
          const myListingIds = new Set(listings.map((l) => l.id));
          const asBuyer = orders.filter((o) => !myListingIds.has(o.listingId));
          if (asBuyer.length === 0) {
            return (
              <p className="text-[12px] text-[var(--ink-60)] border border-[var(--brief-line)] rounded-xl p-4">
                No open purchases. When you buy a resale seat from an event's page, payment happens with
                the seller and is tracked here until the seat is yours.
              </p>
            );
          }
          return asBuyer.map((o) => (
            <div key={o.id} className="border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
              <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                {money(o.total, o.currency)} · {ORDER_LABEL[o.status] ?? o.status}
              </p>
              {o.status === 'pending' ? (
                <>
                  <p className="text-[12px] text-[var(--ink-70)]">
                    Arrange {money(o.total, o.currency)} with the seller. When they confirm receiving it, the
                    seat moves to you and your code appears in My tickets. Brief cannot collect this payment
                    itself — no provider is connected.
                  </p>
                  <button
                    disabled={busy}
                    onClick={() => void act(() => briefApi.cancelTicketOrder(o.id), 'Order cancelled — the seat is back on the market.')}
                    className="text-xs px-3 py-2 rounded-xl border border-[var(--brief-line)] text-[var(--brief-ink)] cursor-pointer disabled:opacity-40"
                  >
                    Cancel this order
                  </button>
                </>
              ) : o.status === 'completed' ? (
                <p className="text-[12px] text-[var(--ink-70)]">
                  Completed — the seat is in My tickets under your code. A refund returns it to the seller;
                  ask here and the seller confirms it from their listing.
                </p>
              ) : (
                <p className="text-[12px] text-[var(--ink-70)]">This order is closed.</p>
              )}
            </div>
          ));
        })()}
      </section>
    </div>
  );
}
