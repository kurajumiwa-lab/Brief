import React from 'react';
import type { Listing } from '../../api/types';
import { money } from './ListingCard';

/**
 * A single listing, with the order action.
 *
 * THE TOTAL SHOWN HERE IS A PREVIEW, NOT AN AUTHORITY. It is computed for
 * display so the buyer knows roughly what they are committing to, but the
 * server recomputes it from the listing row when the order is placed and the
 * order carries the server's number. If the two ever disagreed, the server
 * would win -- which is why the order confirmation shows the server total
 * rather than echoing this one back.
 */

export interface ListingDetailProps {
  delivery?: {email:string;address:string;instructions:string};
  onDeliveryChange?: (value:{email:string;address:string;instructions:string}) => void;
  listing: Listing;
  quantity: number;
  onQuantityChange: (q: number) => void;
  onOrder: () => void;
  onBack: () => void;
  onViewVendor: (vendorId: string) => void;
  busy: boolean;
  notice: string | null;
}

export function ListingDetail({
  delivery, onDeliveryChange,
  listing,
  quantity,
  onQuantityChange,
  onOrder,
  onBack,
  onViewVendor,
  busy,
  notice
}: ListingDetailProps) {
  // Stock-tracked listings cap the selector at what actually exists; a
  // service has no cap because there is nothing to run out of.
  const max = listing.quantityAvailable ?? 99;
  const previewTotal = listing.price * quantity;

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
      >
        Back to marketplace
      </button>

      <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-2">
        <h3 className="text-sm font-extrabold text-[var(--brief-ink)]">{listing.title}</h3>
        <p className="text-lg font-extrabold text-[var(--brief-ink)]">
          {money(listing.price, listing.currency)}
        </p>

        {listing.description && (
          <p className="text-xs text-[var(--ink-60)] whitespace-pre-wrap">{listing.description}</p>
        )}

        {listing.locationName && (
          <p className="text-[11px] text-[var(--ink-60)]">Location: {listing.locationName}</p>
        )}

        {listing.quantityAvailable !== null && (
          <p className="text-[11px] text-[var(--ink-60)]">
            {listing.quantityAvailable > 0
              ? `${listing.quantityAvailable} available`
              : 'None available'}
          </p>
        )}

        {listing.vendor && (
          <button
            onClick={() => onViewVendor(listing.vendor!.id)}
            className="text-[11px] font-extrabold text-[var(--brief-ink)] cursor-pointer"
          >
            Sold by {listing.vendor.displayName}
          </button>
        )}
      </div>

      <a href={`/reviews/${encodeURIComponent(listing.id)}`} className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 underline underline-offset-2">Customer reviews →</a>

      {listing.orderable ? (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-extrabold text-[var(--ink-60)]">
              Quantity
            </span>
            <button
              onClick={() => onQuantityChange(Math.max(1, quantity - 1))}
              className="w-7 h-7 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] font-extrabold cursor-pointer"
            >
              -
            </button>
            <span className="text-xs font-extrabold text-[var(--brief-ink)] w-6 text-center">{quantity}</span>
            <button
              onClick={() => onQuantityChange(Math.min(max, quantity + 1))}
              className="w-7 h-7 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] font-extrabold cursor-pointer"
            >
              +
            </button>
          </div>

          <p className="text-[11px] text-[var(--ink-60)]">
            Estimated total {money(previewTotal, listing.currency)} - confirmed by the server when
            you order
          </p>

          {delivery && onDeliveryChange && <details className="text-xs space-y-2">
            <summary className="cursor-pointer font-bold">Delivery & guest tracking (optional)</summary>
            <p className="text-[var(--ink-60)]">Track without signing in using this email and your order number. Keep your order number private.</p>
            <label className="block">Tracking email<input type="email" maxLength={254} value={delivery.email} onChange={e=>onDeliveryChange({...delivery,email:e.target.value})} className="block w-full rounded-lg border p-2 mt-1" placeholder="Uses your account email if available" /></label>
            <label className="block">Delivery address<textarea maxLength={500} value={delivery.address} onChange={e=>onDeliveryChange({...delivery,address:e.target.value})} className="block w-full rounded-lg border p-2 mt-1" /></label>
            <label className="block">Delivery instructions<textarea maxLength={500} value={delivery.instructions} onChange={e=>onDeliveryChange({...delivery,instructions:e.target.value})} className="block w-full rounded-lg border p-2 mt-1" /></label>
          </details>}
          <button
            onClick={onOrder}
            disabled={busy}
            className="w-full py-2 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-xs font-extrabold cursor-pointer disabled:opacity-50"
          >
            {busy ? 'Placing order...' : 'Place order'}
          </button>

          <p className="text-[11px] text-[var(--ink-60)]">
            Placing an order does not pay for it. You arrange payment with the seller directly.
          </p>
        </div>
      ) : (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-4">
          <p className="text-xs text-[var(--brief-ink)]">
            {listing.unorderableReason ?? 'This listing is not available.'}
          </p>
        </div>
      )}

      {notice && <p className="text-[11px] text-[var(--brief-ink)]">{notice}</p>}
    </div>
  );
}
