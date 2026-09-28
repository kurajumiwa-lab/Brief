// ---------------------------------------------------------------------------
// TICKET RESALE MARKET (Tikiti integration T1)
//
// A P2P marketplace for seats that already exist: a confirmed campaign
// registration becomes a ticket its owner may resell or gift. The invariants
// ported from Tikiti, in Brief's idiom:
//
//   * ONE active listing per ticket — a seat cannot be sold twice in parallel.
//   * codeVersion increments on every ownership change — the moment a ticket
//     is transferred, every previously printed QR is dead at the gate.
//   * ownership transfers only on a GENUINELY SETTLED ledger row (§16); with
//     no payment provider Brief says so instead of pretending (§17).
//   * a refund is a STATUS transition of the real ledger row, and it reverts
//     ownership — it is never a negative amount and never a silent relist.
//   * listing removal / ticket voiding are moderation acts: capability-gated,
//     reason-required, audited.
//   * the server prices everything. A client-sent price is never read.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';

// ---------------------------------------------------------------------------
// DECISION 6 GATE — the resale MARKET is off. Not deleted: gated.
//
// docs/DECISIONS.md D6: "It cannot be sold through Trace. No resale flow. No
// transfer marketplace." But the same decision keeps the ticket itself, and
// keeps giving it away: "When opted-in, the ticket can be *given* to someone
// else." So the line runs through this module, not around it:
//
//   OFF  listForResale, buyListing, settleOrder, cancelOrder,
//        sellerConfirmReceived, refundOrder, cancelListing, removeListing,
//        listingsForEvent -- every function whose job is a SALE.
//   ON   issueForRegistration, ticketOwnerView, parseScannedCode,
//        resolveGateCode, resolveEvent, findUserRef, transferTicket,
//        voidTicket -- the ticket, the door scan, the gift and moderation.
//
// `transferTicket` is a pure gift: it writes kind 'gift' with value 0 and
// touches no ledger row, so it is the thing D6 permits and not the thing it
// forbids. Gating ISSUANCE instead -- the obvious reading of "stop the resale
// hooks" -- would have deleted the ticket altogether and taken the gate scan
// with it, because both live in this same file.
//
// The module stays on disk deliberately. It is 522 lines of money-adjacent code
// with ZERO test coverage, which is exactly the wrong thing to delete blind: an
// uncovered caller is found by a live reference, not by a grep. It is now
// unreachable for sales, and server/test/decisions.mjs fails the build if any
// of it is switched back on. Remove the corpse once nothing has broken.
// ---------------------------------------------------------------------------

/** Decision 6: the resale market is closed. Flip this and the refusal suite fails. */
export const D6_RESALE_MARKET_ENABLED = false;

/** Refuse a sale loudly, naming the decision, rather than silently no-oping. */
function refuseResale(what) {
  if (D6_RESALE_MARKET_ENABLED) return;
  const err = new Error(
    `ticket resale is closed: ${what} is not available (Decision 6 — no resale flow, no transfer marketplace)`
  );
  err.code = 'resale_closed';
  throw err;
}
import * as signals from './signal.js';
import * as ledger from './ledger.js';

const KES = 'KES';

// Listing lifecycle: active → pending (a buyer has an open order) → sold |
// cancelled | expired | removed. A pending listing is LOCKED — a second buyer
// cannot open another order against it.
export const LISTING_STATUS = ['active', 'pending', 'sold', 'cancelled', 'expired', 'removed'];
export const TICKET_ORDER_STATUS = ['pending', 'completed', 'cancelled', 'refunded'];
export const TICKET_STATUS = ['valid', 'void'];

const normaliseCode = (code) =>
  String(code ?? '').trim().toUpperCase().replace(/[\s-]+/g, '');

/**
 * A scanned code may carry a version suffix ("ABCD-123#3") issued with the
 * latest transfer. The base locates the registration; the suffix must match
 * the ticket's CURRENT codeVersion or the scan is stale.
 */
