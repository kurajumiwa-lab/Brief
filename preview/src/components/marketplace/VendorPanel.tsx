import React from 'react';
import { BoostSheet } from '../BoostSheet';
import type {
  Listing, ListingDestinationKindDraft, ListingFlowDraft, ListingOriginKindDraft, Order, Vendor, VendorEarnings
} from '../../api/types';
import { money } from './ListingCard';
import { ImageField } from '../ImageField';
import * as briefApi from '../../api/briefApi';
import { OrderStatus } from './OrderStatus';

/**
 * The seller's side: become a vendor, manage listings, see incoming orders.
 *
 * Deliberately not a dashboard. There are no charts, no revenue headline and
 * no "this week" comparison, because none of those numbers exist honestly --
 * no payment provider is connected, so any revenue figure would be invented.
 * What a seller gets is the list of what they are offering and the list of
 * what people have ordered.
 *
 * Lifecycle actions are offered only where the server would allow them. That
 * is a convenience: the server enforces the transition table regardless.
 */

/**
 * How many photos one offer carries, mirrored from the server's `MEDIA_CAP`
 * (`server/src/domain/listing.js`), which the suite compares against the source
 * so the counter on this form cannot disagree with what will actually be stored.
 */
export const MEDIA_CAP = 8;

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-[var(--brief-line)] text-[var(--ink-60)]',
  active: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  paused: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  sold_out: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  archived: 'bg-[var(--brief-line)] text-[var(--ink-60)]'
};

// Which moves the UI offers from each state. Mirrors the server's table; the
// server is still the thing that decides.
const NEXT_ACTIONS: Record<string, { status: Listing['status']; label: string }[]> = {
  draft: [{ status: 'active', label: 'Publish' }, { status: 'archived', label: 'Archive' }],
  active: [{ status: 'paused', label: 'Pause' }, { status: 'archived', label: 'Archive' }],
  paused: [{ status: 'active', label: 'Resume' }, { status: 'archived', label: 'Archive' }],
  sold_out: [{ status: 'active', label: 'Relist' }, { status: 'archived', label: 'Archive' }],
  archived: []
};

export interface VendorPanelProps {
  vendor: Vendor | null;
  listings: Listing[];
  orders: Order[];
  /** Derived from settled orders. null when nothing has settled. */
  earnings?: VendorEarnings | null;
  busyId: string | null;
  notice: string | null;
  draft: { displayName: string; description: string; contactMethod: string };
  onDraftChange: (patch: Partial<VendorPanelProps['draft']>) => void;
  onCreateVendor: () => void;
  listingDraft: {
    title: string; description: string; price: string; type: Listing['type'];
    quantity: string; location: string;
    /** The two axes of a flow. Optional, except where a flow needs them. */
    flow: ListingFlowDraft; commodity: string; originKind: ListingOriginKindDraft; originName: string;
    destinationKind: ListingDestinationKindDraft; destinationName: string; unit: string; minOrder: string;
    /** The seller's own uploaded files, in the order a buyer sees them. */
    media?: string[];
  };
  onListingDraftChange: (patch: Partial<VendorPanelProps['listingDraft']>) => void;
  onCreateListing: () => void;
  onSetStatus: (id: string, status: Listing['status']) => void;
  onFulfil: (id: string) => void;
  /** Settle a fulfilled order. Refused server-side until money has really settled. */
  onSettle: (id: string) => void;
}

