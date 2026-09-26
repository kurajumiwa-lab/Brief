import React from 'react';
import * as briefApi from '../api/briefApi';
import type { ResaleListing, TicketOrder } from '../api/types';

// ---------------------------------------------------------------------------
// EVENT RESALE — the event's own resale section (public campaign context)
//
// Commerce only inside context: these listings exist because this event's
// seats do. Prices are the sellers' and the server's — this surface displays
// them, it never computes them. Buying opens an order at the listed price;
// money itself is settled with the seller and confirmed by them, which is
// stated here plainly rather than hidden behind a fake checkout.
// ---------------------------------------------------------------------------

const money = (amount: number, currency: string) => `${currency} ${amount.toLocaleString()}`;

export function EventResale({ slug }: { slug: string }) {
  const [load, setLoad] = React.useState<{
    status: 'loading' | 'ready' | 'error';
    data: ResaleListing[] | null;
    error: string | null;
  }>({ status: 'loading', data: null, error: null });

  const [order, setOrder] = React.useState<TicketOrder | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const fetchListings = React.useCallback(async () => {
    setLoad({ status: 'loading', data: null, error: null });
    const res = await briefApi.getEventResaleListings(slug);
    if (res.ok) setLoad({ status: 'ready', data: res.data.listings, error: null });
    else setLoad({ status: 'error', data: null, error: res.error });
  }, [slug]);

  React.useEffect(() => { void fetchListings(); }, [fetchListings]);

  const buy = async (listingId: string) => {
    setBusy(true); setError(null);
    const res = await briefApi.openTicketOrder(listingId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      // Someone may have beaten us to it; re-read the market.
      void fetchListings();
      return;
    }
    setOrder(res.data.order);
  };

  const cancel = async () => {
    if (!order) return;
    setBusy(true); setError(null);
    const res = await briefApi.cancelTicketOrder(order.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setOrder(null);
    void fetchListings();
  };

  if (load.status === 'loading') {
    return (
      <div className="border-t border-[var(--brief-line)] pt-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)] mb-2">Resale tickets</h3>
        <p className="text-xs text-[var(--ink-70)] py-2">Checking for resale seats…</p>
      </div>
    );
  }

  // A resale section that cannot load says so — it never shows an empty
  // market that may not be empty.
  if (load.status === 'error') {
    return (
      <div className="border-t border-[var(--brief-line)] pt-4 space-y-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)]">Resale tickets</h3>
        <p className="text-[12px] text-[var(--ink-70)]">Resale seats could not be loaded right now. {load.error}</p>
        <button onClick={() => void fetchListings()} className="text-xs font-bold text-[var(--brief-ink)] underline cursor-pointer">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="border-t border-[var(--brief-line)] pt-4 space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-70)]">Resale tickets</h3>
        <span className="text-[11px] text-[var(--ink-60)]">{load.data?.length ?? 0} listed</span>
      </div>

      {load.data?.length === 0 && (
        <p className="text-[12px] text-[var(--ink-60)]">
          No resale seats right now. Official tickets, when this event sells them, are above — resale
          appears here once holders list a seat they cannot use.
        </p>
      )}

      {order && (
        <div className="border border-[#0891B2] rounded-2xl p-4 space-y-2 bg-[color:var(--color-well)]">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">
            Order {order.reference} — {money(order.total, order.currency)} held for you
          </p>
          <p className="text-[12px] text-[var(--ink-75)]">
            The seat is held at this price. Payment goes to the seller directly — Brief has no payment
            provider and will not pretend to charge you. When the seller confirms receiving{' '}
            {money(order.total, order.currency)}, the seat moves to you with a fresh code in
            My Layer → My tickets.
          </p>
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => void cancel()}
              className="text-xs px-3 py-2 rounded-xl border border-[var(--brief-line)] bg-[color:var(--color-paper)] text-[var(--brief-ink)] cursor-pointer disabled:opacity-40"
            >
              Let it go
            </button>
          </div>
          <p className="text-[11px] text-[var(--ink-70)]">
            Track this order under Workflows → Sell → Resale.
          </p>
        </div>
      )}

      {error && <p className="text-[12px] text-[var(--brief-ink)]">{error}</p>}

      <div className="space-y-2">
        {load.data?.map((l) => (
          <div key={l.id} className="border border-[var(--brief-line)] rounded-2xl p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-extrabold text-[var(--brief-ink)]">
                {money(l.price, l.currency)} {l.cheapest && <span className="text-[11px] font-bold text-[var(--ink-70)]">· cheapest</span>}
              </p>
              <p className="text-[11px] text-[var(--ink-70)] truncate">
                {l.seller?.displayName ?? 'A Brief member'}
                {l.seller?.joinedAt ? ` · member since ${new Date(l.seller.joinedAt).getFullYear()}` : ''}
                {l.transferCount > 0 ? ` · resold ${l.transferCount}×` : ''}
              </p>
              {l.note && <p className="text-[11px] text-[var(--ink-60)] mt-0.5">“{l.note}”</p>}
            </div>
            <button
              disabled={busy || Boolean(order)}
              onClick={() => void buy(l.id)}
              className="shrink-0 text-xs font-bold px-3 py-2 rounded-xl bg-[#40916C] text-[var(--accent-ink)] cursor-pointer disabled:opacity-40"
            >
              Buy
            </button>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[var(--ink-60)]">
        Every transfer re-issues the seat's code; a printed or screenshotted old code stops working.
      </p>
    </div>
  );
}
