// ---------------------------------------------------------------------------
// HUDUMALINK — WHATSAPP INTERACTIVE MESSAGE ROUTER
//
// This is the blueprint's "WhatsApp Interactive Message Router": a webhook
// handler that classifies an inbound Cloud API payload (button click, list pick
// or free text) and drives a server-side state machine across the whole buying
// journey WITHOUT a frontend.
//
// THE LOOP IT OWNS:
//
//   inbound message
//     -> classify (button_reply / list_reply / free text)
//     -> advance the per-phone session state machine
//     -> as needed: create an order, fire the M-Pesa STK push, build replies
//     -> dispatch the reply payloads back into the chat thread
//
// WHAT THE ROUTER DOES NOT DECIDE:
//
//   * Money. It never reads an amount from the chat. The order's total comes
//     from the catalog, and the STK amount comes from the order row.
//   * Completion. Payment confirmation and document delivery arrive through
//     the M-Pesa callback route, which calls the escrow/executor layers
//     directly. The router only reports status when the citizen asks.
//
// INJECTABLE SEAMS (so the conversational logic is fully testable offline):
//
//   dispatch  how reply payloads reach WhatsApp (default: the real Cloud API).
//   mpesa     the STK provider (default: the Daraja connector).
//   logger    structured logging (default: noop).
// ---------------------------------------------------------------------------

import * as catalog from './catalog.js';
import * as session from './session.js';
import * as orders from './orders.js';
import * as users from './users.js';
import * as wa from './whatsapp.js';
import * as mpesa from '../../connectors/mpesa.js';
import { store } from '../../store.js';
import crypto from 'node:crypto';
import * as intake from '../engine/intake.js';

const WELCOME =
  'Habari! Welcome to HudumaLink. Skip the traffic, queues and system errors at ' +
  'Times Tower or the Huduma Centre. What result can we deliver to your phone today?';

// ---------------------------------------------------------------------------
// ACTION CLASSIFICATION
//
// A "structural classifier": the shape of the inbound payload tells us what
// kind of input it is, so we never run a fuzzy intent guess over a definitive
// button id. Button/list ids are self-describing ("cat:business", "svc:cr12").
// ---------------------------------------------------------------------------

export function classify(interactive, text) {
  const id = interactive?.button_reply?.id ?? interactive?.list_reply?.id ?? null;
  if (id) return { kind: 'action', id, title: interactive?.button_reply?.title ?? interactive?.list_reply?.title ?? null };
  if (text && String(text).trim()) return { kind: 'text', text: String(text).trim() };
  return { kind: 'empty' };
}

function parseActionId(id) {
  const parts = String(id).split(':');
  return { type: parts[0] ?? null, value: parts.slice(1).join(':') };
}

// Words that mean "take me back to the start" in any state.
function isMenuShortcut(text) {
  return /^(0|menu|back|home|start|hi|hello|hujambo|habari|hey)$/i.test(String(text).trim());
}

// ---------------------------------------------------------------------------
// MENU BUILDERS (pure payload construction)
// ---------------------------------------------------------------------------

function rootMenu(to) {
  return wa.buttons(to, WELCOME, [
    { id: 'cat:business', title: 'Business & Corporate' },
    { id: 'cat:lands', title: 'Lands & Property' },
    { id: 'cat:delivery', title: 'Document Delivery' }
  ], { footer: 'Reply 0 anytime to see this menu' });
}

function categoryMenu(to, categoryId) {
  const cat = catalog.categoryById(categoryId);
  if (!cat) return rootMenu(to);
  const services = catalog.servicesByCategory(categoryId);
  const rows = services.map((s) => {
    const p = catalog.priceFor(s);
    return { id: `svc:${s.id}`, title: s.title, description: `KES ${p.total} — ${s.blurb}` };
  });
  return wa.list(to,
    `${cat.title}\n\nSelect the result you need:`,
    'Select service',
    [{ title: cat.title, rows }],
    { footer: 'Reply 0 to go back' }
  );
}

function confirmMenu(to, service) {
  const p = catalog.priceFor(service);
  return wa.buttons(to,
    `${service.title}\n\n${catalog.feeBreakdown(service)}\n\nConfirm to pay KES ${p.total} by M-Pesa.`,
    [
      { id: 'pay:confirm', title: 'Pay with M-Pesa' },
      { id: 'pay:cancel', title: 'Cancel' }
    ],
    { footer: 'Reply 0 to cancel' }
  );
}