export function parseScannedCode(raw) {
  const text = String(raw ?? '').trim();
  const hashAt = text.indexOf('#');
  if (hashAt === -1) return { base: normaliseCode(text), version: null };
  const base = normaliseCode(text.slice(0, hashAt));
  const suffix = text.slice(hashAt + 1);
  const version = /^\d+$/.test(suffix) ? Number(suffix) : NaN;
  return { base, version: Number.isFinite(version) ? version : null };
}

function findRegistrationByCode(base) {
  return store.find('registrations', (r) => normaliseCode(r.ticketCode) === base) ?? null;
}

function ticketForRegistration(registrationId) {
  return store.find('tickets', (t) => t.registrationId === registrationId) ?? null;
}

/**
 * Resolve a scanned gate code against the resale state.
 *
 *   ok                 the scan may proceed to normal check-in
 *   not_found          no registration carries the base code
 *   stale_code         the ticket was transferred/voided; this QR is dead
 */
export function resolveGateCode(raw) {
  const { base, version } = parseScannedCode(raw);
  if (!base) return { ok: false, reason: 'not_found' };
  const registration = findRegistrationByCode(base);
  if (!registration) return { ok: false, reason: 'not_found', registration: null };
  const ticket = ticketForRegistration(registration.id);
  if (!ticket) {
    // This seat never entered the resale system: the bare code is the only
    // valid form. A versioned scan of a non-resale code is fabricated.
    return version === null
      ? { ok: true, registration, ticket: null }
      : { ok: false, reason: 'stale_code', registration, ticket: null };
  }
  if (ticket.status === 'void') return { ok: false, reason: 'void', registration, ticket };
  if (version !== ticket.codeVersion) {
    return { ok: false, reason: 'stale_code', registration, ticket };
  }
  return { ok: true, registration, ticket };
}

/**
 * Issue the resale ticket for a confirmed registration. Idempotent.
 *
 * Only registrations with an authenticated owner enter the resale system: a
 * public stranger's seat keeps working exactly as before through its gate
 * code, but there is no identity to hold ownership, so no ticket row is
 * invented for them.
 */
export function issueForRegistration(registration) {
  if (!registration?.id || !registration.userId) return null;
  const existing = ticketForRegistration(registration.id);
  if (existing) return existing;
  const campaign = store.find('campaigns', (c) => c.id === registration.campaignId);
  // A contribution pot is not a seat: contributors hold no admittance to
  // resell. No ticket row is invented for them.
  if (campaign?.type === 'contribution') return null;
  const now = new Date().toISOString();
  return store.insert('tickets', {
    id: newId('tik'),
    registrationId: registration.id,
    eventId: registration.campaignId,
    ownerUserId: registration.userId,
    code: registration.ticketCode,
    codeVersion: 1,
    status: 'valid',
    // The original price actually charged for this seat, for provenance.
    // Free entry is honestly zero, not blank.
    issuePrice: campaign?.price ?? 0,
    activeListingId: null,
    issuedAt: now,
    createdAt: now
  });
}

