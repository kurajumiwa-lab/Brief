// ---------------------------------------------------------------------------
// HUDUMALINK — ORDERS & THE M-PESA ESCROW LOOP
//
// An Order is a citizen's commitment to a service. Like every money-bearing
// object in this codebase:
//
//     order != paid != completed
//
// Creating an order moves no money. Funds are LOCKED in escrow only when a
// real, reconciled M-Pesa STK callback says they arrived. Escrow is RELEASED
// only when the execution layer reports VERIFIED_COMPLETE. Releasing money on
// anything weaker would let a button mint a payout.
//
// THE ESCROW LOOP (matches the blueprint's "Secure M-Pesa Escrow Loop"):
//
//   1. createOrder      -> status PENDING,  escrow NONE
//   2. lockEscrow(cb)   -> status PAID,     escrow LOCKED   (M-Pesa confirmed)
//   3. beginExecution   -> status RUNNING,  escrow LOCKED
//   4. completeOrder    -> status COMPLETED, escrow RELEASED (document verified)
//        (refundOrder)  -> status REFUNDED, escrow REFUNDED
//
// Money is derived from the catalog at createOrder time — price/total in any
// payload is ignored — and the escrow amount must match that derived total at
// lockEscrow, so a token M-Pesa callback can never mark a large order paid.
// ---------------------------------------------------------------------------

import { store, newId } from '../../store.js';
import { getService, priceFor } from './catalog.js';
import * as intake from '../engine/intake.js';

export const ORDER_STATUS = ['PENDING', 'PAID', 'RUNNING', 'COMPLETED', 'REFUNDED', 'EXPIRED'];
export const ESCROW_STATUS = ['NONE', 'LOCKED', 'RELEASED', 'REFUNDED', 'EXPIRED'];

// Server-authoritative lifecycle. Same rule as every other domain here: no
// backwards edge out of a terminal/economic state, and no skipping the
// reconciled-payment gate. COMPLETED requires the escrow to have been LOCKED,
// which requires real money — so completion can never be faked.
// EXPIRED is the escalation path that was missing: a paid order whose executor
// never completes (or never starts) must not sit in permanent lock forever.
// It is RECORDS-ONLY (no money moves): expiry flags the escrow for a manual
// refund by an operator, exactly like refundOrder.
const VALID_ORDER_TRANSITIONS = {
  PENDING: ['PAID', 'REFUNDED', 'EXPIRED'],
  PAID: ['RUNNING', 'REFUNDED', 'EXPIRED'],
  RUNNING: ['COMPLETED', 'REFUNDED', 'EXPIRED'],
  COMPLETED: [],
  REFUNDED: [],
  EXPIRED: []
};

const VALID_ESCROW_TRANSITIONS = {
  NONE: ['LOCKED'],
  LOCKED: ['RELEASED', 'REFUNDED', 'EXPIRED'],
  RELEASED: [],
  REFUNDED: [],
  EXPIRED: []
};

function history(row) {
  return Array.isArray(row?.history) ? row.history.slice() : [];
}

/**
 * Place an order. `serviceId` is the only thing that selects the price: the
 * fee split is read from the catalog and multiplied by nothing, because a
 * WhatsApp service has no quantity. Captured inputs are the free-text the chat
 * gathered (company name, plot number, etc.).
 */
