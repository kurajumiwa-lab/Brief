// ---------------------------------------------------------------------------
// ORDER
//
// An Order is a customer's commitment to a Listing.
//
// THE CENTRAL RULE OF THIS FILE:
//
//     The server derives the money. The client never supplies it.
//
// createOrder() accepts a listingId and a quantity. It does NOT accept price,
// unitPrice, total, currency or amount, and it does not read them if they are
// present in the payload. Price is read from the listing row at order time and
// the total is arithmetic. A client posting {price: 1, total: 1} against a
// 500/unit listing gets an order for the real amount.
//
// This matters most for Batch 4: a payment rail attaches to these numbers. A
// forged total today becomes forged money later.
//
// AN ORDER IS NOT A PAYMENT.
//
//     order != paid
//
// Creating an order moves no money and settles nothing. `settled` is reached
// only when a real settled ledger transaction backs it -- and since no payment
// provider is connected, that transition is driven by the existing ledger,
// never fabricated here.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { deliveryFields } from './orderTracking.js';
import { store, newId } from '../store.js';
import * as referrals from './referrals.js';
import * as listings from './listing.js';
import { personIdForUser } from './person.js';

export const ORDER_STATUS = [
  'offered', 'ordered', 'accepted', 'preparing', 'ready',
  'fulfilled', 'settled', 'disputed', 'cancelled'
];

/**
 * The fulfilment stages a vendor moves an order through. Separated from the
 * terminal/economic states so the client can render a progress path without
 * hardcoding the vocabulary.
 */
export const FULFILMENT_FLOW = ['ordered', 'accepted', 'preparing', 'ready', 'fulfilled'];

// Server-authoritative transition table.
//
// Deliberately absent, because each would be a lie about what happened:
//   fulfilled -> ordered   (un-delivering something already delivered)
//   settled   -> ordered   (un-paying)
//   settled   -> fulfilled (money already changed hands; going back loses that)
//
// `disputed` is reachable from ordered/fulfilled/settled because a contest can
// arise at any of those points. It is terminal in this batch: resolution means
// refunds and arbitration, which are explicitly deferred. Rather than invent
// half a resolution flow, a disputed order stays visibly contested.
const VALID_TRANSITIONS = {
  offered: ['ordered', 'cancelled'],
  // The intermediate stages are OPTIONAL. A trader handing over a bag of
  // flour has no "preparing" step, so ordered -> fulfilled stays legal; a
  // kitchen that wants the detail can walk the whole path. Forcing every
  // seller through five states would make most of them lie.
  ordered: ['accepted', 'preparing', 'ready', 'fulfilled', 'disputed', 'cancelled'],
  accepted: ['preparing', 'ready', 'fulfilled', 'disputed', 'cancelled'],
  preparing: ['ready', 'fulfilled', 'disputed', 'cancelled'],
  ready: ['fulfilled', 'disputed', 'cancelled'],
  fulfilled: ['settled', 'disputed'],
  settled: ['disputed'],
  disputed: [],
  cancelled: []
};

/**
 * Place an order.
 *
 * @param listingId  what is being bought
 * @param buyerId    resolved from the authenticated caller by the route --
 *                   never from the request body
 * @param quantity   whole number >= 1
 */