function paymentInstructions(to, order) {
  return wa.text(to,
    `✅ Order received: ${order.serviceTitle}.\n` +
    `Enter your M-Pesa PIN on your phone to authorise KES ${order.totalFee}.\n\n` +
    `We'll confirm here the moment payment is received. ` +
    `Reply *status* to check, or *0* for the menu.`
  );
}

function statusMessage(to, order) {
  const parts = [`Order ${order.id}`, `Service: ${order.serviceTitle}`, `Status: ${order.status}`];
  if (order.escrow) {
    parts.push(`Payment: ${order.escrow.status === 'LOCKED' ? 'received (held in escrow)' : order.escrow.status}`);
  } else {
    parts.push('Payment: awaiting M-Pesa');
  }
  if (order.document) parts.push('Document: delivered ✅');
  return wa.text(to, parts.join('\n'));
}

// ---------------------------------------------------------------------------
// THE HANDLER
// ---------------------------------------------------------------------------

export async function handleInbound(event, opts = {}) {
  const dispatch = opts.dispatch ?? ((replies) => ({ dispatched: replies.length, results: [] }));
  const stk = opts.mpesa ?? mpesa;
  const log = opts.logger ?? (() => {});

  const rawPhone = event?.phone;
  const phone = users.normalisePhone(rawPhone);
  if (!phone) {
    const replies = [wa.text(rawPhone ?? 'unknown', "We couldn't read that phone number. Please try again.")];
    const out = await dispatch(replies);
    return { ok: false, reason: 'invalid_phone', replies, ...out };
  }

  // Ensure the user exists and keep their display name fresh from the profile.
  const user = users.getOrCreateUser(phone);
  if (event?.name && !user.displayName) {
    store.update('hudumaUsers', user.id, { displayName: String(event.name).slice(0, 80) });
  }

  const interactive = event?.interactive ?? null;
  const text = event?.text ?? null;
  const input = classify(interactive, text);

  let result = await route(phone, user, input, { stk, log });
  const replies = result.replies;
  const out = await dispatch(replies);

  log('huduma_router', { phone, state: result.session?.state, replies: replies.length });
  return {
    ok: true,
    phone,
    user,
    session: result.session,
    order: result.order ?? null,
    replies,
    ...out
  };
}

// ---------------------------------------------------------------------------
// STATE ROUTING
// ---------------------------------------------------------------------------

async function route(phone, user, input, { stk, log }) {
  const sess = session.getSession(phone);

  // Global menu shortcuts work from anywhere.
  if (input.kind === 'text' && isMenuShortcut(input.text)) {
    const s = session.resetToRoot(phone);
    return { session: s, replies: [rootMenu(phone)] };
  }
  if (input.kind === 'text' && /^(status|order|wapi|nini)$/i.test(input.text) && sess.orderId) {
    const order = orders.getOrder(sess.orderId);
    return { session: sess, order, replies: [statusMessage(phone, order)] };
  }

  switch (sess.state) {
    case session.STATES.MENU_ROOT:
      return onRoot(phone, input);
    case session.STATES.MENU_CATEGORY:
      return onCategory(phone, sess, input);
    case session.STATES.AWAITING_INPUT:
      return onAwaitingInput(phone, sess, input);
    case session.STATES.CONFIRMING_ORDER:
      return onConfirming(phone, sess, input, { stk, log });
    case session.STATES.AWAITING_PAYMENT:
      return onAwaitingPayment(phone, sess, input, { stk, log });
    default:
      return { session: session.resetToRoot(phone), replies: [rootMenu(phone)] };
  }
}

function onRoot(phone, input) {
  if (input.kind === 'action') {
    const a = parseActionId(input.id);
    if (a.type === 'cat' && catalog.categoryById(a.value)) {
      const s = session.setSession(phone, { state: session.STATES.MENU_CATEGORY, categoryId: a.value });
      return { session: s, replies: [categoryMenu(phone, a.value)] };
    }
  }
  return { session: session.getSession(phone), replies: [rootMenu(phone)] };
}

function onCategory(phone, sess, input) {
  if (input.kind === 'action') {
    const a = parseActionId(input.id);
    if (a.type === 'svc' && catalog.getService(a.value)) {
      return startService(phone, a.value);
    }
  }
  // Anything else (including an unrecognised action) re-shows the category.
  return { session: session.getSession(phone), replies: [categoryMenu(phone, sess.categoryId)] };
}