export function createOrder({ phone, serviceId, capturedInputs = {}, idempotencyKey = null }) {
  if (!phone || !String(phone).trim()) throw new Error('phone is required');
  const svc = getService(serviceId);
  if (!svc) throw new Error('unknown service');

  // DUPLICATE SUBMISSION PROTECTION. A double-tapped "Confirm" or a retried
  // webhook must not create a second chargeable order for the same intent.
  if (idempotencyKey) {
    const prior = store.find('hudumaOrders',
      (o) => o.phone === phone && o.idempotencyKey === idempotencyKey);
    if (prior) {
      // The edge record: one row per key this system honours. The order row
      // remains the authority (and is returned live, not as a stored copy).
      intake.note({ key: `huduma:${phone}:${idempotencyKey}`, source: 'huduma', handler: 'create_order', outcome: { orderId: prior.id } });
      return hydrate(prior);
    }
  }

  // Validate every declared input was actually captured. A service cannot be
  // ordered without the fields its execution depends on.
  for (const f of svc.inputs) {
    const v = capturedInputs[f.key];
    if (v === undefined || v === null || !String(v).trim()) {
      throw new Error(`missing required input: ${f.label}`);
    }
  }

  const price = priceFor(svc); // server-derived; never accepts an amount
  const now = new Date().toISOString();
  const order = {
    id: newId('hord'),
    userId: null,                      // resolved by users.js on lookup
    phone,
    serviceType: svc.id,
    serviceTitle: svc.title,
    execution: svc.execution,
    status: 'PENDING',
    govFee: price.govFee,
    platformFee: price.platformFee,
    processingMargin: price.processingMargin,
    totalFee: price.total,
    currency: 'KES',
    escrowStatus: 'NONE',
    capturedInputs: { ...capturedInputs },
    idempotencyKey: idempotencyKey ?? null,
    documentId: null,
    history: [{ status: 'PENDING', at: now, note: 'order placed' }],
    createdAt: now,
    updatedAt: now
  };
  store.insert('hudumaOrders', order);
  return hydrate(order);
}

/**
 * Register a fired STK push as a PENDING escrow row.
 *
 * Called the moment Daraja accepts the push (the PIN prompt is on the user's
 * phone). Nothing is locked yet — funds are only locked when the callback
 * confirms them. Recording the CheckoutRequestID now is what lets the callback
 * route find the order, and validates the amount we will later compare against.
 *
 * Idempotent on the checkout id: a retried push with the same reference reuses
 * the pending row rather than opening a second escrow slot for one order.
 */
export function registerStkPush(orderId, { mpesaCheckoutId, amount }) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (!Number.isSafeInteger(amount) || amount !== order.totalFee) {
    throw new Error(`STK amount ${amount} does not match order total ${order.totalFee}`);
  }
  if (mpesaCheckoutId) {
    const existing = store.find('hudumaEscrow', (e) => e.mpesaCheckoutId === mpesaCheckoutId);
    if (existing) return existing;
  }
  const now = new Date().toISOString();
  const escrow = {
    id: newId('hesc'),
    orderId,
    mpesaCheckoutId: mpesaCheckoutId ?? null,
    amount,
    receipt: null,
    status: 'PENDING',
    history: [{ status: 'PENDING', at: now, note: 'STK pushed, awaiting PIN' }],
    createdAt: now,
    updatedAt: now
  };
  store.insert('hudumaEscrow', escrow);
  store.update('hudumaOrders', orderId, { pendingCheckoutId: mpesaCheckoutId ?? null });
  return escrow;
}

/** Resolve an order from a Daraja CheckoutRequestID (the callback's key). */
export function findByCheckout(mpesaCheckoutId) {
  const esc = store.find('hudumaEscrow', (e) => e.mpesaCheckoutId === mpesaCheckoutId);
  if (!esc) return null;
  return { order: hydrate(store.find('hudumaOrders', (o) => o.id === esc.orderId)), escrow: esc };
}

/** A failed/cancelled STK. The escrow slot is FAILED; the order stays PENDING
 *  so the citizen can retry payment without a fresh order. */
export function failCheckout(orderId, { reason = 'stk failed' } = {}) {
  const esc = store.find('hudumaEscrow', (e) => e.orderId === orderId);
  if (esc && esc.status === 'PENDING') {
    store.update('hudumaEscrow', esc.id, {
      status: 'FAILED',
      history: [...history(esc), { status: 'FAILED', at: new Date().toISOString(), note: reason }]
    });
  }
  return esc;
}

/**
 * Lock escrow on a reconciled M-Pesa callback.
 *
 * The `amount` is the figure Daraja reported. It MUST equal the order total —
 * a 1-shilling callback cannot lock a 3,500-shilling order. If a PENDING escrow
 * row was registered at STK time it is promoted to LOCKED; otherwise one is
 * created. A redelivered callback finds the LOCKED row and is a no-op.
 */
