// ---------------------------------------------------------------------------
// WORK ORDER PAYMENTS — Phase 8.
//
// The financial rail under the Phase 5/6/7 economic chain. A Work Order's
// commercial agreement (agreements[].terms) is the SOURCE OF THE PAYABLE
// AMOUNT; this module records what actually happened financially, using the
// SAME provider seam and ledger as the marketplace order payments
// (domain/payment.js). There is deliberately no second ledger, no second
// transaction system, and no invented money.
//
// THE THREE SEPARATE FACTS (never conflated):
//   Quote accepted  !=  payment initiated
//   Payment initiated != payment successful
//   Payment successful != work completed
//   Work completed  != payment successful
//
//   * Work completion is owned by workOrders.js and is entirely independent
//     of payment. Nothing here completes, cancels or otherwise mutates a Work
//     Order's fulfillment state.
//   * Payment success is owned by the PROVIDER CALLBACK, never by an STK
//     request being accepted, and never by the UI.
//
// MONEY INTEGRITY:
//   * The payable amount derives from the accepted agreement's totalMinor
//     (integer minor units, computed exactly with BigInt in quoteValidation).
//   * The client NEVER supplies an amount. The server resolves it.
//   * The provider (M-Pesa STK) moves WHOLE currency units; `collectible`
//     is derived as round(amountMinor / 10^exp) using the same CURRENCIES
//     exponents as quotes. The callback amount is compared as INTEGERS, never
//     floats.
//   * The ledger entry records the whole-unit amount collected, with the exact
//     minor-unit amount preserved in metadata.
// ---------------------------------------------------------------------------

import { store, newId } from "../store.js";
import {
  activeCollectionProvider,
  collectionProvider,
  providerStatus as providerStatusView,
} from "../providers.js";
import { normalisePhone } from "../connectors/phone.js";
import { CURRENCIES } from "./quoteValidation.js";
import * as ledger from "./ledger.js";
import { emitSignal } from "./signal.js";
import * as review from "./engine/review.js";
import { recordAudit } from "../routes/helpers.js";

/**
 * THE PAYOUT FRONTIER (EVENT-ENGINE.md §8).
 *
 * Small payouts: a rule may release them, and the decision is recorded so it
 * can be counted. Large ones: a person decides. The number is DATA (a constant
 * an operator can override by environment, and the rule rows carry the
 * frontier), not a branch buried in a route.
 */
export const PAYOUT_AUTO_MAX = Number(process.env.BRIEF_PAYOUT_AUTO_MAX) || 5000;
export const RELEASE_THRESHOLD_KEY = 'payout_auto_max';

export const INTENT_STATUS = [
  "intent",      // created — Brief decided what should be paid (server amount)
  "authorized",  // provider accepted initiation (STK prompt sent) — "processing"
  "confirmed",   // provider CONFIRMED the customer paid — "succeeded"
  "failed",      // provider reported failure or amount mismatch
  "cancelled",   // customer cancelled on their handset
  "expired",     // stalled too long; closed by reconciliation/operator
];

const TERMINAL = new Set(["confirmed", "failed", "cancelled", "expired"]);

// --- Exact money helpers (minor units are the source of truth) --------------

export function minorExponent(currency) {
  return CURRENCIES[currency] ?? 2;
}

/** Whole currency units the provider can actually move (M-Pesa has no cents). */
export function collectibleAmount(amountMinor, currency) {
  const exp = minorExponent(currency);
  return Math.round(amountMinor / 10 ** exp);
}

/** Major-unit display value from minor units, exact for the supported exponents. */
export function minorToMajor(amountMinor, currency) {
  return amountMinor / 10 ** minorExponent(currency);
}

export function activeProvider() {
  return activeCollectionProvider();
}
export function providerStatus() {
  return providerStatusView();
}

// --- Intent -----------------------------------------------------------------

function workOrderForPayer(userId, workOrderId) {
  const w = store.lookup("workOrders", workOrderId);
  if (!w) throw new Error("work order not found");
  if (w.requesterId !== userId)
    throw new Error("only the requester may pay for this work order");
  return w;
}

function agreementOf(w) {
  const a = w.agreements.at(-1);
  if (!a || !a.terms) throw new Error("this work order has no commercial agreement");
  return a;
}

