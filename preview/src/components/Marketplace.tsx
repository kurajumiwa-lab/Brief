import React from 'react';
import * as briefApi from '../api/briefApi';
import type {
  Dispute, Listing, ListingDestinationKindDraft, ListingFlowDraft, ListingOriginKindDraft, Order, Vendor, VendorEarnings
} from '../api/types';
import { ListingCard } from './marketplace/ListingCard';
import { ListingDetail } from './marketplace/ListingDetail';
import { VendorProfile } from './marketplace/VendorProfile';
import { OrderStatus } from './marketplace/OrderStatus';
import { PayOrder } from './marketplace/PayOrder';
import { VendorPanel } from './marketplace/VendorPanel';

/**
 * MARKETPLACE -- standalone local commerce.
 *
 *     Vendor -> Listing -> Order -> Fulfilment -> Transaction
 *
 * Commerce here does NOT require a campaign. A campaign is an organised
 * activity with registration; a listing is something a seller is offering.
 * Both exist, and buying a hoodie does not create an event.
 *
 * Rules held throughout:
 *
 *   - MONEY IS SERVER-DERIVED. The order total displayed anywhere in this
 *     tree is the number the server returned. The quantity picker shows an
 *     estimate and says so.
 *   - AN ORDER IS NOT A PAYMENT. `paid` comes from a settled ledger row.
 *     Fulfilment and payment are rendered as two separate facts.
 *   - Authority is enforced by the SERVER. Actions are hidden when they
 *     would be refused, which is courtesy, not protection.
 *   - Empty means empty. Nothing is seeded to make the marketplace look busy.
 */

type Section = 'browse' | 'orders' | 'selling';

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'browse', label: 'Browse' },
  { id: 'orders', label: 'My orders' },
  { id: 'selling', label: 'Selling' }
];

type View =
  | { kind: 'list' }
  | { kind: 'listing'; id: string }
  | { kind: 'vendor'; id: string };

export interface MarketplaceProps {
  /** Which section to open on mount. 'selling' deep-links to the post-a-listing flow. */
  initialSection?: Section;
  /** Mine is yours. The board is the browse. Hiding it here is how Mine
      stops being a third public shelf of the same listings. */
  hideBrowse?: boolean;
}