/** The owner-facing view of a ticket: live code (versioned), no secrets. */
export function ticketOwnerView(ticket) {
  if (!ticket) return null;
  const campaign = store.find('campaigns', (c) => c.id === ticket.eventId);
  const registration = store.find('registrations', (r) => r.id === ticket.registrationId);
  const listing = ticket.activeListingId ? store.find('ticketListings', (l) => l.id === ticket.activeListingId) : null;
  return {
    id: ticket.id,
    eventId: ticket.eventId,
    eventTitle: campaign?.title ?? null,
    eventSlug: campaign?.publicSlug ?? null,
    eventLocation: campaign?.location ?? null,
    eventStartsAt: campaign?.startsAt ?? null,
    eventEndsAt: campaign?.endsAt ?? null,
    eventType: campaign?.type ?? null,
    eventDescription: campaign?.description ?? null,
    attendeeName: registration?.name ?? null,
    entryStatus: registration?.status ?? 'registered',
    checkedInAt: registration?.checkedInAt ?? null,
    issuePrice: ticket.issuePrice ?? campaign?.price ?? 0,
    currency: campaign?.currency ?? 'KES',
    listingPrice: listing ? listing.price : null,
    code: ticket.code,
    // What the holder's QR must carry RIGHT NOW. Bump-aware.
    scanCode: `${ticket.code}#${ticket.codeVersion}`,
    codeVersion: ticket.codeVersion,
    status: ticket.status,
    activeListingId: ticket.activeListingId,
    issuedAt: ticket.issuedAt,
    transfers: store.filter('ticketTransfers', (t) => t.ticketId === ticket.id)
      .map((t) => ({ at: t.at, kind: t.kind, codeVersionAfter: t.codeVersionAfter }))
  };
}

function activeListingFor(ticketId) {
  return store.find('ticketListings', (l) =>
    l.ticketId === ticketId && (l.status === 'active' || l.status === 'pending'));
}

/** List a owned seat for resale. Server-priced, single-listing enforced. */
export function listForResale(ownerId, ticketId, priceKes, { note = null, expiresAt = null } = {}) {
  refuseResale('listForResale');
  const ticket = store.find('tickets', (t) => t.id === ticketId);
  if (!ticket) throw new Error('ticket not found');
  if (ticket.ownerUserId !== ownerId) throw new Error('only the ticket owner may list it');
  if (ticket.status !== 'valid') throw new Error('this ticket cannot be listed');
  const existing = activeListingFor(ticket.id);
  if (existing) throw new Error('this ticket already has an active listing');
  // A fractional price is REFUSED, not silently rounded: the seller quoted
  // something that is not money, and guessing their intent would be inventing
  // a price they never set.
  const raw = Number(priceKes);
  if (!Number.isFinite(raw) || !Number.isSafeInteger(raw) || raw <= 0) {
    throw new Error('price must be a positive whole number of shillings');
  }
  const price = raw;
  if (expiresAt != null) {
    const when = Date.parse(expiresAt);
    if (!Number.isFinite(when) || when <= Date.now()) throw new Error('expiry must be in the future');
  }
  const now = new Date().toISOString();
  // T10 fraud screen: an asking price far above what the seat cost, from a
  // very fresh account, is flagged for review -- hidden from browse until a
  // reviewer deals with it. The flag names its own reasons; it accuses nobody.
  const seller = store.find('users', (u) => u.id === ownerId);
  const accountAgeHours = seller?.createdAt
    ? (Date.now() - Date.parse(seller.createdAt)) / 3_600_000 : Infinity;
  const reasons = [];
  if (ticket.issuePrice > 0 && price >= ticket.issuePrice * 3) {
    reasons.push(`asking ${price} for a seat issued at ${ticket.issuePrice}`);
  }
  if (accountAgeHours < 24) reasons.push(`account is ${Math.max(0, Math.round(accountAgeHours))}h old`);
  // Both signals together, not either alone: a fair price from a fresh
  // account is a newcomer, not a fraudster; an ambitious price from a
  // long-standing account is a market question, not a pattern.
  const flagged = reasons.length === 2;
  const listing = store.insert('ticketListings', {
    id: newId('tl'),
    ticketId: ticket.id,
    sellerId: ownerId,
    eventId: ticket.eventId,
    price,
    currency: KES,
    status: 'active',
    note: note ? String(note).slice(0, 280) : null,
    expiresAt: expiresAt ?? null,
    createdAt: now,
    soldAt: null,
    flagged,
    flaggedReason: flagged ? reasons.join('; ') : null,
    removedReason: null,
    removedBy: null
  });
  if (flagged) {
    signals.emitSignal({
      type: 'ticket_flagged',
      actorId: ownerId,
      value: price,
      metadata: { listingId: listing.id, ticketId: ticket.id, reasons }
    });
  }
  store.update('tickets', ticket.id, { activeListingId: listing.id });
  signals.emitSignal({
    type: 'ticket_listed',
    actorId: ownerId,
    value: price,
    metadata: { listingId: listing.id, ticketId: ticket.id, eventId: ticket.eventId }
  });
  return listing;
}