/**
 * Create a payment intent for a Work Order.
 *
 * THE AMOUNT IS READ FROM THE ACCEPTED AGREEMENT, never from the caller. An
 * amended agreement changes the amount only when the amendment is accepted —
 * payment eligibility always reads the LATEST agreement revision.
 */
export function createIntent({ workOrderId, payerId, phone = null, idempotencyKey = null }) {
  const w = workOrderForPayer(payerId, workOrderId);
  const agreement = agreementOf(w);
  const terms = agreement.terms;

  const amountMinor = terms.totalMinor;
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
    throw new Error("this work order has no payable amount");
  const currency = terms.currency ?? "KES";
  const amount = collectibleAmount(amountMinor, currency);
  if (!Number.isFinite(amount) || amount <= 0)
    throw new Error("the payable amount is not collectible in whole currency units");

  // Idempotency, scoped to the payer as everywhere else in Brief.
  if (idempotencyKey) {
    const prior = store.find(
      "workPaymentIntents",
      (p) => p.idempotencyKey === idempotencyKey && p.payerId === payerId,
    );
    if (prior) return { intent: prior, reused: true };
  }

  // A work order must not accumulate parallel live intents — two STK pushes is
  // how a customer pays twice.
  const live = store.find(
    "workPaymentIntents",
    (p) => p.workOrderId === workOrderId && !TERMINAL.has(p.status),
  );
  if (live) return { intent: live, reused: true };

  const now = new Date().toISOString();
  const intent = store.insert("workPaymentIntents", {
    id: newId("wpay"),
    workOrderId,
    requestId: w.requestId,
    payerId,
    payeeId: w.participantUserId,
    payeeParticipantId: w.participantId,
    amountMinor,
    amount, // whole currency units actually collectible
    currency,
    phone: phone ? normalisePhone(phone) : null,
    paymentMethod: "mpesa_stk",
    provider: activeProvider(),
    status: "intent",
    providerRef: null,
    receipt: null,
    transactionId: null,
    failureReason: null,
    idempotencyKey: idempotencyKey ?? null,
    createdAt: now,
    updatedAt: now,
    initiatedAt: null,
    confirmedAt: null,
    failedAt: null,
    history: [{ status: "intent", at: now }],
  });
  recordAudit("work_payment.created", {
    actorId: payerId,
    objectType: "work_payment_intent",
    objectId: intent.id,
    after: { workOrderId, amountMinor, amount, currency },
  });
  return { intent, reused: false };
}

export function getIntent(id) {
  return store.find("workPaymentIntents", (p) => p.id === id);
}

export function listIntentsForWorkOrder(workOrderId) {
  return store.filter("workPaymentIntents", (p) => p.workOrderId === workOrderId);
}

// ---------------------------------------------------------------------------
// INITIATION — ask the provider to collect. Provider acceptance is NOT payment.
// ---------------------------------------------------------------------------

export async function requestPayment(intentId, { fetchImpl = fetch } = {}) {
  const intent = getIntent(intentId);
  if (!intent) throw new Error("payment intent not found");
  if (intent.status !== "intent") {
    throw new Error(`this payment is already ${intent.status}`);
  }
  if (!intent.phone) throw new Error("a valid phone number is required");

  const providerName = activeCollectionProvider();
  if (!providerName) {
    return {
      ok: false,
      reason: "no_provider",
      message: providerStatus().reason,
      status: providerStatus(),
    };
  }
  const provider = collectionProvider(providerName);

  const res = await provider.collect({
    amount: intent.amount, // whole currency units
    phone: intent.phone,
    description: `Brief work order ${intent.workOrderId.slice(-12)}`,
    fetchImpl,
  });

  if (!res.ok) {
    store.update("workPaymentIntents", intent.id, {
      status: "failed",
      failureReason: res.reason,
      failedAt: new Date().toISOString(),
    });
    return { ok: false, reason: res.reason, detail: res };
  }

  store.update("workPaymentIntents", intent.id, {
    status: "authorized",
    providerRef: res.checkoutRequestId,
    initiatedAt: new Date().toISOString(),
  });
  return {
    ok: true,
    providerRef: res.checkoutRequestId,
    customerMessage: res.customerMessage ?? null,
  };
}

