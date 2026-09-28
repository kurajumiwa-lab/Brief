// COMMERCE ROUTES — extracted from index.js (zero behaviour change).
// Each route keeps its original body verbatim; only its home file changed.
import { store, newId } from '../store.js';
import { callerId } from '../identity.js';
import * as vault from '../domain/vault.js';
import * as vendors from '../domain/vendor.js';
import * as listings from '../domain/listing.js';
import * as orders from '../domain/order.js';
import * as ledger from '../domain/ledger.js';
import * as payment from '../domain/payment.js';
import * as workPayment from '../domain/workPayment.js';
import * as lipaMdogo from '../domain/lipaMdogo.js';
import * as settlement from '../domain/settlement.js';
import * as providers from '../providers.js';
import * as mpesa from '../connectors/mpesa.js';
import * as vendorSyndication from '../domain/vendorSyndication.js';
import * as signals from '../domain/signal.js';
import { requireAuth, now, recordError } from './helpers.js';

import { requireFeature } from '../features.js';

export function register(app) {
app.use('/api/vendors', requireFeature('commerce'));
app.use('/api/listings', requireFeature('commerce'));
app.use('/api/orders', requireFeature('commerce'));
app.use('/api/disputes', requireFeature('commerce'));
app.use('/api/orders/:id/pay', requireFeature('payments'));
app.use('/api/orders/:id/payments', requireFeature('payments'));
app.use('/api/webhooks/buni', requireFeature('payments'));
app.use('/api/webhooks/mpesa-b2c', requireFeature('payouts'));
app.use('/api/vendors/me/payouts', requireFeature('payouts'));
// ---------------------------------------------------------------------------
// COMMERCE (Batch 3): vendors, listings, orders, fulfilment, disputes.
//
// The chain: Object -> Vendor -> Listing -> Order -> Fulfilment -> Transaction
//
// Two rules govern every route below.
//
//   1. IDENTITY IS NEVER READ FROM THE BODY. ownerId, buyerId and vendorId
//      come from callerId(). A client-supplied identity is a claim, not a
//      fact, and none of these handlers read one.
//
//   2. MONEY IS NEVER READ FROM THE BODY. An order carries a listingId and a
//      quantity; the server multiplies. price/unitPrice/total in a payload are
//      ignored, because Batch 4 will attach a real payment rail to these
//      numbers and a forged total today is forged money later.
// ---------------------------------------------------------------------------

/** The caller's own vendor, or null. Sellers act only as themselves. */
function myVendor(req) {
  return store.find('vendors', (v) => v.ownerId === callerId(req));
}

/**
 * Guard for vendor-owned resources. 404 rather than 403 for someone else's
 * listing: existence is not disclosed to a stranger, matching how campaigns
 * already behave.
 */
function ownedListing(req, res) {
  // Parenthesised deliberately: `x.id === a ?? b` parses as `(x.id === a) ?? b`,
  // which silently compares against undefined and matches nothing.
  const wanted = req.params.listingId ?? req.params.id;
  const l = store.find('listings', (x) => x.id === wanted);
  if (!l) { res.status(404).json({ error: 'listing not found' }); return null; }
  const mine = myVendor(req);
  if (!mine || l.vendorId !== mine.id) {
    res.status(404).json({ error: 'listing not found' });
    return null;
  }
  return l;
}

// --- Vendors -----------------------------------------------------------------


app.get('/api/vendors', (req, res) => {
  res.json({ vendors: vendors.listVendors({ status: req.query.status ?? null }) });
});


/** The caller's own seller identity. Null is a real answer: not everyone sells. */

app.get('/api/vendors/me', (req, res) => {
  if (!requireAuth(req, res)) return;
  res.json({ vendor: vendors.getVendorByOwner(callerId(req)) });
});



app.get('/api/vendors/:id', (req, res) => {
  const v = vendors.getVendor(req.params.id);
  if (!v) return res.status(404).json({ error: 'vendor not found' });
  // A vendor profile is public, so it carries only active listings -- a
  // draft is the seller's private work in progress.
  res.json({ vendor: v, listings: listings.listListings({ vendorId: v.id, status: 'active' }) });
});



app.post('/api/vendors', (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    // ownerId is deliberately NOT read from req.body.
    const v = vendors.createVendor({
      ownerId: callerId(req),
      displayName: req.body?.displayName,
      description: req.body?.description ?? '',
      contactMethod: req.body?.contactMethod ?? null,
      objectId: req.body?.objectId ?? null
    });
    signals.emitSignal({ type: 'vendor_created', actorId: callerId(req), metadata: { vendorId: v.id } });
    res.status(201).json({ vendor: v });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.patch('/api/vendors/:id', (req, res) => {
  const mine = myVendor(req);
  if (!mine || mine.id !== req.params.id) {
    return res.status(404).json({ error: 'vendor not found' });
  }
  try {
    res.json({ vendor: vendors.updateVendor(mine.id, req.body ?? {}) });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

// --- Yard Engine capability profile ----------------------------------------
app.use('/api/vendors/:id/capabilities', requireFeature('vendor_syndication'));

app.get('/api/vendors/:id/capabilities', (req, res) => {
  const view = vendorSyndication.vendorView(req.params.id);
  if (!view) return res.status(404).json({ error: 'vendor not found' });
  res.json(view);
});

app.put('/api/vendors/:id/capabilities', (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    res.json({ capabilities: vendorSyndication.upsertCapabilities(callerId(req), req.params.id, req.body ?? {}) });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

// --- Listings ----------------------------------------------------------------

/**
 * Browse. Public and ACTIVE-only by default: a draft belongs to the seller.
 * An empty marketplace returns an empty array -- nothing is seeded to make it
 * look populated.
 */

app.get('/api/listings', (req, res) => {
  res.json({
    listings: listings.listListings({
      vendorId: req.query.vendorId ?? null,
      type: req.query.type ?? null,
      status: req.query.status ?? 'active'
    })
  });
});


/** The caller's own shelf, in every state including draft and archived. */

app.get('/api/listings/mine', (req, res) => {
  if (!requireAuth(req, res)) return;
  const mine = myVendor(req);
  if (!mine) return res.json({ listings: [], vendor: null });
  res.json({
    vendor: vendors.getVendor(mine.id),
    listings: listings.listListings({ vendorId: mine.id, status: null })
  });
});



app.get('/api/listings/:id', (req, res) => {
  const l = listings.getListing(req.params.id);
  if (!l) return res.status(404).json({ error: 'listing not found' });
  // A non-active listing is visible only to its owner. Otherwise a buyer could
  // read, link to, and try to order a draft.
  if (l.status !== 'active') {
    const mine = myVendor(req);
    if (!mine || l.vendorId !== mine.id) {
      return res.status(404).json({ error: 'listing not found' });
    }
  }
  res.json({ listing: l });
});



app.post('/api/listings', (req, res) => {
  if (!requireAuth(req, res)) return;
  const mine = myVendor(req);
  if (!mine) {
    return res.status(403).json({ error: 'create a vendor profile before listing anything' });
  }
  try {
    // vendorId comes from the caller's own vendor row, never from the body:
    // otherwise anyone could list goods under another seller's name.
    const l = listings.createListing({
      vendorId: mine.id,
      title: req.body?.title,
      description: req.body?.description ?? '',
      type: req.body?.type ?? 'product',
      price: req.body?.price,
      currency: req.body?.currency ?? 'KES',
      quantityAvailable:
        req.body?.quantityAvailable === undefined ? null : req.body.quantityAvailable,
      locationName: req.body?.locationName ?? null,
      objectId: req.body?.objectId ?? null,
      media: req.body?.media ?? [],
      // The two axes a flow needs. Optional; the domain refuses a flow whose
      // endpoints are missing, so the rule lives in one place, not in the UI.
      flow: req.body?.flow ?? null,
      originKind: req.body?.originKind ?? null,
      originName: req.body?.originName ?? null,
      destinationKind: req.body?.destinationKind ?? null,
      destinationName: req.body?.destinationName ?? null,
      unitLabel: req.body?.unitLabel ?? null,
      minOrderQuantity: req.body?.minOrderQuantity ?? null
    });
    res.status(201).json({ listing: l });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});



app.patch('/api/listings/:id', (req, res) => {
  const l = ownedListing(req, res);
  if (!l) return;
  try {
    // `status` is not in the domain allow-list: a status moves only through
    // the transition endpoint, so the lifecycle table cannot be bypassed by
    // PATCHing a field. A change to a MONEY field on a published offer needs a
    // `reason`, and lands in the offer's revision history.
    const listing = listings.updateListing(l.id, req.body ?? {}, {
      actorId: callerId(req),
      reason: (req.body ?? {}).reason
    });
    res.json({
      listing,
      revisions: listings.revisionsFor(l.id, { limit: 20 }),
      moneyFields: listings.MONEY_FIELDS,
      note: 'Prices and terms on a published offer change with a stated reason, and every change stays on the record. Orders already placed keep the price they were quoted at.'
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});

// The money history of one offer: what it cost before, what it costs now, and the
// owner's own words for why. Same ownership guard as the PATCH, and it is NOT a
// public route — a shop's pricing history is commercial information.
app.get('/api/listings/:id/revisions', (req, res) => {
  const l = ownedListing(req, res);
  if (!l) return;
  res.json({ revisions: listings.revisionsFor(l.id) });
});



app.post('/api/listings/:id/status', (req, res) => {
  const l = ownedListing(req, res);
  if (!l) return;
  try {
    const { listing, changed } = listings.transitionListing(l.id, req.body?.status);
    // Only a real change emits activity. A double-tapped Pause is a no-op.
    if (changed) {
      const type =
        listing.status === 'active' ? 'listing_published'
        : listing.status === 'paused' ? 'listing_paused'
        : listing.status === 'archived' ? 'listing_archived'
        : null;
      if (type) {
        signals.emitSignal({
          type, actorId: callerId(req),
          objectId: listing.objectId ?? null,
          metadata: { listingId: listing.id }
        });
      }
    }
    res.json({ listing, changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


// --- Orders ------------------------------------------------------------------

/**
 * My orders. `role=vendor` returns what I sold, anything else what I bought.
 * There is no "all orders" view: every query is scoped to the caller as one
 * party or the other.
 */

app.get('/api/orders', (req, res) => {
  const me = callerId(req);
  if (req.query.role === 'vendor') {
    const mine = myVendor(req);
    if (!mine) return res.json({ orders: [] });
    return res.json({ orders: orders.listOrders({ vendorId: mine.id, status: req.query.status ?? null }) });
  }
  res.json({ orders: orders.listOrders({ buyerId: me, status: req.query.status ?? null }) });
});



app.get('/api/orders/:id', (req, res) => {
  const o = orders.getOrder(req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  // Only the two parties to an order may read it.
  const me = callerId(req);
  if (o.buyerId !== me && o.vendorOwnerId !== me) {
    return res.status(404).json({ error: 'order not found' });
  }
  res.json({ order: o });
});



app.post('/api/orders', (req, res) => {
  if (!requireAuth(req, res)) return;
  try {
    // buyerId from the caller. price/total are NOT read -- the server derives
    // money from the listing row. A body carrying {price:1,total:1} against a
    // KES 500 listing produces an order for the real amount.
    const order = orders.createOrder({
      delivery: req.body?.delivery,
      listingId: req.body?.listingId,
      buyerId: callerId(req),
      quantity: req.body?.quantity ?? 1,
      note: req.body?.note ?? '',
      // Client-supplied key. Safe to trust because it is scoped to the
      // authenticated buyer: the worst a caller can do with a forged key is
      // deduplicate their OWN orders.
      idempotencyKey: req.body?.idempotencyKey ?? null,
      // The field agent who generated this lead, if any. Server-validated
      // (must be a real third-party member — never the buyer or the vendor).
      leadAgentId: req.body?.leadAgentId ?? null
    });
    signals.emitSignal({
      type: 'order_placed',
      actorId: callerId(req),
      metadata: { orderId: order.id, listingId: order.listingId, vendorId: order.vendorId }
    });
    // A vault linking this order gains an order_created footstep.
    vault.emitOrderFootsteps(order.id, 'order_created', {
      actorId: callerId(req),
      value: order.total,
      dedupeKey: `order:${order.id}`,
      metadata: { listingId: order.listingId, vendorId: order.vendorId }
    });
    res.status(201).json({ order });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


/**
 * Fulfilment. The VENDOR marks an order delivered.
 *
 * Fulfilment and payment are different facts and are recorded separately: an
 * order can be fulfilled and unpaid, or paid and unfulfilled. Marking this
 * does not touch money.
 */

app.post('/api/orders/:id/fulfil', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });

  const mine = myVendor(req);
  if (!mine || o.vendorId !== mine.id) {
    return res.status(403).json({ error: 'only the vendor for this order may fulfil it' });
  }
  try {
    const { order, changed } = orders.transitionOrder(o.id, 'fulfilled', {
      note: req.body?.note ?? ''
    });
    if (changed) {
      signals.emitSignal({
        type: 'order_fulfilled',
        actorId: callerId(req),
        metadata: { orderId: order.id, vendorId: order.vendorId }
      });
      vault.emitOrderFootsteps(order.id, 'order_fulfilled', {
        actorId: callerId(req),
        dedupeKey: `order:fulfilled:${order.id}`
      });
    }
    res.json({ order, changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


/**
 * Advance an order along the fulfilment path (accepted / preparing / ready).
 *
 * The stages are optional -- a simple handover goes straight to fulfilled --
 * but a seller who wants to keep the buyer informed can walk them. The
 * transition table is server-authoritative either way: a client cannot jump
 * backwards or skip into a terminal state through this endpoint.
 */

app.post('/api/orders/:id/stage', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });

  const mine = myVendor(req);
  if (!mine || o.vendorId !== mine.id) {
    return res.status(403).json({ error: 'only the vendor for this order may advance it' });
  }
  const stage = req.body?.stage;
  // Only the fulfilment stages are reachable here. Settlement is economic and
  // has its own endpoint with its own guard; disputes belong to the buyer.
  if (!['accepted', 'preparing', 'ready'].includes(stage)) {
    return res.status(400).json({ error: 'stage must be one of accepted, preparing, ready' });
  }
  try {
    const { order, changed } = orders.transitionOrder(o.id, stage, { note: req.body?.note ?? '' });
    if (changed) {
      signals.emitSignal({
        type: 'order_stage_changed',
        actorId: callerId(req),
        metadata: { orderId: order.id, stage }
      });
    }
    res.json({ order, changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


/**
 * Cancel. Either party may cancel an order that has not yet been delivered.
 */

app.post('/api/orders/:id/cancel', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  const me = callerId(req);
  if (o.buyerId !== me && o.vendorOwnerId !== me) {
    return res.status(404).json({ error: 'order not found' });
  }
  try {
    const { order, changed } = orders.transitionOrder(o.id, 'cancelled', {
      note: req.body?.reason ?? ''
    });
    if (changed) {
      signals.emitSignal({
        type: 'order_cancelled', actorId: me, metadata: { orderId: order.id }
      });
    }
    res.json({ order, changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


/**
 * Settlement. Deliberately requires a SETTLED ledger transaction whose amount
 * matches the order total.
 *
 * No payment provider is connected (see domain/ledger.js), so in practice this
 * endpoint refuses -- and that refusal is the honest answer. It exists so the
 * shape is ready for Batch 4, not so the marketplace can pretend money moved.
 */

app.post('/api/orders/:id/settle', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  const mine = myVendor(req);
  if (!mine || o.vendorId !== mine.id) {
    return res.status(403).json({ error: 'only the vendor for this order may settle it' });
  }
  try {
    if (req.body?.transactionId) {
      orders.attachTransaction(o.id, req.body.transactionId);
    }
    const { order, changed } = orders.transitionOrder(o.id, 'settled');
    if (changed) {
      signals.emitSignal({
        type: 'order_settled',
        actorId: callerId(req),
        value: order.total,
        metadata: { orderId: order.id, vendorId: order.vendorId }
      });
      vault.emitOrderFootsteps(order.id, 'order_settled', {
        actorId: callerId(req),
        value: order.total,
        dedupeKey: `order:settled:${order.id}`
      });
    }
    res.json({ order, changed });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


// --- Disputes ----------------------------------------------------------------

/**
 * A buyer contests their own order. Establishes one fact: this transaction is
 * contested and must not be read as clean fulfilment. No refund is invented,
 * because no money has moved and arbitration is deferred.
 */

app.post('/api/orders/:id/dispute', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  try {
    const { dispute, order, changed } = orders.openDispute({
      orderId: o.id,
      reportedBy: callerId(req),
      reason: req.body?.reason
    });
    if (changed) {
      signals.emitSignal({
        type: 'order_disputed',
        actorId: callerId(req),
        metadata: { orderId: order.id, disputeId: dispute.id }
      });
    }
    res.status(changed ? 201 : 200).json({ dispute, order, changed });
  } catch (e) {
    // "only the buyer may dispute this order" is an authority refusal.
    const msg = String(e.message ?? e);
    res.status(msg.startsWith('only the buyer') ? 403 : 400).json({ error: msg });
  }
});


/**
 * What this seller has earned, derived by scanning their settled orders.
 *
 * NOT a balance and not a wallet. `payoutAvailable` is false while no payment
 * provider is connected, and the response says why -- the difference between
 * "you have earned this" and "you can withdraw this" is not cosmetic.
 */

app.get('/api/vendors/me/earnings', (req, res) => {
  if (!requireAuth(req, res)) return;
  const mine = myVendor(req);
  if (!mine) return res.status(404).json({ error: 'vendor not found' });
  res.json({ earnings: settlement.vendorEarnings(mine.id) });
});


/** The split for one order. Only the two parties may read it. */

app.get('/api/orders/:id/settlement', (req, res) => {
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  const me = callerId(req);
  if (o.buyerId !== me && o.vendorOwnerId !== me) {
    return res.status(404).json({ error: 'order not found' });
  }
  res.json({ settlement: settlement.orderSettlement(o.id) });
});


/**
 * Reconciliation. Recomputes the economic picture and reports disagreements
 * rather than asserting consistency.
 */
// --- Payments ----------------------------------------------------------------

/**
 * Start paying for an order. The AMOUNT IS NOT ACCEPTED FROM THE CLIENT -- it
 * is read from the order row inside createIntent().
 */

app.post('/api/orders/:id/pay', async (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  try {
    const { intent, reused } = payment.createIntent({
      orderId: req.params.id,
      payerId: me,
      phone: req.body?.phone ?? null,
      idempotencyKey: req.body?.idempotencyKey ?? null
    });

    // No provider configured: return the intent and say so plainly. The order
    // is still payable out-of-band; Brief simply cannot collect it.
    if (!payment.activeProvider()) {
      return res.status(503).json({
        intent,
        reused,
        charged: false,
        ...payment.providerStatus()
      });
    }

    const result = await payment.requestPayment(intent.id);
    if (!result.ok) {
      vault.emitOrderFootsteps(intent.orderId, 'payment_failed', {
        actorId: me,
        dedupeKey: `pay:fail:${intent.id}`,
        metadata: { reason: result.reason }
      });
      return res.status(502).json({ intent: payment.getIntent(intent.id), error: result.reason, detail: result.detail ?? null });
    }
    vault.emitOrderFootsteps(intent.orderId, 'payment_authorized', {
      actorId: me,
      value: intent.amount,
      dedupeKey: `pay:authorized:${intent.id}`,
      metadata: { providerRef: result.providerRef }
    });
    res.status(reused ? 200 : 201).json({
      intent: payment.getIntent(intent.id), reused, charged: true,
      authorizationUrl: result.authorizationUrl ?? null,
      customerMessage: result.customerMessage
    });
  } catch (e) {
    res.status(400).json({ error: String(e.message ?? e) });
  }
});


/** Payment state for an order. Parties only. */

app.get('/api/orders/:id/payments', (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const o = store.find('orders', (x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'order not found' });
  if (o.buyerId !== me && o.vendorOwnerId !== me) {
    return res.status(404).json({ error: 'order not found' });
  }
  res.json({ payments: payment.listIntentsForOrder(o.id) });
});


/**
 * M-Pesa STK Push callback, through the provider seam.
 *
 * KCB relays Safaricom's own STK result and it carries NO signature, so the
 * deployment-controlled defence is a secret path segment (BUNI_WEBHOOK_SECRET)
 * that only stops drive-by POSTs — the authenticity check that matters is the
 * domain's: the reference must be one Brief issued, with a matching amount. The REAL authenticity check is
 * inside confirmPayment(): the
 * callback must carry a checkout_request_id Brief issued and an amount that
 * matches the stored intent. It FAILS CLOSED: with no secret configured,
 * nothing is accepted. Every callback is persisted before processing so a
 * replay or a malformed payload is auditable.
 */

app.post('/api/webhooks/buni/:secret', (req, res) => {
  const check = providers.verifyCallbackSecret(req.params.secret);
  store.insert('paymentCallbacks', {
    id: newId('cb'), provider: check.provider ?? 'buni', accepted: check.ok,
    reason: check.reason ?? null, body: req.body ?? null, at: now()
  });
  if (!check.ok) {
    recordError('payment_webhook', null, `rejected callback: ${check.reason}`);
    // 403, and deliberately no detail about why.
    return res.status(403).json({ error: 'rejected' });
  }

  const parsed = providers.parseCallback(req.body);
  if (!parsed.ok) {
    recordError('payment_webhook', null, 'unrecognised callback payload');
    return res.status(400).json({ error: 'unrecognised payload' });
  }

  const applied = payment.confirmPayment({
    providerRef: parsed.checkoutRequestId,
    succeeded: parsed.succeeded,
    amount: parsed.amount,
    receipt: parsed.receipt,
    failureReason: parsed.failureReason,
    cancelled: parsed.cancelled
  });

  // Phase 8: the SAME callback also serves Work Order payments. The
  // provider reference is globally unique across both rails, so dispatch is
  // unambiguous and both confirmations are idempotent.
  let appliedWork = null;
  if (!applied.ok && applied.reason === 'unknown_reference') {
    appliedWork = workPayment.confirmPayment({
      providerRef: parsed.checkoutRequestId,
      succeeded: parsed.succeeded,
      amount: parsed.amount,
      receipt: parsed.receipt,
      failureReason: parsed.failureReason,
      cancelled: parsed.cancelled
    });
  }
  if (appliedWork && appliedWork.ok) {
    return res.json({ ok: true, duplicate: Boolean(appliedWork.duplicate) });
  }

  // Lipa Mdogo: the same callback also serves installment collections. The
  // reference is globally unique across all three rails; confirmation is
  // idempotent and records a signed receipt hash.
  let appliedLmd = null;
  if (!applied.ok && (!appliedWork || !appliedWork.ok)) {
    appliedLmd = lipaMdogo.confirmPayment({
      providerRef: parsed.checkoutRequestId,
      succeeded: parsed.succeeded,
      amount: parsed.amount,
      receipt: parsed.receipt,
      failureReason: parsed.failureReason,
      cancelled: parsed.cancelled
    });
  }
  if (appliedLmd && appliedLmd.ok) {
    return res.json({ ok: true, duplicate: Boolean(appliedLmd.duplicate) });
  }

  if (!applied.ok) {
    recordError('payment_webhook', null, `callback not applied: ${applied.reason}`);
    // 200 to the provider: retrying will not help, and the rail retries on
    // non-2xx (up to 5 attempts with backoff). The failure is recorded on
    // our side instead.
    return res.status(200).json({ ok: false, reason: applied.reason });
  }

  if (applied.transactionId && !applied.duplicate && applied.intent?.orderId) {
    // Attach the money to the order and emit the signal. Settlement itself
    // still goes through the existing guarded transition.
    try {
      orders.attachTransaction(applied.intent.orderId, applied.transactionId);
      signals.emitSignal({
        type: 'order_paid', actorId: applied.intent.payerId,
        metadata: { orderId: applied.intent.orderId, transactionId: applied.transactionId }
      });
    } catch (e) {
      recordError('payment_webhook', null, `attach failed: ${String(e.message ?? e)}`);
    }
    // The vault timeline records the settlement exactly once (dedupe by the
    // provider reference), independent of the ledger's own replay protection.
    vault.emitOrderFootsteps(applied.intent.orderId, 'payment_settled', {
      actorId: applied.intent.payerId,
      value: applied.intent.amount,
      dedupeKey: `pay:settled:${applied.intent.providerRef}`,
      metadata: { receipt: applied.intent.receipt, transactionId: applied.transactionId }
    });
  }

  res.json({ ok: true, duplicate: Boolean(applied.duplicate) });
});


/**
 * M-Pesa Daraja B2C payout result callback.
 *
 * Daraja does not sign callbacks, so the deployment-controlled defence is the
 * secret path segment (MPESA_CALLBACK_SECRET). The REAL check is inside
 * confirmPayout(): the ConversationID must match a payout Brief issued. It
 * fails closed. Every callback is persisted before processing so a replay or
 * malformed payload is auditable, mirroring the payment webhook.
 */

app.post('/api/webhooks/mpesa-b2c/:secret', (req, res) => {
  const check = mpesa.verifyCallbackSecret(req.params.secret);
  store.insert('paymentCallbacks', {
    id: newId('cb'), provider: 'mpesa-b2c', accepted: check.ok,
    reason: check.reason ?? null, body: req.body ?? null, at: now()
  });
  if (!check.ok) {
    recordError('mpesa_b2c_webhook', null, `rejected callback: ${check.reason}`);
    return res.status(403).json({ error: 'rejected' });
  }

  const parsed = mpesa.parseB2CResult(req.body);
  if (!parsed.ok) {
    recordError('mpesa_b2c_webhook', null, 'unrecognised callback payload');
    return res.status(400).json({ error: 'unrecognised payload' });
  }

  const applied = settlement.confirmPayout({
    providerRef: parsed.conversationId,
    succeeded: parsed.succeeded,
    failureReason: parsed.failureReason
  });
  if (!applied.ok) {
    recordError('mpesa_b2c_webhook', null, `callback not applied: ${applied.reason}`);
    // 200 to Daraja: a retry will not help, and Daraja retries on non-2xx.
    return res.status(200).json({ ok: false, reason: applied.reason });
  }
  res.json({ ok: true, duplicate: Boolean(applied.duplicate) });
});


// --- Payouts -----------------------------------------------------------------

/**
 * Request a payout of settled earnings. The amount is DERIVED server-side
 * from settled orders minus anything already paid or in flight.
 */

app.post('/api/vendors/me/payouts', async (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const mine = myVendor(req);
  if (!mine) return res.status(404).json({ error: 'you do not have a vendor profile' });
  try {
    const { payout, reused } = settlement.requestPayout({
      vendorId: mine.id,
      requestedBy: me,
      phone: req.body?.phone ?? null,
      idempotencyKey: req.body?.idempotencyKey ?? null
    });
    if (reused) return res.json({ payout, reused: true });
    const sent = await settlement.sendPayout(payout.id);
    if (!sent.ok) {
      return res.status(502).json({ payout: store.find('payouts', (p) => p.id === payout.id), error: sent.reason });
    }
    res.status(201).json({ payout: store.find('payouts', (p) => p.id === payout.id), reused: false });
  } catch (e) {
    // No disbursement provider is a 503 (unavailable, try later), not a 400
    // (you did it wrong). The code is machine-readable so a client can state
    // the truth rather than implying payouts work.
    const status = e.code === 'provider_unavailable' ? 503 : 400;
    res.status(status).json({ error: String(e.message ?? e), code: e.code ?? null });
  }
});



app.get('/api/vendors/me/payouts', (req, res) => {
  const me = requireAuth(req, res);
  if (!me) return;
  const mine = myVendor(req);
  if (!mine) return res.json({ payouts: [] });
  res.json({ payouts: settlement.listPayouts(mine.id) });
});


/** Disputes raised against my listings, so a seller can see what is contested. */

app.get('/api/disputes', (req, res) => {
  const mine = myVendor(req);
  if (req.query.role === 'vendor') {
    if (!mine) return res.json({ disputes: [] });
    return res.json({ disputes: orders.listDisputes({ vendorId: mine.id }) });
  }
  res.json({ disputes: orders.listDisputes({ reportedBy: callerId(req) }) });
});
}