function startService(phone, serviceId) {
  const svc = catalog.getService(serviceId);
  if (!svc.inputs.length) {
    // No inputs to capture: go straight to the price confirmation.
    const s = session.setSession(phone, {
      state: session.STATES.CONFIRMING_ORDER,
      serviceId,
      capturedInputs: {},
      awaitingField: null
    });
    return { session: s, replies: [confirmMenu(phone, svc)] };
  }
  const first = svc.inputs[0];
  const s = session.setSession(phone, {
    state: session.STATES.AWAITING_INPUT,
    serviceId,
    categoryId: null,
    awaitingField: first.key,
    capturedInputs: {}
  });
  return { session: s, replies: [wa.text(phone, `${svc.title}\n\nPlease enter your *${first.label}*:`)] };
}

function onAwaitingInput(phone, sess, input) {
  const svc = catalog.getService(sess.serviceId);
  if (!svc) return { session: session.resetToRoot(phone), replies: [rootMenu(phone)] };

  if (input.kind !== 'text') {
    // A button tap mid-input is not a valid answer; re-ask the same field.
    return { session: sess, replies: [wa.text(phone, `Please enter your *${currentField(svc, sess).label}*:`)] };
  }

  // Capture this answer.
  session.captureInput(phone, sess.awaitingField, input.text.slice(0, 500));
  const next = nextField(svc, sess.awaitingField);

  if (next) {
    const s = session.setSession(phone, { awaitingField: next.key });
    return { session: s, replies: [wa.text(phone, `Got it. Now enter your *${next.label}*:`)] };
  }

  // All inputs captured: move to price confirmation.
  const s = session.setSession(phone, {
    state: session.STATES.CONFIRMING_ORDER,
    awaitingField: null
  });
  return { session: s, replies: [confirmMenu(phone, svc)] };
}

function onConfirming(phone, sess, input, { stk, log }) {
  if (input.kind === 'action') {
    const a = parseActionId(input.id);
    if (a.type === 'pay' && a.value === 'confirm') {
      return placeOrderAndPay(phone, sess, { stk, log });
    }
    if (a.type === 'pay' && a.value === 'cancel') {
      return { session: session.resetToRoot(phone), replies: [wa.text(phone, 'Order cancelled. Anything else?')] };
    }
  }
  // Re-show the confirmation.
  const svc = catalog.getService(sess.serviceId);
  return { session: sess, replies: [confirmMenu(phone, svc)] };
}

/**
 * The order-creation + STK step. This is the single place money enters the
 * flow, and it enforces both integrity rules at once:
 *
 *   1. The order total is DERIVED from the catalog (createOrder ignores any
 *      client amount).
 *   2. The STK amount is read from that order row, so the figure on the user's
 *      PIN prompt is guaranteed to match the escrow that locks it.
 */
async function placeOrderAndPay(phone, sess, { stk, log }) {
  const svc = catalog.getService(sess.serviceId);
  // An idempotency key scoped to (phone, service, captured inputs): a
  // double-tapped Confirm (or a retried webhook) returns the same order, but a
  // genuinely different request (changed inputs) is allowed.
  const key = `confirm:${phone}:${sess.serviceId}:${hashInputs(sess.capturedInputs)}`;
  // A WhatsApp client double-tapping Confirm is the same real act twice. The
  // derived key is recorded centrally as well as enforced on the order row.
  intake.note({ key: `huduma-chat:${key}`, source: 'huduma', handler: 'confirm_order' });

  let order;
  try {
    order = orders.createOrder({
      phone,
      serviceId: sess.serviceId,
      capturedInputs: sess.capturedInputs,
      idempotencyKey: key
    });
    orders.attachUser(order.id, users.getOrCreateUser(phone).id);
  } catch (e) {
    log('huduma_order_failed', { phone, reason: String(e.message ?? e) });
    return {
      session: session.resetToRoot(phone),
      replies: [wa.text(phone, `We couldn't place that order: ${e.message}. Reply 0 to start over.`)]
    };
  }

  const push = await stk.stkPush({
    amount: order.totalFee,
    phone,
    accountReference: order.id,
    description: svc.title
  });

  if (push.ok && push.checkoutRequestId) {
    orders.registerStkPush(order.id, { mpesaCheckoutId: push.checkoutRequestId, amount: order.totalFee });
    const s = session.setSession(phone, { state: session.STATES.AWAITING_PAYMENT, orderId: order.id });
    log('huduma_stk_pushed', { phone, orderId: order.id, checkout: push.checkoutRequestId });
    return { session: s, order, replies: [paymentInstructions(phone, order)] };
  }

  // HONEST FAILURE. The STK could not start (provider unconfigured, rejected,
  // network). The order is saved and PENDING; we tell the citizen exactly what
  // happened and that their money was not taken, and let them retry.
  const reason = push.reason ?? 'unknown';
  const s = session.setSession(phone, { state: session.STATES.AWAITING_PAYMENT, orderId: order.id });
  log('huduma_stk_failed', { phone, orderId: order.id, reason });
  return {
    session: s,
    order,
    replies: [wa.text(phone,
      `Order ${order.id} is saved, but we couldn't start M-Pesa right now (${reason}). ` +
      `No money has been taken. Reply *retry* to try again, or *0* for the menu.`)]
  };
}