// ---------------------------------------------------------------------------
// CONFIRMATION — the provider callback. This is the ONLY place money appears.
// ---------------------------------------------------------------------------

export function confirmPayment({
  providerRef,
  succeeded,
  amount,
  receipt,
  failureReason = null,
  cancelled = false,
}) {
  const intent = store.find("workPaymentIntents", (p) => p.providerRef === providerRef);
  if (!intent) return { ok: false, reason: "unknown_reference" };

  // Duplicate callback for a settled payment: idempotent no-op, never double.
  if (intent.status === "confirmed") {
    return {
      ok: true,
      duplicate: true,
      intent,
      transactionId: intent.transactionId,
    };
  }
  if (TERMINAL.has(intent.status)) {
    return { ok: false, reason: `payment already ${intent.status}`, intent };
  }

  if (!succeeded) {
    const status = cancelled ? "cancelled" : "failed";
    const updated = store.update("workPaymentIntents", intent.id, {
      status,
      failureReason: failureReason ?? (cancelled ? "payment cancelled by customer" : "provider reported failure"),
      failedAt: new Date().toISOString(),
    });
    return { ok: true, failed: true, cancelled, intent: updated };
  }

  // Replay protection: a receipt backs exactly one payment, ever.
  if (receipt) {
    const seen = store.find(
      "workPaymentIntents",
      (p) => p.receipt === receipt && p.id !== intent.id,
    );
    if (seen) return { ok: false, reason: "replayed_receipt", intent };
  }

  // Amount check: the provider's reported amount (whole units) must match what
  // Brief asked to collect. Integer comparison, no float.
  const reported = Number(amount);
  if (!Number.isFinite(reported) || Math.round(reported) !== intent.amount) {
    const updated = store.update("workPaymentIntents", intent.id, {
      status: "failed",
      failureReason: `amount mismatch: expected ${intent.amount}, provider reported ${reported}`,
      failedAt: new Date().toISOString(),
    });
    return { ok: false, reason: "amount_mismatch", intent: updated };
  }

  // ONE ledger transaction — the authoritative money event. The intent is only
  // the story of how it came to exist. Append-oriented, never rewritten.
  const tx = ledger.createTransaction({
    amount: intent.amount,
    currency: intent.currency,
    type: "work_order_payment",
    description: `Work order ${intent.workOrderId}`,
    counterparty: intent.payerId,
    metadata: {
      workOrderId: intent.workOrderId,
      requestId: intent.requestId,
      paymentIntentId: intent.id,
      payeeId: intent.payeeId,
      payeeParticipantId: intent.payeeParticipantId,
      amountMinor: intent.amountMinor,
      provider: intent.provider,
      providerRef: intent.providerRef,
      receipt: receipt ?? null,
    },
  });
  ledger.transitionTransaction(tx.id, "pending", "sent to payment provider");
  ledger.transitionTransaction(tx.id, "confirmed", `provider confirmed${receipt ? ` (${receipt})` : ""}`);
  ledger.transitionTransaction(tx.id, "settled", "funds received");

  const now = new Date().toISOString();
  store.update("workPaymentIntents", intent.id, {
    status: "confirmed",
    receipt: receipt ?? null,
    transactionId: tx.id,
    confirmedAt: now,
  });

  // Settlement state (§15) — the smallest layer necessary: a stable record
  // linking the payment to its ledger transaction and payee.
  store.insert("workSettlements", {
    id: newId("wset"),
    paymentIntentId: intent.id,
    workOrderId: intent.workOrderId,
    requestId: intent.requestId,
    payerId: intent.payerId,
    payeeId: intent.payeeId,
    payeeParticipantId: intent.payeeParticipantId,
    amountMinor: intent.amountMinor,
    amount: intent.amount,
    currency: intent.currency,
    transactionId: tx.id,
    providerRef: intent.providerRef,
    status: "settled",
    settledAt: now,
  });

  recordAudit("work_payment.confirmed", {
    actorId: intent.payerId,
    objectType: "work_payment_intent",
    objectId: intent.id,
    after: { transactionId: tx.id, amount: intent.amount, currency: intent.currency },
  });

  return { ok: true, intent: getIntent(intent.id), transactionId: tx.id, transaction: tx };
}

