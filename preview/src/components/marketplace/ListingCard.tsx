import React from 'react';
import type { Listing } from '../../api/types';
import * as briefApi from '../../api/briefApi';

/**
 * One listing in a browse grid.
 *
 * Shows only what the server actually returned. A listing with no location or
 * no stock figure simply omits that line rather than printing "Location: --",
 * which reads as a missing value the seller forgot to fill in.
 *
 * Ratings are derived on the product reviews page, not guessed or cached on
 * this compact listing projection. No invented "popular" badge belongs here.
 */

const TYPE_LABEL: Record<string, string> = {
  product: 'Product',
  service: 'Service',
  experience: 'Experience',
  event: 'Event'
};

export function money(amount: number, currency: string) {
  // Whole shillings: Brief prices are not fractional, and a trailing ".00"
  // reads like a system that expects cents it never has.
  return `${currency} ${amount.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
}

export interface ListingCardProps {
  listing: Listing;
  onOpen: (id: string) => void;
}

export function ListingCard({ listing, onOpen }: ListingCardProps) {
  return (
    <button
      onClick={() => onOpen(listing.id)}
      className="w-full text-left bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-1.5 cursor-pointer hover:border-[var(--brief-line)] transition"
    >
      <div className="flex items-start justify-between gap-3">
        {(listing.media ?? [])[0] ? (
          <img src={briefApi.mediaFileUrl((listing.media ?? [])[0]!)} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" />
        ) : null}
        <p className="text-xs font-extrabold text-[var(--brief-ink)] min-w-0 flex-1">{listing.title}</p>
        <span className="shrink-0 text-[11px] px-2 py-0.5 rounded-full bg-[var(--brief-line)] text-[var(--ink-60)]">
          {TYPE_LABEL[listing.type] ?? listing.type}
        </span>
      </div>

      <p className="text-sm font-extrabold text-[var(--brief-ink)]">
        {money(listing.price, listing.currency)}
      </p>

      {listing.vendor && (
        <p className="text-[11px] text-[var(--ink-60)]">{listing.vendor.displayName}</p>
      )}

      {/* Optional by design: a mobile service has no single location. */}
      {listing.locationName && (
        <p className="text-[11px] text-[var(--ink-60)]">{listing.locationName}</p>
      )}

      {/* Stock only when it is genuinely tracked. null means "not tracked",
          which is different from zero and must not render as "0 left". */}
      {listing.quantityAvailable !== null && listing.quantityAvailable > 0 && (
        <p className="text-[11px] text-[var(--ink-60)]">{listing.quantityAvailable} available</p>
      )}

      {!listing.orderable && listing.unorderableReason && (
        <p className="text-[11px] text-[var(--brief-ink)]">{listing.unorderableReason}</p>
      )}
    </button>
  );
}