/** Seller pulls the listing. A pending listing (open order) cannot be pulled. */
export function cancelListing(sellerId, listingId) {
  refuseResale('cancelListing');
  const listing = store.find('ticketListings', (l) => l.id === listingId);
  if (!listing) throw new Error('listing not found');
  if (listing.sellerId !== sellerId) throw new Error('only the seller may cancel this listing');
  if (listing.status === 'pending') throw new Error('a buyer has an open order on this listing');
  if (listing.status !== 'active') throw new Error('this listing is not active');
  const updated = store.update('ticketListings', listing.id, { status: 'cancelled' });
  store.update('tickets', listing.ticketId, { activeListingId: null });
  return updated;
}

/** Public-in-app browsing view. No seller identity beyond a display name. */
export function resolveEvent(slugOrId) {
  // The public campaign view deliberately exposes no internal id, so the
  // browse surface addresses events by their public slug (ids still work for
  // the in-app owner surfaces).
  return store.find('campaigns', (c) => c.publicSlug === slugOrId || c.id === slugOrId) ?? null;
}

export function listingsForEvent(eventId) {
  refuseResale('listingsForEvent');
  return store.filter('ticketListings', (l) => l.eventId === eventId && l.status === 'active' && !l.flagged)
    .sort((a, b) => a.price - b.price)
    .map((l) => {
      const ticket = store.find('tickets', (t) => t.id === l.ticketId);
      const seller = store.find('users', (u) => u.id === l.sellerId);
      const campaign = store.find('campaigns', (c) => c.id === eventId);
      return {
        id: l.id,
        eventId: l.eventId,
        eventTitle: campaign?.title ?? null,
        price: l.price,
        currency: l.currency,
        note: l.note,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt,
        cheapest: false, // computed by the caller after sorting
        seller: seller ? { displayName: seller.displayName ?? seller.handle, joinedAt: seller.createdAt ?? null } : null,
        transferCount: ticket ? store.filter('ticketTransfers', (t) => t.ticketId === ticket.id).length : 0
      };
    })
    .map((l, _i, all) => ({ ...l, cheapest: all.length > 0 && l.id === all[0].id }));
}

/** A buyer opens an order against an active listing. Server-fixed price. */
export function buyListing(buyerId, listingId) {
  refuseResale('buyListing');
  const listing = store.find('ticketListings', (l) => l.id === listingId);
  if (!listing) throw new Error('listing not found');
  if (listing.status !== 'active') throw new Error('this listing is no longer available');
  if (listing.sellerId === buyerId) throw new Error('you cannot buy your own listing');
  const now = new Date().toISOString();
  const order = store.insert('ticketOrders', {
    id: newId('tord'),
    reference: `TKT-${newId('ref').replace('ref_', '').toUpperCase()}`,
    buyerId,
    listingId: listing.id,
    sellerId: listing.sellerId,
    ticketId: listing.ticketId,
    eventId: listing.eventId,
    status: 'pending',
    unitPrice: listing.price,
    // Brief charges no platform fee today. The field exists so the ledger
    // has a place to put a real one; it is never invented here.
    fee: 0,
    total: listing.price,
    currency: listing.currency,
    ledgerTxId: null,
    createdAt: now,
    updatedAt: now,
    cancelledAt: null
  });
  store.update('ticketListings', listing.id, { status: 'pending' });
  signals.emitSignal({
    type: 'ticket_order_opened',
    actorId: buyerId,
    value: order.total,
    metadata: { orderId: order.id, listingId: listing.id, eventId: listing.eventId }
  });
  return order;
}

