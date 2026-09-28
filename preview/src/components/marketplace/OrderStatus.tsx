import React from 'react';
import type { Order } from '../../api/types';
import { money } from './ListingCard';

/**
 * One order, from either side of the transaction.
 *
 * PAYMENT AND FULFILMENT ARE SHOWN AS TWO SEPARATE FACTS, because they are
 * two separate facts. An order can be delivered and unpaid, or paid and
 * undelivered. Collapsing them into one "complete" badge is how a marketplace
 * ends up claiming money arrived when it did not.
 *
 * `paid` is derived server-side from a settled ledger row. This component
 * never infers payment from a status: an order reading 'fulfilled' says
 * nothing at all about money.
 */

const STATUS_LABEL: Record<string, string> = {
  offered: 'Offered',
  ordered: 'Ordered',
  fulfilled: 'Fulfilled',
  settled: 'Settled',
  disputed: 'Disputed',
  cancelled: 'Cancelled'
};

const STATUS_STYLE: Record<string, string> = {
  ordered: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  fulfilled: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  settled: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  disputed: 'bg-[color:var(--color-paper)] text-[var(--brief-ink)]',
  cancelled: 'bg-[var(--brief-line)] text-[var(--ink-60)]',
  offered: 'bg-[var(--brief-line)] text-[var(--ink-60)]'
};

export interface OrderStatusProps {
  order: Order;
  /** 'buyer' shows buyer actions, 'vendor' shows seller actions. */
  perspective: 'buyer' | 'vendor';
  busy: boolean;
  onFulfil?: (id: string) => void;
  onDispute?: (id: string) => void;
  onCancel?: (id: string) => void;
  /** Vendor-only: settle a fulfilled order against the real ledger. */
  onSettle?: (id: string) => void;
}

export function OrderStatus({
  order,
  perspective,
  busy,
  onFulfil,
  onDispute,
  onCancel,
  onSettle
}: OrderStatusProps) {
  const canFulfil = perspective === 'vendor' && order.status === 'ordered';
  const canSettle = perspective === 'vendor' && order.status === 'fulfilled';
  const canDispute =
    perspective === 'buyer' && ['ordered', 'fulfilled', 'settled'].includes(order.status);
  const canCancel = order.status === 'ordered';

  return (
    <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-2xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-extrabold text-[var(--brief-ink)]">{order.listingTitle}</p>
          <p className="text-[11px] text-[var(--ink-60)]">
            {order.quantity} x {money(order.unitPrice, order.currency)}
          </p>
        </div>
        <span
          className={`shrink-0 text-[11px] px-2 py-0.5 rounded-full ${
            STATUS_STYLE[order.status] ?? 'bg-[var(--brief-line)] text-[var(--ink-60)]'
          }`}
        >
          {STATUS_LABEL[order.status] ?? order.status}
        </span>
      </div>

      <a href={`/track?order=${encodeURIComponent(order.id)}`} className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 underline underline-offset-2">Track order →</a>

      <a href={`/reviews/${encodeURIComponent(order.listingId)}`} className="inline-flex ml-3 text-[11px] font-bold text-emerald-700 underline underline-offset-2">Product reviews →</a>

      {/* The server's total, not a recomputation. */}
      <p className="text-sm font-extrabold text-[var(--brief-ink)]">
        {money(order.total, order.currency)}
      </p>

      {/* Payment stated as its own fact, always. Never inferred from status. */}
      <p className="text-[11px] text-[var(--ink-60)]">
        {order.paid
          ? 'Paid - settled transaction on record'
          : 'Not paid yet - no settled payment is on record for this order'}
      </p>

      {order.dispute && (
        <div className="bg-[color:var(--color-paper)] border border-[var(--brief-line)] rounded-xl p-2">
          <p className="text-[11px] font-extrabold text-[var(--brief-ink)]">Disputed</p>
          <p className="text-[11px] text-[var(--ink-60)]">{order.dispute.reason}</p>
        </div>
      )}

      {(canFulfil || canDispute || canCancel || canSettle) && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {canSettle && onSettle && (
            <button
              onClick={() => onSettle(order.id)}
              disabled={busy}
              className="px-3 py-1 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
            >
              Settle
            </button>
          )}
          {canFulfil && onFulfil && (
            <button
              onClick={() => onFulfil(order.id)}
              disabled={busy}
              className="px-3 py-1 rounded-full bg-[#40916C] text-[var(--accent-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
            >
              Mark fulfilled
            </button>
          )}
          {canDispute && onDispute && (
            <button
              onClick={() => onDispute(order.id)}
              disabled={busy}
              className="px-3 py-1 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] border border-[var(--brief-line)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
            >
              Report a problem
            </button>
          )}
          {canCancel && onCancel && (
            <button
              onClick={() => onCancel(order.id)}
              disabled={busy}
              className="px-3 py-1 rounded-full bg-[color:var(--color-paper)] text-[var(--brief-ink)] text-[11px] font-extrabold cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}