// ---------------------------------------------------------------------------
// RELEASE — asking for the payee's money, and who is allowed to say yes.
//
// WHAT THIS DOES NOT DO: move money. It moves a STATE (`workSettlements`) and
// asks the right party. The ledger keeps its authority over the money row, and
// the payout rail keeps its own. That separation is why an automation may be
// given this capability at all: the worst a misconfigured rule can do here is
// create a request somebody has to answer.
//
// Every release decision — automatic or human — opens a review item, so the
// automation frontier is a QUERY ("what did the machine decide on its own this
// month?") rather than a claim in a document.
// ---------------------------------------------------------------------------

export function requestRelease(workOrderId, { actorId = null, actorKind = null, reason = null } = {}) {
  const wo = store.find("workOrders", (w) => w.id === workOrderId);
  if (!wo) return { ok: false, reason: "work_order_not_found" };

  // Work that has not been delivered cannot be paid. Deliberately a RESULT and
  // not a throw: "not yet" is a legitimate answer to a rule that ran early.
  if (!["delivered", "completed", "ready"].includes(wo.status)) {
    return { ok: false, reason: `not_deliverable (${wo.status})` };
  }

  const set = store.find("workSettlements", (s) => s.workOrderId === workOrderId);
  if (!set) return { ok: false, reason: "no_settlement_record" };
  if (["release_approved", "released"].includes(set.status)) {
    return { ok: true, detail: { alreadyReleased: true, status: set.status, settlementId: set.id } };
  }

  const now = new Date().toISOString();
  store.update("workSettlements", set.id, {
    status: "release_requested",
    releaseRequestedAt: now,
    releaseRequestedBy: actorId,
    releaseReason: reason,
  });

  emitSignal({
    type: "work_settlement_requested",
    actorId,
    actorKind: actorKind ?? (actorId ? "user" : "rule"),
    entityKind: "work_settlement",
    entityId: set.id,
    value: set.amount,
    source: "internal",
    correlationId: workOrderId,
    metadata: { settlementId: set.id, workOrderId, amount: set.amount, currency: set.currency, reason },
  });

  const threshold = PAYOUT_AUTO_MAX;
  const automatic = Number(set.amount) <= threshold;

  const item = review.open({
    // One queue for payout decisions, so an operator sees the auto ones going
    // through rather than only the ones that needed them.
    kind: "payout_large",
    subject: { kind: "work_order", id: workOrderId },
    reason: automatic
      ? `Payout of ${set.currency} ${set.amount} is at or below the automatic release threshold (${threshold})`
      : `Payout of ${set.currency} ${set.amount} is above the automatic release threshold (${threshold})`,
    openedBy: actorId,
    openedByKind: actorKind ?? (actorId ? "user" : "rule"),
    data: { settlementId: set.id, amount: set.amount, currency: set.currency, threshold, workOrderId },
  });

  if (automatic) {
    // The rule decides, and SAYS it decided: `auto_approved` is a different
    // fact from `approved`, and the difference is the whole point of the
    // frontier.
    review.decide(item.id, { decision: "auto_approved", byKind: "rule", note: `at or below ${threshold}` });
    store.update("workSettlements", set.id, {
      status: "release_approved",
      releaseApprovedAt: new Date().toISOString(),
      releaseApprovedByKind: "rule",
    });
    return { ok: true, detail: { status: "release_approved", automatic: true, reviewId: item.id, amount: set.amount, threshold } };
  }

  return { ok: true, detail: { status: "release_requested", automatic: false, reviewId: item.id, amount: set.amount, threshold } };
}