// No `currentUserId` prop, on purpose: it was declared with a default of
// 'usr_me' and never read — a fake identity parked in the bundle, in a component
// whose ownership already comes from the server (`/api/listings/mine`). A name
// that means nothing is a bug waiting for someone to trust it.
export function Marketplace({ initialSection = 'browse', hideBrowse = false }: MarketplaceProps = {}) {
  const start: Section = hideBrowse && initialSection === 'browse' ? 'orders' : initialSection;
  const [section, setSection] = React.useState<Section>(start);
  const [view, setView] = React.useState<View>({ kind: 'list' });

  const [listings, setListings] = React.useState<{
    status: 'idle' | 'loading' | 'ready' | 'error';
    data: Listing[];
    error: string | null;
  }>({ status: 'idle', data: [], error: null });

  const [detail, setDetail] = React.useState<Listing | null>(null);
  const [vendorView, setVendorView] = React.useState<{ vendor: Vendor; listings: Listing[] } | null>(null);
  const [myOrders, setMyOrders] = React.useState<Order[]>([]);
  const [ordersStatus, setOrdersStatus] = React.useState<'idle' | 'ready' | 'failed' | 'denied'>('idle');
  const [ordersAttempt, setOrdersAttempt] = React.useState(0);
  const [myVendor, setMyVendor] = React.useState<Vendor | null>(null);
  const [myListings, setMyListings] = React.useState<Listing[]>([]);
  const [vendorOrders, setVendorOrders] = React.useState<Order[]>([]);
  const [earnings, setEarnings] = React.useState<VendorEarnings | null>(null);
  const [disputes, setDisputes] = React.useState<Dispute[]>([]);
  // A per-order "the server's own record, fetched fresh" view. Not a local
  // copy of what we already hold — a real GET /api/orders/:id behind a button,
  // because reading one order deeply had no surface at all.
  const [fresh, setFresh] = React.useState<Record<string, Order | 'loading' | 'error'>>({});

  const [quantity, setQuantity] = React.useState(1);
  const [delivery, setDelivery] = React.useState({email:'',address:'',instructions:''});
  const [busyId, setBusyId] = React.useState<string | null>(null);
  // Survives re-renders without causing one: the key must stay stable across
  // a retry, and changing it must never trigger a refetch.
  const orderKeyRef = React.useRef<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const [vendorDraft, setVendorDraft] = React.useState({
    displayName: '', description: '', contactMethod: ''
  });
  const [listingDraft, setListingDraft] = React.useState<{
    title: string; description: string; price: string;
    type: Listing['type']; quantity: string; location: string;
    flow: ListingFlowDraft; commodity: string; originKind: ListingOriginKindDraft; originName: string;
    destinationKind: ListingDestinationKindDraft; destinationName: string; unit: string; minOrder: string;
    /** Uploaded photos, in the order the seller put them in. */
    media: string[];
  }>({
    title: '', description: '', price: '', type: 'product', quantity: '', location: '',
    flow: '', commodity: '', originKind: '', originName: '',
    destinationKind: '', destinationName: '', unit: '', minOrder: '', media: []
  });

  // --- loaders -------------------------------------------------------------

  const loadBrowse = React.useCallback(async () => {
    setListings((s) => ({ ...s, status: 'loading' }));
    const res = await briefApi.getListings();
    if (res.ok) setListings({ status: 'ready', data: res.data, error: null });
    else setListings({ status: 'error', data: [], error: res.error });
  }, []);

  const loadOrders = React.useCallback(async () => {
    const res = await briefApi.getMyOrders();
    if (res.ok) {
      setMyOrders(res.data);
      setOrdersStatus('ready');
    } else {
      setMyOrders([]);
      setOrdersStatus(res.status === 401 ? 'denied' : 'failed');
    }
    // Disputes I raised: the other half of "report a problem" — the report
    // used to vanish into the server with no way to see it again.
    const d = await briefApi.getDisputes();
    if (d.ok) setDisputes(d.data);
  }, []);

  const loadSelling = React.useCallback(async () => {
    const mine = await briefApi.getMyListings();
    if (mine.ok) {
      setMyVendor(mine.data.vendor);
      setMyListings(mine.data.listings);
    }
    const ords = await briefApi.getVendorOrders();
    if (ords.ok) setVendorOrders(ords.data);
    // Derived server-side from settled orders only. Absent for a seller who
    // has not sold anything -- not rendered as a zero balance.
    const earn = await briefApi.getMyEarnings();
    setEarnings(earn.ok ? earn.data : null);
  }, []);

  React.useEffect(() => {
    if (section === 'browse') void loadBrowse();
    if (section === 'orders') void loadOrders();
    if (section === 'selling') void loadSelling();
  }, [section, loadBrowse, loadOrders, loadSelling, ordersAttempt]);

  /**
   * Run a mutation, then REFETCH rather than patching local state. The server
   * is authoritative about status, stock and money; a local guess would be a
   * second source of truth that drifts.
   */
  const run = React.useCallback(
    async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, after: () => Promise<void>) => {
      setBusyId(id);
      setNotice(null);
      const res = await fn();
      // A server refusal is surfaced verbatim -- the reason is the useful part.
      if (!res.ok) setNotice(res.error ?? 'That did not work.');
      await after();
      setBusyId(null);
      return res.ok;
    },
    []
  );

  // --- actions -------------------------------------------------------------

  const openListing = async (id: string) => {
    setDelivery({email:'',address:'',instructions:''});
    setQuantity(1);
    setNotice(null);
    orderKeyRef.current = null;
    const res = await briefApi.getListing(id);
    if (res.ok) {
      setDetail(res.data);
      setView({ kind: 'listing', id });
    } else {
      setNotice(res.error);
    }
  };

  const openVendor = async (id: string) => {
    const res = await briefApi.getVendor(id);
    if (res.ok) {
      setVendorView(res.data);
      setView({ kind: 'vendor', id });
    } else {
      setNotice(res.error);
    }
  };

  const placeOrder = async () => {
    if (!detail) return;
    // One key per (listing, quantity) attempt on this screen. A double-tap,
    // a retry or a flaky connection therefore resolves to the SAME order
    // rather than committing the buyer twice. Regenerated once an order
    // succeeds, so deliberately buying the same thing again still works.
    const key = orderKeyRef.current ?? (orderKeyRef.current = `${detail.id}:${quantity}:${Date.now()}`);
    const ok = await run(
      detail.id,
      // Only order inputs and optional delivery details are sent. There is no price
      // field: the server derives the money from the listing row.
      () => briefApi.createOrder({ listingId: detail.id, quantity, delivery, idempotencyKey: key }),
      async () => {
        await loadBrowse();
        await loadOrders();
        const again = await briefApi.getListing(detail.id);
        if (again.ok) setDetail(again.data);
      }
    );
    if (ok) {
      orderKeyRef.current = null;
      setDelivery({email:'',address:'',instructions:''});
      setNotice('Order placed. It is not paid yet - arrange payment with the seller.');
      setSection('orders');
      setView({ kind: 'list' });
    }
  };

  const createVendor = () =>
    run(
      'vendor',
      () =>
        briefApi.createVendor({
          displayName: vendorDraft.displayName,
          description: vendorDraft.description,
          contactMethod: vendorDraft.contactMethod || null
        }),
      loadSelling
    );

  const createListing = async () => {
    const price = Number(listingDraft.price);
    const qty = listingDraft.quantity.trim() === '' ? null : Number(listingDraft.quantity);
    const ok = await run(
      'listing',
      () =>
        briefApi.createListing({
          title: listingDraft.title,
          description: listingDraft.description,
          price,
          type: listingDraft.type,
          quantityAvailable: qty,
          locationName: listingDraft.location || null,
          // The flow axes travel as declared values. Blank stays absent rather
          // than becoming 'unclassified' or a guessed warehouse.
          flow: listingDraft.flow || null,
          commodity: listingDraft.commodity.trim() || null,
          originKind: listingDraft.originKind || null,
          originName: listingDraft.originName.trim() || null,
          destinationKind: listingDraft.destinationKind || null,
          destinationName: listingDraft.destinationName.trim() || null,
          unitLabel: listingDraft.unit.trim() || null,
          minOrderQuantity: listingDraft.minOrder.trim() === '' ? null : Number(listingDraft.minOrder),
          // The photos go with the offer at creation. The server normalises them
          // (`cleanMedia`: strings only, trimmed, de-duplicated, capped), so what
          // lands is what was really uploaded — and a listing created here is no
          // longer a name and a price while the same offer, edited later, takes eight.
          media: listingDraft.media
        }),
      loadSelling
    );
    if (ok) {
      setListingDraft({
        title: '', description: '', price: '', type: 'product', quantity: '', location: '',
        flow: '', commodity: '', originKind: '', originName: '',
        destinationKind: '', destinationName: '', unit: '', minOrder: '', media: []
      });
    }
  };

  const setStatus = (id: string, status: Listing['status']) =>
    run(id, () => briefApi.setListingStatus(id, status), loadSelling);

  const fulfil = (id: string) => run(id, () => briefApi.fulfilOrder(id), loadSelling);

  // Settlement: the server refuses unless a SETTLED ledger transaction covers
  // the order. With no payment provider connected that refusal is the honest
  // outcome and is shown verbatim — the loop exists end to end, the money is
  // not pretended in the meantime.
  const settle = (id: string) => run(id, () => briefApi.settleOrder(id), loadSelling);

  const cancel = (id: string) => run(id, () => briefApi.cancelOrder(id), loadOrders);

  const dispute = (id: string) =>
    run(
      id,
      // A fixed reason keeps this batch's dispute primitive small. The reason
      // is stored and shown; arbitration and refunds are deliberately absent.
      () => briefApi.disputeOrder(id, 'Reported a problem with this order'),
      loadOrders
    );

  /** Fetch one order's current record straight from the server. */
  const loadFresh = async (id: string) => {
    if (fresh[id] && fresh[id] !== 'error') { setFresh((p) => { const q = { ...p }; delete q[id]; return q; }); return; }
    setFresh((p) => ({ ...p, [id]: 'loading' }));
    const res = await briefApi.getOrder(id);
    setFresh((p) => ({ ...p, [id]: res.ok ? res.data : 'error' }));
  };


  // --- render --------------------------------------------------------------

  const tabs = (
    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar mb-4">
      {(hideBrowse ? SECTIONS.filter((s) => s.id !== 'browse') : SECTIONS).map((s) => (
        <button
          key={s.id}
          onClick={() => {
            setSection(s.id);
            setView({ kind: 'list' });
            setNotice(null);
          }}
          className={`shrink-0 px-3 py-1.5 rounded-full text-[12px] font-extrabold border cursor-pointer transition ${
            section === s.id
              ? 'bg-[#40916C] text-[var(--accent-ink)] border-[#0891B2]'
              : 'bg-[color:var(--color-paper)] text-[var(--ink-70)] border-[var(--brief-line)]'
          }`}
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  if (view.kind === 'listing' && detail) {
    return (
      <div>
        {tabs}
        <ListingDetail
          listing={detail}
          quantity={quantity}
          onQuantityChange={(q) => { orderKeyRef.current = null; setQuantity(q); }}
          delivery={delivery}
          onDeliveryChange={setDelivery}
          onOrder={placeOrder}
          onBack={() => setView({ kind: 'list' })}
          onViewVendor={openVendor}
          busy={busyId === detail.id}
          notice={notice}
        />
      </div>
    );
  }

  if (view.kind === 'vendor' && vendorView) {
    return (
      <div>
        {tabs}
        <VendorProfile
          vendor={vendorView.vendor}
          listings={vendorView.listings}
          onBack={() => setView({ kind: 'list' })}
          onOpenListing={openListing}
        />
      </div>
    );
  }

  return (
    <div>
      {tabs}

      {section === 'browse' && (
        <div className="space-y-2">
          {listings.status === 'loading' && (
            <p className="text-xs text-[var(--ink-60)]">Loading listings...</p>
          )}
          {listings.status === 'error' && (
            <p className="text-xs text-[var(--brief-ink)]">{listings.error}</p>
          )}
          {listings.status === 'ready' && listings.data.length === 0 && (
            // Honest empty state. Nothing is invented to fill the screen.
            <p className="text-xs text-[var(--ink-60)]">
              Nothing is listed yet. When someone nearby offers something, it appears here.
            </p>
          )}
          {listings.data.map((l) => (
            <ListingCard key={l.id} listing={l} onOpen={openListing} />
          ))}
        </div>
      )}

      {section === 'orders' && (
        <div className="space-y-2">
          {notice && <p className="text-[11px] text-[var(--brief-ink)]">{notice}</p>}
          {ordersStatus === 'denied' ? (
            <p className="text-xs text-[var(--ink-60)]">Sign in to see what you bought.</p>
          ) : ordersStatus === 'failed' ? (
            <div className="space-y-2" role="status">
              <p className="text-sm font-bold" style={{ color: 'var(--color-text)' }}>
                Your orders could not be read just now.
              </p>
              <p className="text-[12px]" style={{ color: 'var(--color-text-muted)' }}>
                Nothing is shown in their place — no empty history, no invented delivery.
              </p>
              <button
                type="button"
                onClick={() => setOrdersAttempt((n) => n + 1)}
                className="inline-flex items-center px-3.5 py-2 rounded-full text-xs font-black cursor-pointer"
                style={{ background: 'var(--color-primary)', color: 'var(--accent-ink)' }}
              >
                Try again
              </button>
            </div>
          ) : myOrders.length === 0 ? (
            <p className="text-xs text-[var(--ink-60)]">You have not ordered anything yet.</p>
          ) : (
            myOrders.map((o) => (
              <React.Fragment key={o.id}>
                <OrderStatus
                  order={o}
                  perspective="buyer"
                  busy={busyId === o.id}
                  onDispute={dispute}
                  onCancel={cancel}
                />
                <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-2">
                  <button
                    onClick={() => void loadFresh(o.id)}
                    className="text-[11px] font-extrabold text-[var(--ink-60)] cursor-pointer"
                  >
                    {fresh[o.id] && fresh[o.id] !== 'error' ? 'Hide record' : 'Server record'}
                  </button>
                  {fresh[o.id] === 'loading' && (
                    <p className="text-[11px] text-[var(--ink-60)] mt-1">Fetching this order's current record…</p>
                  )}
                  {fresh[o.id] === 'error' && (
                    <p className="text-[11px] text-[var(--brief-ink)] mt-1">Could not load this order.</p>
                  )}
                  {fresh[o.id] && fresh[o.id] !== 'loading' && fresh[o.id] !== 'error' && (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] text-[var(--ink-60)]">
                      {JSON.stringify(fresh[o.id], null, 2)}
                    </pre>
                  )}
                </div>
                {/* Checkout lives here, only for an unpaid, uncancelled order.
                    A paid order shows no pay form; a cancelled one is final. */}
                {!o.paid && o.status !== 'cancelled' && o.status !== 'disputed' && (
                  <PayOrder order={o} onPaid={loadOrders} />
                )}
              </React.Fragment>
            ))
          )}
          {disputes.length > 0 && (
            <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2">
              <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
                Problems you reported
              </h4>
              {disputes.map((d) => (
                <div key={d.id} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold text-[var(--brief-ink)] truncate">{d.reason}</p>
                    <p className="text-[11px] text-[var(--ink-60)]">
                      {d.orderId} · raised {d.createdAt.slice(0, 10)}
                    </p>
                  </div>
                  <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)]">
                    {d.status}
                  </span>
                </div>
              ))}
              <p className="text-[11px] text-[var(--ink-60)]">
                A dispute marks the order as contested. No refund is implied —
                no money has moved.
              </p>
            </div>
          )}
        </div>
      )}

      {section === 'selling' && (
        <VendorPanel
          vendor={myVendor}
          listings={myListings}
          orders={vendorOrders}
          earnings={earnings}
          busyId={busyId}
          notice={notice}
          draft={vendorDraft}
          onDraftChange={(p) => setVendorDraft((d) => ({ ...d, ...p }))}
          onCreateVendor={createVendor}
          listingDraft={listingDraft}
          onListingDraftChange={(p) => setListingDraft((d) => ({ ...d, ...p }))}
          onCreateListing={createListing}
          onSetStatus={setStatus}
          onFulfil={fulfil}
          onSettle={settle}
        />
      )}
    </div>
  );
}