/** Buyer abandons a pending order; the listing returns to active. */
export function cancelOrder(buyerId, orderId) {
  refuseResale('cancelOrder');
  const order = store.find('ticketOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.buyerId !== buyerId) throw new Error('only the buyer may cancel this order');
  if (order.status !== 'pending') throw new Error('only a pending order can be cancelled');
  const now = new Date().toISOString();
  store.update('ticketOrders', order.id, { status: 'cancelled', cancelledAt: now, updatedAt: now });
  store.update('ticketListings', order.listingId, { status: 'active' });
  return store.find('ticketOrders', (o) => o.id === order.id);
}

/**
 * Complete an order: ownership moves ONLY on a genuinely settled ledger row.
 * The row must match the order exactly (amount, currency) — the same rules
 * the product marketplace enforces via orders.attachTransaction.
 */
export function sellerConfirmReceived(sellerId, orderId) {
  refuseResale('sellerConfirmReceived');
  const order = store.find('ticketOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.sellerId !== sellerId) throw new Error('only the seller may confirm receiving payment');
  if (order.status === 'completed') return { order, changed: false };
  if (order.status !== 'pending') throw new Error('this order can no longer be completed');

  const campaign = store.find('campaigns', (c) => c.id === order.eventId);
  let tx = ledger.createTransaction({
    amount: order.total,
    currency: order.currency,
    type: 'sale',
    description: `Resale ${order.reference} — payment received out-of-band, confirmed by the seller`,
    counterparty: order.buyerId,
    circleId: campaign?.circleId ?? null
  });
  for (const step of ['pending', 'confirmed', 'settled']) {
    tx = ledger.transitionTransaction(tx.id, step, 'seller confirmed receiving payment');
  }
  // The transfer itself is the same code path a provider-settled order takes.
  return settleOrder(order.buyerId, order.id, { transactionId: tx.id });
}

export function settleOrder(buyerId, orderId, { transactionId } = {}) {
  refuseResale('settleOrder');
  const order = store.find('ticketOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.buyerId !== buyerId) throw new Error('only the buyer may settle this order');
  if (order.status === 'completed') return { order, changed: false };
  if (order.status !== 'pending') throw new Error('this order can no longer be settled');
  const tx = transactionId ? store.find('ledgerTransactions', (t) => t.id === transactionId) : null;
  if (!tx) throw new Error('a settled ledger transaction is required to transfer a ticket');
  if (tx.status !== 'settled') throw new Error('the ledger transaction is not settled');
  if (tx.amount !== order.total) throw new Error('transaction amount does not match the order total');
  if (tx.currency !== order.currency) throw new Error('transaction currency does not match the order');
  if (tx.counterparty !== buyerId) throw new Error('the settled transaction must belong to the buyer');

  const now = new Date().toISOString();
  const ticket = store.find('tickets', (t) => t.id === order.ticketId);
  if (!ticket || ticket.status !== 'valid') throw new Error('the ticket can no longer be transferred');
  const listing = store.find('ticketListings', (l) => l.id === order.listingId);
  if (!listing || listing.status !== 'pending') throw new Error('the listing is no longer held for this order');

  const codeVersion = ticket.codeVersion + 1;
  store.update('tickets', ticket.id, {
    ownerUserId: buyerId,
    codeVersion,
    activeListingId: null
  });
  store.insert('ticketTransfers', {
    id: newId('ttx'),
    ticketId: ticket.id,
    fromUserId: order.sellerId,
    toUserId: buyerId,
    orderId: order.id,
    kind: 'purchase',
    codeVersionAfter: codeVersion,
    at: now
  });
  store.update('ticketListings', listing.id, { status: 'sold', soldAt: now });
  const updated = store.update('ticketOrders', order.id, {
    status: 'completed',
    ledgerTxId: tx.id,
    updatedAt: now
  });
  signals.emitSignal({
    type: 'ticket_transferred',
    actorId: buyerId,
    value: order.total,
    metadata: { orderId: order.id, ticketId: ticket.id, eventId: order.eventId, codeVersion }
  });
  return { order: updated, changed: true };
}

/** A completed order is refunded ONLY by refunding its real ledger row. */
export function refundOrder(callerId, orderId) {
  refuseResale('refundOrder');
  const order = store.find('ticketOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  const isParty = order.buyerId === callerId || order.sellerId === callerId;
  if (!isParty) throw new Error('only a party to this order may request a refund');
  if (order.status !== 'completed') throw new Error('only a completed order can be refunded');
  const tx = store.find('ledgerTransactions', (t) => t.id === order.ledgerTxId);
  if (!tx) throw new Error('the settled transaction for this order is missing');
  // The transition itself is the ledger's to make (status, never a negative
  // amount); if it refuses, the refund does not happen.
  ledger.transitionTransaction(tx.id, 'refunded', `ticket order ${order.id} refunded`);
  const refundedTx = store.find('ledgerTransactions', (t) => t.id === tx.id);
  if (refundedTx.status !== 'refunded') throw new Error('the ledger refused the refund transition');

  const now = new Date().toISOString();
  const ticket = store.find('tickets', (t) => t.id === order.ticketId);
  // Ownership reverts to the seller AND the buyer's QR dies with it.
  const codeVersion = (ticket?.codeVersion ?? 0) + 1;
  if (ticket) {
    store.update('tickets', ticket.id, { ownerUserId: order.sellerId, codeVersion });
    store.insert('ticketTransfers', {
      id: newId('ttx'),
      ticketId: ticket.id,
      fromUserId: order.buyerId,
      toUserId: order.sellerId,
      orderId: order.id,
      kind: 'refund_revert',
      codeVersionAfter: codeVersion,
      at: now
    });
  }
  const updated = store.update('ticketOrders', order.id, { status: 'refunded', updatedAt: now });
  signals.emitSignal({
    type: 'ticket_order_refunded',
    actorId: callerId,
    value: order.total,
    metadata: { orderId: order.id, ticketId: order.ticketId }
  });
  return { order: updated, ticket: ticket ? store.find('tickets', (t) => t.id === ticket.id) : null };
}

/** Gift a seat: no money, but the same version bump and provenance. */
export function findUserRef({ toUserId = null, toHandle = null } = {}) {
  if (toUserId) return store.find('users', (u) => u.id === toUserId) ?? null;
  if (toHandle) return store.find('users', (u) => u.handle === String(toHandle).trim()) ?? null;
  return null;
}

export function transferTicket(ownerId, ticketId, toUserId) {
  const ticket = store.find('tickets', (t) => t.id === ticketId);
  if (!ticket) throw new Error('ticket not found');
  if (ticket.ownerUserId !== ownerId) throw new Error('only the ticket owner may transfer it');
  if (ticket.status !== 'valid') throw new Error('this ticket cannot be transferred');
  if (activeListingFor(ticket.id)) throw new Error('cancel the active listing before transferring');
  const to = store.find('users', (u) => u.id === toUserId);
  if (!to) throw new Error('recipient not found');
  if (to.id === ownerId) throw new Error('the ticket already belongs to you');
  const now = new Date().toISOString();
  const codeVersion = ticket.codeVersion + 1;
  store.update('tickets', ticket.id, { ownerUserId: to.id, codeVersion });
  store.insert('ticketTransfers', {
    id: newId('ttx'),
    ticketId: ticket.id,
    fromUserId: ownerId,
    toUserId: to.id,
    orderId: null,
    kind: 'gift',
    codeVersionAfter: codeVersion,
    at: now
  });
  signals.emitSignal({
    type: 'ticket_transferred',
    actorId: ownerId,
    value: 0,
    metadata: { ticketId: ticket.id, eventId: ticket.eventId, kind: 'gift', codeVersion }
  });
  return store.find('tickets', (t) => t.id === ticket.id);
}

/** Moderation: pull a listing. Capability-gated and audited at the route. */
export function removeListing(moderatorId, listingId, reason) {
  refuseResale('removeListing');
  const listing = store.find('ticketListings', (l) => l.id === listingId);
  if (!listing) throw new Error('listing not found');
  if (!reason || !String(reason).trim()) throw new Error('a removal reason is required');
  if (listing.status === 'sold') throw new Error('a sold listing cannot be removed');
  const now = new Date().toISOString();
  const updated = store.update('ticketListings', listing.id, {
    status: 'removed',
    removedReason: String(reason).slice(0, 280),
    removedBy: moderatorId
  });
  if (listing.status !== 'pending') {
    store.update('tickets', listing.ticketId, { activeListingId: null });
  }
  return updated;
}

/** Moderation: void a ticket outright. The gate refuses void tickets. */
export function voidTicket(moderatorId, ticketId, reason) {
  const ticket = store.find('tickets', (t) => t.id === ticketId);
  if (!ticket) throw new Error('ticket not found');
  if (!reason || !String(reason).trim()) throw new Error('a void reason is required');
  const now = new Date().toISOString();
  const updated = store.update('tickets', ticket.id, { status: 'void' });
  const listing = activeListingFor(ticket.id);
  if (listing && listing.status === 'active') {
    store.update('ticketListings', listing.id, {
      status: 'removed',
      removedReason: String(reason).slice(0, 280),
      removedBy: moderatorId
    });
  }
  store.update('tickets', ticket.id, { activeListingId: null });
  signals.emitSignal({
    type: 'ticket_voided',
    actorId: moderatorId,
    value: 0,
    metadata: { ticketId: ticket.id, eventId: ticket.eventId, reason: String(reason).slice(0, 280) }
  });
  return store.find('tickets', (t) => t.id === ticket.id);
}

/**
 * Every live ticket for one event stops working, because the event itself was
 * withdrawn. Not moderation — the host ended the thing the ticket admits
 * someone to, and a valid ticket to a withdrawn event is a promise nobody can
 * keep (the gate would scan it at a venue where nothing is happening).
 *
 * Returns what it did and what it could NOT do:
 *   voided      tickets flipped to `void`
 *   pulled      resale listings taken down with them (a listing for a dead
 *               ticket is a sale nobody may complete)
 *   stuck       tickets whose listing has an open order — a buyer is mid-buy,
 *               so this is left for a person and NAMED rather than broken
 *               underneath them.
 */
export function voidForCampaign(campaignId, reason, { actorId = null } = {}) {
  const why = String(reason || 'the event was withdrawn').slice(0, 280);
  const tickets = store.filter('tickets', (t) => t.eventId === campaignId && t.status === 'valid');
  const voided = [];
  const pulled = [];
  const stuck = [];
  for (const ticket of tickets) {
    const listing = activeListingFor(ticket.id);
    if (listing && listing.status === 'pending') {
      stuck.push({ ticketId: ticket.id, listingId: listing.id, reason: 'a buyer has an open order on this ticket' });
      continue;
    }
    store.update('tickets', ticket.id, { status: 'void', activeListingId: null });
    voided.push(ticket.id);
    if (listing && listing.status === 'active') {
      store.update('ticketListings', listing.id, { status: 'removed', removedReason: why, removedBy: actorId });
      pulled.push(listing.id);
    }
    signals.emitSignal({
      type: 'ticket_voided',
      actorId,
      value: 0,
      metadata: { ticketId: ticket.id, eventId: campaignId, reason: why, cause: 'event_withdrawn' }
    });
  }
  return { voided, pulled, stuck };
}