export function releaseQueue({ limit = 100 } = {}) {
  return store
    .filter("workSettlements", (s) => ["release_requested", "release_approved"].includes(s.status))
    .slice()
    .sort((a, b) => String(b.releaseRequestedAt ?? "").localeCompare(String(a.releaseRequestedAt ?? "")))
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// READS — payer/payee scoped, privacy-safe.
// ---------------------------------------------------------------------------

function canView(userId, intent) {
  return intent.payerId === userId || intent.payeeId === userId;
}

export function listPaymentsForWorkOrder(userId, workOrderId) {
  return store
    .filter("workPaymentIntents", (p) => p.workOrderId === workOrderId)
    .filter((p) => canView(userId, p));
}

export function listPaymentsForUser(userId) {
  return store
    .filter("workPaymentIntents", (p) => canView(userId, p))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function settlementForWorkOrder(userId, workOrderId) {
  return store
    .filter("workSettlements", (s) => s.workOrderId === workOrderId)
    .filter((s) => canView(userId, s));
}

// ---------------------------------------------------------------------------
// DERIVED PAYMENT STATE + SOURCING BREAKDOWN.
// ---------------------------------------------------------------------------

export function paymentState(workOrderId) {
  const intents = store.filter("workPaymentIntents", (p) => p.workOrderId === workOrderId);
  const live = intents.find((p) => !TERMINAL.has(p.status));
  const last = intents.at(-1) ?? null;
  let status = "not_started";
  if (last) {
    if (last.status === "confirmed") status = "confirmed";
    else if (last.status === "authorized") status = "processing";
    else if (last.status === "failed") status = "failed";
    else if (last.status === "cancelled") status = "cancelled";
    else if (last.status === "expired") status = "expired";
    else status = "pending";
  }
  return {
    status,
    // "Payment unavailable" is distinct from "failed": no provider is wired.
    unavailable: !activeProvider(),
    intents,
    liveIntentId: live?.id ?? null,
  };
}

/** The agreed commercial breakdown for a sourcing-aware payment view (§17). */
export function agreementBreakdown(workOrderId) {
  const w = store.lookup("workOrders", workOrderId);
  if (!w) return null;
  const terms = agreementOf(w).terms;
  return {
    sourceCostMinor: terms.subtotalMinor ?? null,
    sourcingFeeMinor: terms.sourcingFeeMinor ?? 0,
    logisticsCostMinor: terms.deliveryCostMinor ?? 0,
    totalMinor: terms.totalMinor ?? null,
    currency: terms.currency ?? "KES",
    sourcingMode: terms.sourceType ?? null,
  };
}

// ---------------------------------------------------------------------------
// RECONCILIATION (§12) — enough integrity checking to avoid drift.
// ---------------------------------------------------------------------------

export function reconcileWorkPayments() {
  const intents = store.all("workPaymentIntents");
  const discrepancies = [];

  for (const p of intents) {
    if (p.status === "confirmed") {
      if (!p.transactionId) {
        discrepancies.push({ kind: "confirmed_without_transaction", intentId: p.id });
        continue;
      }
      const tx = store.find("ledgerTransactions", (t) => t.id === p.transactionId);
      if (!tx) {
        discrepancies.push({ kind: "missing_transaction", intentId: p.id, transactionId: p.transactionId });
      } else if (tx.status !== "settled") {
        discrepancies.push({ kind: "transaction_not_settled", intentId: p.id, status: tx.status });
      } else if (Math.round(tx.amount) !== Math.round(p.amount)) {
        discrepancies.push({ kind: "amount_drift", intentId: p.id, intent: p.amount, ledger: tx.amount });
      }
      if (!p.providerRef) {
        discrepancies.push({ kind: "confirmed_without_provider_reference", intentId: p.id });
      }
    }
    if (p.status === "authorized") {
      const ageMs = Date.now() - Date.parse(p.createdAt);
      if (ageMs > 15 * 60 * 1000) {
        discrepancies.push({ kind: "authorization_stalled", intentId: p.id, ageMinutes: Math.round(ageMs / 60000) });
      }
    }
  }

  const receipts = intents.filter((p) => p.receipt).map((p) => p.receipt);
  const dupes = receipts.filter((r, i) => receipts.indexOf(r) !== i);
  for (const r of new Set(dupes)) {
    discrepancies.push({ kind: "duplicate_receipt", receipt: r });
  }

  return {
    intentCount: intents.length,
    confirmed: intents.filter((p) => p.status === "confirmed").length,
    failed: intents.filter((p) => p.status === "failed").length,
    balanced: discrepancies.length === 0,
    discrepancies,
  };
}