function onAwaitingPayment(phone, sess, input, { stk, log }) {
  const order = sess.orderId ? orders.getOrder(sess.orderId) : null;

  if (input.kind === 'text' && /^retry$/i.test(input.text) && order && order.status === 'PENDING') {
    // Re-attempt the STK for an unpaid order.
    return retryPayment(phone, sess, order, { stk, log });
  }
  if (order) {
    return { session: sess, order, replies: [statusMessage(phone, order)] };
  }
  return { session: session.resetToRoot(phone), replies: [rootMenu(phone)] };
}

async function retryPayment(phone, sess, order, { stk, log }) {
  const push = await stk.stkPush({
    amount: order.totalFee, phone, accountReference: order.id, description: order.serviceTitle
  });
  if (push.ok && push.checkoutRequestId) {
    orders.registerStkPush(order.id, { mpesaCheckoutId: push.checkoutRequestId, amount: order.totalFee });
    log('huduma_stk_retry', { phone, orderId: order.id });
    return { session: sess, order, replies: [paymentInstructions(phone, order)] };
  }
  return {
    session: sess, order,
    replies: [wa.text(phone, `Still couldn't start M-Pesa (${push.reason}). Reply *retry* or *0*.`)]
  };
}

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function currentField(service, sess) {
  return service.inputs.find((f) => f.key === sess.awaitingField) ?? service.inputs[0];
}

function nextField(service, currentKey) {
  const idx = service.inputs.findIndex((f) => f.key === currentKey);
  return idx >= 0 && idx + 1 < service.inputs.length ? service.inputs[idx + 1] : null;
}

function hashInputs(inputs) {
  // A stable digest of the captured answers, used for idempotency scoping.
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex').slice(0, 12);
}

// ---------------------------------------------------------------------------
// PAYMENT CONFIRMATION (called by the M-Pesa callback route)
//
// Centralised here so the callback route stays thin: it parses Daraja, calls
// applyPayment, and (on success) kicks off execution + notifies the user. The
// escrow math and state transitions all live in orders.js; this only orchestrates.
// ---------------------------------------------------------------------------

/**
 * Apply a reconciled Daraja callback to its order.
 *
 *   success  -> lockEscrow (PENDING -> PAID, escrow LOCKED)
 *   failure  -> failCheckout (escrow FAILED; order stays PENDING, retryable)
 *
 * Returns a structured result the callback route turns into an HTTP response.
 * On a successful lock it does NOT auto-execute: the callback route decides
 * whether to run the executor immediately (software services) or leave the
 * order PAID for a runner dispatch.
 */
export function applyPayment(parsed, { logger = () => {} } = {}) {
  if (!parsed?.succeeded) {
    const found = parsed.checkoutRequestId ? orders.findByCheckout(parsed.checkoutRequestId) : null;
    if (found) orders.failCheckout(found.order.id, { reason: parsed.failureReason ?? 'payment failed' });
    logger('huduma_payment_failed', { checkout: parsed.checkoutRequestId, reason: parsed.failureReason });
    return { ok: true, applied: 'failed', order: found?.order ?? null, duplicate: false };
  }

  const found = parsed.checkoutRequestId ? orders.findByCheckout(parsed.checkoutRequestId) : null;
  if (!found) {
    // A success callback whose checkout id we never issued. Refused: no order
    // to attach it to, and trusting it would let an unsolicited callback move
    // money.
    return { ok: false, reason: 'unknown_checkout', applied: null };
  }

  try {
    const { order, duplicate } = orders.lockEscrow(found.order.id, {
      mpesaCheckoutId: parsed.checkoutRequestId,
      amount: parsed.amount,
      receipt: parsed.receipt
    });
    logger('huduma_payment_locked', { orderId: order.id, duplicate });
    return { ok: true, applied: 'locked', order, duplicate };
  } catch (e) {
    // The most important refusal: the callback amount did not match the order
    // total. Surfaced so the route can record it for audit.
    logger('huduma_payment_lock_error', { orderId: found.order.id, error: String(e.message ?? e) });
    return { ok: false, reason: 'amount_mismatch', message: String(e.message ?? e) };
  }
}