export function lockEscrow(orderId, { mpesaCheckoutId, amount, receipt = null }) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');

  if (!Number.isSafeInteger(amount) || amount !== order.totalFee) {
    // The forgery that must never succeed: a token payment marking a large
    // order as paid. Refused before any status moves.
    throw new Error(`callback amount ${amount} does not match order total ${order.totalFee}`);
  }

  const now = new Date().toISOString();
  let esc = store.find('hudumaEscrow', (e) => e.orderId === orderId);

  // Idempotency: already locked by a prior delivery of this callback.
  if (esc && esc.status === 'LOCKED') {
    return { order: hydrate(order), escrow: esc, duplicate: true };
  }

  transitionOrder(orderId, 'PAID', { note: 'M-Pesa confirmed' });

  if (esc) {
    // Promote the PENDING row registered at STK time to LOCKED, carrying the
    // receipt Daraja returned. This is the normal path.
    store.update('hudumaEscrow', esc.id, {
      receipt: receipt ?? esc.receipt,
      status: 'LOCKED',
      history: [...history(esc), { status: 'LOCKED', at: now, note: 'funds confirmed in escrow' }]
    });
    esc = store.find('hudumaEscrow', (e) => e.id === esc.id);
  } else {
    // Defensive fallback: a callback arrived without a registered STK push
    // (e.g. legacy data). Create the LOCKED row directly so the flow completes.
    esc = {
      id: newId('hesc'),
      orderId,
      mpesaCheckoutId: mpesaCheckoutId ?? null,
      amount,
      receipt,
      status: 'LOCKED',
      history: [{ status: 'LOCKED', at: now, note: 'funds confirmed in escrow' }],
      createdAt: now,
      updatedAt: now
    };
    store.insert('hudumaEscrow', esc);
  }
  setEscrow(orderId, 'LOCKED', now, 'M-Pesa funds locked');
  return { order: hydrate(store.find('hudumaOrders', (o) => o.id === orderId)), escrow: esc, duplicate: false };
}

/** The execution layer has picked the order up. PAID -> RUNNING. */
export function beginExecution(orderId, { note = 'execution started' } = {}) {
  return transitionOrder(orderId, 'RUNNING', { note });
}

/**
 * Mark an order VERIFIED_COMPLETE.
 *
 * Requires a real document artefact (signed URL + content hash) and that the
 * escrow was LOCKED — i.e. real money was held. This is the single gate that
 * releases escrow to the platform/runner wallets, so it never runs on a
 * placeholder: the executor must return a concrete artefact.
 */
export function completeOrder(orderId, { document, executorRef = null }) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (!document || !document.url || !document.signatureHash) {
    throw new Error('a completed order requires a signed document url and signature hash');
  }
  if (order.escrowStatus !== 'LOCKED') {
    throw new Error(`cannot complete an order whose escrow is ${order.escrowStatus}`);
  }

  // Record the artefact BEFORE releasing the money, so a crash between the two
  // leaves a verifiable document and locked (releasable) funds, not released
  // funds with no artefact.
  const now = new Date().toISOString();
  const doc = {
    id: newId('hdoc'),
    orderId,
    s3SecureUrl: document.url,
    digitalSignatureHash: document.signatureHash,
    createdAt: now
  };
  store.insert('hudumaDocuments', doc);

  transitionOrder(orderId, 'COMPLETED', { note: executorRef ? `completed by ${executorRef}` : 'completed' });
  setEscrow(orderId, 'RELEASED', now, 'verified complete — escrow released');
  store.update('hudumaOrders', orderId, { documentId: doc.id });
  return hydrate(store.find('hudumaOrders', (o) => o.id === orderId));
}

/** Release the funds back to the citizen. Allowed at any pre-completion state. */
export function refundOrder(orderId, { reason = 'refunded' } = {}) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.status === 'COMPLETED') {
    // A completed, delivered order is final. Refunding it would claw back
    // money for a result the citizen already received.
    throw new Error('a completed order cannot be refunded');
  }
  transitionOrder(orderId, 'REFUNDED', { note: reason });
  if (order.escrowStatus === 'LOCKED') {
    setEscrow(orderId, 'REFUNDED', new Date().toISOString(), reason);
  }
  return hydrate(store.find('hudumaOrders', (o) => o.id === orderId));
}

/**
 * Expire an order stuck in a non-terminal state (paid but never executed, or
 * running past its deadline). This is the ESCALATION PATH a permanent-lock
 * scenario needs: a citizen's money must never sit in LOCKED escrow with no
 * way out. It is RECORDS-ONLY — the escrow is flagged EXPIRED for a manual
 * refund by an operator, exactly like refundOrder; no money moves here.
 */