export function VendorPanel({
  vendor,
  listings,
  orders,
  earnings,
  busyId,
  notice,
  draft,
  onDraftChange,
  onCreateVendor,
  listingDraft,
  onListingDraftChange,
  onCreateListing,
  onSetStatus,
  onFulfil,
  onSettle
}: VendorPanelProps) {
  const [promoteFor, setPromoteFor] = React.useState<Listing | null>(null);
  // --- not a seller yet ----------------------------------------------------
  if (!vendor) {
    return (
      <div className="space-y-3">
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
          <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
            Start selling
          </h4>
          <p className="text-xs text-[var(--ink-60)]">
            A seller profile lets you list products, services and experiences.
          </p>
          <input
            value={draft.displayName}
            onChange={(e) => onDraftChange({ displayName: e.target.value })}
            placeholder="Business or trading name"
            className="w-full bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
          <input
            value={draft.description}
            onChange={(e) => onDraftChange({ description: e.target.value })}
            placeholder="What do you offer?"
            className="w-full bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
          <input
            value={draft.contactMethod}
            onChange={(e) => onDraftChange({ contactMethod: e.target.value })}
            placeholder="How should buyers reach you?"
            className="w-full bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
          <button
            onClick={onCreateVendor}
            disabled={busyId === 'vendor'}
            className="w-full py-2 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-xs font-extrabold cursor-pointer disabled:opacity-50"
          >
            Create seller profile
          </button>
          {notice && <p className="text-[11px] text-[var(--brief-ink)]">{notice}</p>}
        </div>
      </div>
    );
  }

  const pendingOrders = orders.filter((o) => o.status === 'ordered');

  return (
    <div className="space-y-4">
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
        <h4 className="text-sm font-extrabold text-[var(--brief-ink)]">{vendor.displayName}</h4>
        {vendor.description && <p className="text-xs text-[var(--ink-60)]">{vendor.description}</p>}
        {vendor.verification.facts.map((f) => (
          <p key={f.kind} className="text-[11px] text-[var(--ink-60)]">
            {f.label}
          </p>
        ))}
      </div>

      {/* --- earnings -------------------------------------------------------
          Shown ONLY when money has genuinely settled. A seller with no
          settled orders sees nothing here rather than "KES 0", which reads
          like a balance they could withdraw. */}
      {earnings && earnings.orderCount > 0 && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-1">
          <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
            Settled earnings
          </h4>
          <p className="text-lg font-extrabold text-[var(--brief-ink)]">
            {money(earnings.net, earnings.currency)}
          </p>
          <p className="text-[11px] text-[var(--ink-60)]">
            From {earnings.orderCount} settled order{earnings.orderCount === 1 ? '' : 's'} -{' '}
            {money(earnings.gross, earnings.currency)} less {money(earnings.commission, earnings.currency)}{' '}
            platform commission
          </p>
          {/* The distinction that matters: earned is not withdrawable. */}
          {!earnings.payoutAvailable && (
            <p className="text-[11px] text-[var(--brief-ink)]">{earnings.payoutReason}</p>
          )}
        </div>
      )}

      {/* --- new listing ---------------------------------------------------- */}
      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
        <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
          New listing
        </h4>
        <input
          value={listingDraft.title}
          onChange={(e) => onListingDraftChange({ title: e.target.value })}
          placeholder="What are you offering?"
          className="w-full bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
        />
        <input
          value={listingDraft.description}
          onChange={(e) => onListingDraftChange({ description: e.target.value })}
          placeholder="Description"
          className="w-full bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
        />

        {/* --- photos -------------------------------------------------------
            This form had no photo control, so an offer created here could only
            ever be a name and a price — while the same offer, edited afterwards
            from a space's catalog, takes up to eight. The control is that one
            (ImageField: a file in, the server sniffs the bytes and its refusal is
            shown word for word). What is NOT here: a stock image, an "example
            photo" or a placeholder frame. A buyer reads whatever appears on an
            offer as the goods, so a picture the seller did not supply is a lie
            about the shop. */}
        <div className="space-y-1.5 rounded-xl p-2.5" style={{ background: 'var(--color-well)' }}>
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>
              Photos
            </p>
            <p className="text-[11px] font-bold tabular-nums" style={{ color: 'var(--color-text-muted)' }}>
              {(listingDraft.media ?? []).length}/{MEDIA_CAP}
            </p>
          </div>
          {(listingDraft.media ?? []).map((src, i) => (
            <div key={`${src}-${i}`} className="flex items-center gap-2 rounded-xl bg-[color:var(--color-paper)] px-2 py-1.5">
              <img src={briefApi.mediaFileUrl(src)} alt="" loading="lazy" className="h-10 w-14 shrink-0 rounded-lg object-cover" />
              <p className="min-w-0 flex-1 truncate text-[11px]" style={{ color: 'var(--color-text-muted)' }}>{src}</p>
              <button
                type="button"
                aria-label={`Remove photo ${i + 1} from this listing`}
                onClick={() => onListingDraftChange({ media: (listingDraft.media ?? []).filter((_, j) => j !== i) })}
                className="shrink-0 text-[11px] font-bold underline cursor-pointer"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Remove
              </button>
            </div>
          ))}
          {(listingDraft.media ?? []).length === 0 && (
            <p className="text-[11px] leading-snug" style={{ color: 'var(--color-text-muted)' }}>
              No photo yet. Buyers see the name and the price alone — and a photo of something else is not a
              photo of this.
            </p>
          )}
          {(listingDraft.media ?? []).length < MEDIA_CAP && (
            <ImageField
              compact
              multiple
              label="Add a photo of these goods"
              hint="The file, not a link. The server decides what the bytes really are."
              onAdd={(url) => onListingDraftChange({ media: [...(listingDraft.media ?? []), url].slice(0, MEDIA_CAP) })}
            />
          )}
        </div>
        <div className="flex gap-2">
          <input
            value={listingDraft.price}
            onChange={(e) => onListingDraftChange({ price: e.target.value })}
            placeholder="Price"
            inputMode="numeric"
            className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
          <select
            value={listingDraft.type}
            onChange={(e) => onListingDraftChange({ type: e.target.value as Listing['type'] })}
            className="bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          >
            <option value="product">Product</option>
            <option value="service">Service</option>
            <option value="experience">Experience</option>
            <option value="event">Event</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={listingDraft.quantity}
            onChange={(e) => onListingDraftChange({ quantity: e.target.value })}
            placeholder="Quantity (blank for services)"
            inputMode="numeric"
            className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
          <input
            value={listingDraft.location}
            onChange={(e) => onListingDraftChange({ location: e.target.value })}
            placeholder="Location (optional)"
            className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
          />
        </div>
        {/* --- the flow: who it is going to, and where it comes from ---------
             The endpoints are the seller's words. Bulk is refused by the server
             without both, because "bulk" without a route is a sticker, not a
             supply chain. Everything here is optional for a service or a
             one-off, and the board shows 'no flow declared' rather than guessing. */}
        <div className="pt-1.5 border-t border-[var(--brief-line)] space-y-2">
          <p className="text-[11px] font-extrabold uppercase tracking-wider text-[var(--ink-60)]">
            Where this fits in the supply board (optional)
          </p>
          <div className="flex gap-2">
            <select
              aria-label="Flow"
              value={listingDraft.flow}
              onChange={(e) => onListingDraftChange({ flow: e.target.value as ListingFlowDraft })}
              className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
            >
              <option value="">No flow — just a listing</option>
              <option value="bulk">Bulk — for vendors &amp; shops</option>
              <option value="direct">Direct — from the source</option>
              <option value="niche">Niche — curated for consumers</option>
              <option value="group">Group — pooled demand</option>
            </select>
            <input
              aria-label="Commodity"
              value={listingDraft.commodity}
              onChange={(e) => onListingDraftChange({ commodity: e.target.value })}
              placeholder="Commodity (tomatoes)"
              className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
            />
          </div>
          {(listingDraft.flow === 'bulk' || listingDraft.flow === 'direct' || listingDraft.flow === 'group') && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <input
                  aria-label="Origin place"
                  value={listingDraft.originName}
                  onChange={(e) => onListingDraftChange({ originName: e.target.value })}
                  placeholder={listingDraft.flow === 'direct' ? 'The source (Kamau Dairy, Limuru)' : 'Leaves from (Wakulima Market)'}
                  className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
                />
                <select
                  aria-label="Origin kind"
                  value={listingDraft.originKind}
                  onChange={(e) => onListingDraftChange({ originKind: e.target.value as ListingOriginKindDraft })}
                  className="bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-2 py-2 text-xs text-[var(--brief-ink)] outline-none"
                >
                  <option value="">kind…</option>
                  <option value="warehouse">warehouse / market</option>
                  <option value="source">source (farm, fishery)</option>
                  <option value="producer">producer (mill, dairy)</option>
                  <option value="manufacturer">manufacturer</option>
                  <option value="importer">importer</option>
                </select>
              </div>
              {listingDraft.flow !== 'direct' && (
                <div className="flex gap-2">
                  <input
                    aria-label="Destination place"
                    value={listingDraft.destinationName}
                    onChange={(e) => onListingDraftChange({ destinationName: e.target.value })}
                    placeholder={listingDraft.flow === 'group' ? 'The pool (Kileleshwa flats)' : 'Goes to (Kilimani shops)'}
                    className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
                  />
                  <select
                    aria-label="Who it is for"
                    value={listingDraft.destinationKind}
                    onChange={(e) => onListingDraftChange({ destinationKind: e.target.value as ListingDestinationKindDraft })}
                    className="bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-2 py-2 text-xs text-[var(--brief-ink)] outline-none"
                  >
                    <option value="">buyer…</option>
                    <option value="vendors">shops &amp; vendors</option>
                    <option value="consumers">households</option>
                    <option value="pool">a pool / co-op</option>
                  </select>
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              aria-label="Unit label"
              value={listingDraft.unit}
              onChange={(e) => onListingDraftChange({ unit: e.target.value })}
              placeholder="unit (crate, sack, litre)"
              className="flex-1 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
            />
            <input
              aria-label="Minimum order"
              value={listingDraft.minOrder}
              onChange={(e) => onListingDraftChange({ minOrder: e.target.value })}
              placeholder="min order (5)"
              inputMode="numeric"
              className="w-32 bg-[var(--color-well)] border border-[var(--brief-line)] rounded-xl px-3 py-2 text-xs text-[var(--brief-ink)] outline-none"
            />
          </div>
        </div>

        <button
          onClick={onCreateListing}
          disabled={busyId === 'listing'}
          className="w-full py-2 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-xs font-extrabold cursor-pointer disabled:opacity-50"
        >
          Create listing
        </button>
        <p className="text-[11px] text-[var(--ink-60)]">
          New listings start as a draft. Publish when you are ready to take orders.
        </p>
        {notice && <p className="text-[11px] text-[var(--brief-ink)]">{notice}</p>}
      </div>

      {/* --- my listings ----------------------------------------------------- */}
      <div className="space-y-2">
        <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
          My listings
        </h4>
        {listings.length === 0 ? (
          <p className="text-xs text-[var(--ink-60)]">You have not listed anything yet.</p>
        ) : (
          listings.map((l) => (
            <div key={l.id} className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2">
              <div className="flex items-start justify-between gap-3">
                {(l.media ?? [])[0] ? (
                  <img src={briefApi.mediaFileUrl((l.media ?? [])[0])} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                ) : null}
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[var(--brief-ink)]">{l.title}</p>
                  <p className="text-[11px] text-[var(--ink-60)]">
                    {money(l.price, l.currency)}
                    {l.quantityAvailable !== null ? ` - ${l.quantityAvailable} left` : ''}
                  </p>
                </div>
                <span
                  className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
                    STATUS_STYLE[l.status] ?? 'bg-[var(--brief-line)] text-[var(--ink-60)]'
                  }`}
                >
                  {l.status}
                </span>
              </div>
              {(NEXT_ACTIONS[l.status] ?? []).length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {l.status === 'active' && (
                <button
                  type="button"
                  onClick={() => setPromoteFor(l)}
                  className="mr-1.5 cursor-pointer rounded-full border border-[#40916C] px-3 py-1 text-[11px] font-extrabold text-[#40916C] hover:bg-[var(--color-well)]"
                >
                  Promote
                </button>
              )}
              {(NEXT_ACTIONS[l.status] ?? []).map((a) => (
                    <button
                      key={a.status}
                      onClick={() => onSetStatus(l.id, a.status)}
                      disabled={busyId === l.id}
                      className="px-3 py-1 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* --- orders received -------------------------------------------------- */}
      <div className="space-y-2">
        <h4 className="text-[12px] font-extrabold text-[var(--ink-60)]">
          Orders received{pendingOrders.length > 0 ? ` (${pendingOrders.length} to fulfil)` : ''}
        </h4>
        {orders.length === 0 ? (
          <p className="text-xs text-[var(--ink-60)]">No one has ordered from you yet.</p>
        ) : (
          orders.map((o) => (
            <OrderStatus
              key={o.id}
              order={o}
              perspective="vendor"
              busy={busyId === o.id}
              onFulfil={onFulfil}
              onSettle={o.status === 'fulfilled' ? onSettle : undefined}
            />
          ))
        )}
      </div>

      {promoteFor && (
        <BoostSheet
          listingId={promoteFor.id}
          listingTitle={promoteFor.title}
          onClose={() => setPromoteFor(null)}
        />
      )}
    </div>
  );
}