export function createOrder({ listingId, buyerId, quantity = 1, delivery = null, note = '', idempotencyKey = null, leadAgentId = null }) {
  if (!buyerId) throw new Error('buyerId is required');

  // DUPLICATE SUBMISSION PROTECTION.
  //
  // A double-tapped "Place order" button, a retried request or a flaky mobile
  // connection must not create two commitments to the same thing. When the
  // caller supplies a key, an existing order for that (buyer, key) pair is
  // returned as-is rather than a second row being written.
  if (idempotencyKey) {
    const prior = store.find(
      'orders',
      (o) => o.buyerId === buyerId && o.idempotencyKey === idempotencyKey
    );
    if (prior) return hydrate(prior);
  }

  const listing = store.find('listings', (l) => l.id === listingId);
  if (!listing) throw new Error('listing not found');

  const vendor = store.find('vendors', (v) => v.id === listing.vendorId);
  if (!vendor) throw new Error('vendor not found');

  // A vendor ordering from themselves would create fake demand and fake sales
  // history on their own shelf.
  if (vendor.ownerId === buyerId) {
    throw new Error('a vendor cannot order from their own listing');
  }

  // A FIELD AGENT is the third party who generated this lead (a rider or
  // door-to-door agent). It must be a real member, and it can never be the
  // buyer or the vendor — otherwise a self-dealing party could mint a lead
  // reward on their own transaction, which would be a farming hole, not a
  // lead. The reward itself is minted only at fulfilment, in referrals.js.
  if (leadAgentId != null) {
    if (!store.find('users', (u) => u.id === leadAgentId)) {
      throw new Error('lead agent not found');
    }
    if (leadAgentId === buyerId) {
      throw new Error('a buyer cannot be the lead agent for their own order');
    }
    if (leadAgentId === vendor.ownerId) {
      throw new Error('a vendor cannot be the lead agent for their own listing');
    }
  }

  // A quantity must be a sane whole number. Number.isInteger(1e308) is TRUE
  // -- a float that large has no fractional part -- so the integer check
  // alone let 1e308 through and produced an Infinity total that serialised
  // to JSON `null`. An order whose total is null is an order whose price is
  // undefined, which is exactly what must never reach the ledger.
  const MAX_QUANTITY = 10000;
  if (!Number.isSafeInteger(quantity) || quantity < 1) {
    throw new Error('quantity must be a whole number of one or more');
  }
  if (quantity > MAX_QUANTITY) {
    throw new Error(`quantity may not exceed ${MAX_QUANTITY} per order`);
  }

  // Availability is checked HERE, on the write path. Rendering a disabled
  // button is presentation; this is the refusal that actually holds.
  const check = listings.orderableReason(listing);
  if (!check.ok) throw new Error(check.reason);

  if (listing.quantityAvailable !== null && quantity > listing.quantityAvailable) {
    throw new Error(`only ${listing.quantityAvailable} available`);
  }

  // ---- MONEY IS DERIVED, NOT ACCEPTED ------------------------------------
  // Read from the listing row, multiplied by a validated quantity. Nothing
  // the caller sent participates in this calculation.
  const unitPrice = listing.price;
  const total = unitPrice * quantity;
  const currency = listing.currency;

  // Defence in depth at the money boundary: even with a validated quantity,
  // an absurd listing price could overflow. A non-finite total must never be
  // persisted -- it becomes `null` in JSON and silently erases the amount.
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error('order total is not a valid amount');
  }

  const now = new Date().toISOString();
  const order = {
    // Public tracking uses this reference plus an email. New references must
    // not be timestamp/Math.random guesses. Existing references stay valid.
    id: `ord_${crypto.randomBytes(16).toString('hex')}`,
    listingId: listing.id,
    // Which space's book this lands in, copied from the listing at creation.
    // Stamped, not looked up later: a listing can be re-filed, and an order
    // must keep saying where the sale actually happened. null is honest — the
    // listing belonged to no space when the order was placed.
    spaceId: listing.spaceId ?? null,
    // Snapshot of what was bought. The listing may later be edited or
    // archived; an order must still say what it was actually for.
    listingTitle: listing.title,
    listingType: listing.type,
    listingImage: listing.media?.[0] || null,
    ...deliveryFields(delivery, store.find('users', u => u.id === buyerId)?.email),
    buyerId,
    personId: personIdForUser(buyerId),
    vendorId: vendor.id,
    vendorOwnerId: vendor.ownerId,
    quantity,
    unitPrice,
    total,
    currency,
    note: String(note ?? ''),
    idempotencyKey: idempotencyKey ?? null,
    leadAgentId: leadAgentId ?? null,
    status: 'ordered',
    // Set only when a real settled transaction backs this order. Until then
    // the order is explicitly unpaid, and the UI says so.
    transactionId: null,
    fulfilledAt: null,
    settledAt: null,
    history: [{ status: 'ordered', at: now }],
    createdAt: now,
    updatedAt: now
  };
  // All three economic rows commit in one atomic file swap. An injected disk
  // failure (or stock validation error) restores the entire pre-order snapshot.
  store.transaction(() => {
    store.insert('orders', order);
    listings.consumeStock(listing.id, quantity, { orderId: order.id });
  });

  return hydrate(order);
}