export function expireOrder(orderId, { reason = 'expired' } = {}) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.status === 'COMPLETED' || order.status === 'REFUNDED' || order.status === 'EXPIRED') {
    throw new Error(`a ${order.status} order cannot be expired`);
  }
  transitionOrder(orderId, 'EXPIRED', { note: reason });
  if (order.escrowStatus === 'LOCKED') {
    setEscrow(orderId, 'EXPIRED', new Date().toISOString(), reason);
  }
  return hydrate(store.find('hudumaOrders', (o) => o.id === orderId));
}

/**
 * The operator-facing sweep: orders in a non-terminal paid state that are older
 * than a deadline, so a human can expire them. Derived, never stored — it reads
 * rows and reports, it does not mutate.
 */
export function listExpiringOrders(olderThanMs = 7 * 86400000) {
  const cutoff = new Date(Date.now() - olderThanMs).toISOString();
  return store.filter('hudumaOrders', (o) =>
    (o.status === 'PAID' || o.status === 'RUNNING') && o.createdAt < cutoff
  );
}

// ---- internal transition helpers -----------------------------------------

function transitionOrder(orderId, next, { note = '' } = {}) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (!order) throw new Error('order not found');
  if (order.status === next) return { order: hydrate(order), changed: false };
  const allowed = VALID_ORDER_TRANSITIONS[order.status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`invalid order transition: ${order.status} -> ${next}`);
  }
  const now = new Date().toISOString();
  return {
    order: hydrate(store.update('hudumaOrders', orderId, {
      status: next,
      history: [...history(order), { status: next, at: now, note }]
    })),
    changed: true
  };
}

function setEscrow(orderId, next, at, note) {
  const order = store.find('hudumaOrders', (o) => o.id === orderId);
  if (order.escrowStatus === next) return;
  const allowed = VALID_ESCROW_TRANSITIONS[order.escrowStatus] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`invalid escrow transition: ${order.escrowStatus} -> ${next}`);
  }
  store.update('hudumaOrders', orderId, { escrowStatus: next });

  // Mirror the transition onto the escrow ledger row so the audit trail lives
  // in both the order history and the escrow row, exactly like the SQL schema.
  const esc = store.find('hudumaEscrow', (e) => e.orderId === orderId);
  if (esc) {
    store.update('hudumaEscrow', esc.id, {
      status: next,
      history: [...history(esc), { status: next, at, note }]
    });
  }
}

// ---- reads ----------------------------------------------------------------

export function getOrder(orderId) {
  const o = store.find('hudumaOrders', (x) => x.id === orderId);
  return o ? hydrate(o) : null;
}

export function listOrdersByPhone(phone, { status = null } = {}) {
  let rows = store.filter('hudumaOrders', (o) => o.phone === phone);
  if (status) rows = rows.filter((o) => o.status === status);
  return rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map(hydrate);
}

export function escrowForOrder(orderId) {
  return store.find('hudumaEscrow', (e) => e.orderId === orderId) ?? null;
}

export function documentForOrder(orderId) {
  return store.find('hudumaDocuments', (d) => d.orderId === orderId) ?? null;
}

/** Attach the resolved user id once the users domain has created/looked-up. */
export function attachUser(orderId, userId) {
  return store.update('hudumaOrders', orderId, { userId });
}

/**
 * Hydrate with the derived picture a reader needs. `paid`/`released` are
 * derived from the escrow row — there is no stored boolean next to the money,
 * because a second source of truth would eventually disagree with the ledger.
 */
function hydrate(order) {
  const esc = store.find('hudumaEscrow', (e) => e.orderId === order.id) ?? null;
  const doc = store.find('hudumaDocuments', (d) => d.orderId === order.id) ?? null;
  return {
    ...order,
    paid: Boolean(esc && (esc.status === 'LOCKED' || esc.status === 'RELEASED')),
    released: order.escrowStatus === 'RELEASED',
    escrow: esc ? { id: esc.id, status: esc.status, amount: esc.amount, receipt: esc.receipt } : null,
    document: doc ? { id: doc.id, url: doc.s3SecureUrl, signatureHash: doc.digitalSignatureHash } : null
  };
}