/**
 * Attach the payment picture. `paid` is derived from a SETTLED ledger row --
 * there is no stored paid flag, because a boolean written next to the money
 * is a second source of truth waiting to disagree with it.
 */
function hydrate(order) {
  const tx = order.transactionId
    ? store.find('ledgerTransactions', (t) => t.id === order.transactionId)
    : null;
  const dispute = store.find('disputes', (d) => d.orderId === order.id) ?? null;

  return {
    ...order,
    paid: Boolean(tx && tx.status === 'settled'),
    // Stated plainly rather than implied by the absence of a field.
    paymentStatus: tx ? tx.status : 'unpaid',
    transaction: tx
      ? { id: tx.id, status: tx.status, amount: tx.amount, currency: tx.currency }
      : null,
    dispute: dispute
      ? {
          id: dispute.id,
          reason: dispute.reason,
          status: dispute.status,
          reportedBy: dispute.reportedBy,
          createdAt: dispute.createdAt
        }
      : null
  };
}

export function getOrder(id) {
  const o = store.find('orders', (x) => x.id === id);
  return o ? hydrate(o) : null;
}

/**
 * Orders visible to a party.
 *
 * `buyerId` returns what I bought; `vendorId` returns what I sold. A caller
 * with neither would be asking for everyone's orders, so routes always pass
 * one -- there is no "all orders" view for a normal user.
 */
export function listOrders({ buyerId = null, vendorId = null, status = null, limit = 100 } = {}) {
  let rows = store.all('orders');
  if (buyerId) rows = rows.filter((o) => o.buyerId === buyerId);
  if (vendorId) rows = rows.filter((o) => o.vendorId === vendorId);
  if (status) rows = rows.filter((o) => o.status === status);
  return rows
    .slice()
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map(hydrate);
}

/**
 * Move an order through its lifecycle. Returns { order, changed }.
 *
 * Same-state requests are a harmless no-op: a vendor double-tapping "Mark
 * fulfilled" has not fulfilled it twice.
 */
export function transitionOrder(id, next, { note = '' } = {}) {
  const order = store.find('orders', (o) => o.id === id);
  if (!order) throw new Error('order not found');
  if (!ORDER_STATUS.includes(next)) {
    throw new Error(`status must be one of ${ORDER_STATUS.join(', ')}`);
  }
  if (order.status === next) return { order: hydrate(order), changed: false };

  const allowed = VALID_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`invalid order transition: ${order.status} -> ${next}`);
  }

  // SETTLEMENT REQUIRES REAL SETTLED MONEY.
  //
  // Without this guard "settled" would be a button that invents revenue: the
  // order would read as paid, and the vendor's facts would count a settled
  // sale, with nothing behind it. No payment provider is connected, so the
  // only legitimate route to settled is an existing settled ledger row.
  if (next === 'settled') {
    const tx = order.transactionId
      ? store.find('ledgerTransactions', (t) => t.id === order.transactionId)
      : null;
    if (!tx || tx.status !== 'settled') {
      throw new Error(
        'an order can only be settled once a settled transaction is attached; ' +
        'no payment provider is connected'
      );
    }
  }

  const now = new Date().toISOString();
  const patch = {
    status: next,
    history: [...order.history, { status: next, at: now, note }],
    updatedAt: now
  };
  if (next === 'fulfilled') patch.fulfilledAt = now;
  if (next === 'settled') patch.settledAt = now;

  const updated = store.update('orders', id, patch);
  // FULFILMENT IS THE EARNING MOMENT for referral and purchase points: the
  // goods actually reached the buyer. Idempotent per order, capped by the
  // rewards pool at conversion — never a mint.
  if (next === 'fulfilled') {
    try { referrals.recordOrder(id); } catch { /* rewards must never break an order */ }
  }
  return { order: hydrate(updated), changed: true };
}

/**
 * Link a real ledger transaction to an order.
 *
 * The transaction must already exist and its amount must MATCH the order
 * total. Attaching a 1-shilling transaction to a 1000-shilling order would let
 * a token payment mark the order settled -- the forged-total attack rerouted
 * through the ledger.
 */
export function attachTransaction(orderId, transactionId) {
  const order = store.find('orders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  const tx = store.find('ledgerTransactions', (t) => t.id === transactionId);
  if (!tx) throw new Error('transaction not found');

  if (tx.amount !== order.total) {
    throw new Error('transaction amount does not match the order total');
  }
  if (tx.currency !== order.currency) {
    throw new Error('transaction currency does not match the order currency');
  }
  return hydrate(store.update('orders', orderId, {
    transactionId,
    updatedAt: new Date().toISOString()
  }));
}

// ---------------------------------------------------------------------------
// DISPUTES
//
// The smallest useful primitive. Not a support desk, not arbitration, and
// explicitly not refunds -- inventing reversal economics with no payment rail
// would be inventing money movement.
//
// A dispute establishes exactly one fact:
//
//     This transaction has been contested and must not be silently
//     treated as clean fulfilment.
// ---------------------------------------------------------------------------

export const DISPUTE_STATUS = ['open', 'withdrawn'];

// A dispute is only meaningful once something has been committed to.
const DISPUTABLE = new Set(['ordered', 'accepted', 'preparing', 'ready', 'fulfilled', 'settled']);

export function openDispute({ orderId, reportedBy, reason }) {
  const order = store.find('orders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');

  // Only the buyer contests their own order. The vendor has other remedies and
  // an unrelated user has no standing at all. Checked FIRST so a stranger
  // learns nothing about the order's state.
  if (order.buyerId !== reportedBy) {
    throw new Error('only the buyer may dispute this order');
  }

  // IDEMPOTENCY BEFORE ELIGIBILITY.
  //
  // Opening a dispute moves the order to `disputed`, which is not itself a
  // disputable state. Checking eligibility first therefore made the second
  // call fail with "an order with status 'disputed' cannot be disputed" --
  // a double-tapped button turning into an error instead of a no-op. Same
  // ordering trap as membership-before-transition in assignTask.
  const existing = store.find('disputes', (d) => d.orderId === orderId && d.status === 'open');
  if (existing) return { dispute: existing, order: hydrate(order), changed: false };

  if (!DISPUTABLE.has(order.status)) {
    throw new Error(`an order with status '${order.status}' cannot be disputed`);
  }
  if (!reason || !String(reason).trim()) {
    throw new Error('reason is required');
  }

  const now = new Date().toISOString();
  const dispute = {
    id: newId('disp'),
    orderId,
    reportedBy,
    vendorId: order.vendorId,
    reason: String(reason).trim(),
    status: 'open',
    createdAt: now,
    updatedAt: now
  };
  store.insert('disputes', dispute);

  // The order itself carries the contested state, so no reader of an order can
  // miss it by forgetting to check a separate table.
  const { order: updated } = transitionOrder(orderId, 'disputed', { note: 'disputed by buyer' });
  return { dispute, order: updated, changed: true };
}

export function listDisputes({ vendorId = null, reportedBy = null } = {}) {
  let rows = store.all('disputes');
  if (vendorId) rows = rows.filter((d) => d.vendorId === vendorId);
  if (reportedBy) rows = rows.filter((d) => d.reportedBy === reportedBy);
  return rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
