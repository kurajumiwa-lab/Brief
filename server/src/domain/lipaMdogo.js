// ---------------------------------------------------------------------------
// LIPA MDOGO — asset-financing RECORDS + COLLECTION, not lending.
//
// Brief is not a lender. This module is the distribution-and-records layer for
// a LICENSED lender — a bank / SACCO / cooperative already in the partner
// registry (domain/partner.js). The lender owns the credit decision and the
// risk; Brief records the contract, collects installments through the same
// M-Pesa STK rail as every other payment, and CARRIES THE MEMORY: the
// repayment schedule and the customer's derived maturity.
//
// HONESTY (unchanged rules, restated for this domain):
//   * a contract is a RECORD. Creating one moves no money. The down payment
//     and installments become real only through a provider-confirmed STK
//     collection — never through a client claim.
//   * the lender MUST be a bank/sacco/cooperative partner. A contract cannot
//     name an arbitrary lender, and Brief never becomes the counterparty.
//   * NO interest arithmetic here. The lender sets terms; Brief records a flat
//     schedule (financed = total - down payment, split over the term). This
//     keeps Brief out of credit pricing entirely.
//   * the national ID is NEVER stored. Only its SHA-256 hash, plus the
//     lender's physical-hub verification stamp. A stolen database row cannot
//     be used to impersonate the customer (see huduma/crypto.js for the same
//     Data-Protection-Act posture).
//   * every payment carries a SHA-256 receipt hash of the real facts
//     (contract, installment, amount, provider reference, time) so the
//     offline/online trail is auditable and tamper-evident.
//   * maturity is DERIVED: a customer who pays on time shows it; one who is
//     late shows "overdue". Nothing is stored as a score.
// ---------------------------------------------------------------------------

import crypto from 'node:crypto';
import { store, newId } from '../store.js';
import { getUser } from './auth.js';
import { getPartnerByKey } from './partner.js';
import { activeCollectionProvider, collectionProvider } from '../providers.js';
import { normalisePhone } from '../connectors/phone.js';
import * as ledger from './ledger.js';
import { recordAudit } from '../routes/helpers.js';
import * as intake from './engine/intake.js';

export const CONTRACT_STATUS = ['active', 'matured', 'cancelled'];
export const LENDER_TYPES = new Set(['bank', 'sacco', 'cooperative']);

// Installment status is DERIVED, never stored. A due date in the past with no
// matching payment is "overdue"; a matched payment is "paid"; otherwise
// "pending".
export const INSTALLMENT_STATES = ['pending', 'paid', 'overdue'];

function fail(message, status = 400, code = 'validation_error') {
  const e = new Error(message);
  e.status = status;
  e.code = code;
  throw e;
}

function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

/** The flat repayment schedule: financed amount split over termMonths, with
 *  any integer remainder folded into the final installment. Deterministic. */
function scheduleOf(financed, termMonths) {
  if (financed <= 0 || termMonths < 1) return [];
  const base = Math.floor(financed / termMonths);
  const remainder = financed - base * termMonths;
  return Array.from({ length: termMonths }, (_, i) => base + (i === termMonths - 1 ? remainder : 0));
}

/**
 * Record an asset-financing contract. The lender must be a licensed-type
 * partner; the financed amount is total minus down payment; the schedule is
 * derived. The national ID is stored only as a hash.
 */
export function createContract({
  lenderId,
  vendorId,
  customerId,
  asset,
  totalValue,
  downPayment = 0,
  termMonths,
  nationalIdHash = null,
  hubVerificationStamp = null,
  onboardingRiderId = null
}) {
  if (!lenderId || !customerId) fail('lender and customer are required');
  const lender = getPartnerByKey(lenderId) ?? store.find('partners', (p) => p.id === lenderId);
  if (!lender) fail('lender not found', 404, 'not_found');
  if (!LENDER_TYPES.has(lender.partnerType)) {
    fail(`the lender must be a bank, sacco or cooperative (got ${lender.partnerType})`, 409, 'lender_not_licensed');
  }
  if (vendorId && !store.find('vendors', (v) => v.id === vendorId)) fail('vendor not found', 404, 'not_found');
  if (!getUser(customerId)) fail('customer not found', 404, 'not_found');

  const total = Number(totalValue);
  const down = Number(downPayment);
  if (!Number.isFinite(total) || total <= 0) fail('totalValue must be a positive number');
  if (!Number.isFinite(down) || down < 0 || down > total) fail('downPayment must be between 0 and totalValue');
  if (!Number.isInteger(termMonths) || termMonths < 1 || termMonths > 48) fail('termMonths must be a whole number between 1 and 48');

  const financed = total - down;
  const schedule = scheduleOf(financed, termMonths);

  const now = new Date().toISOString();
  const contract = store.insert('lipaMdogoContracts', {
    id: newId('lmd'),
    lenderId: lender.id,
    lenderKey: lender.key,
    lenderName: lender.name,
    vendorId: vendorId ?? null,
    customerId,
    onboardingRiderId: onboardingRiderId ?? null,
    asset: {
      deviceId: String(asset?.deviceId ?? newId('dev')).slice(0, 96),
      name: String(asset?.name ?? '').slice(0, 120) || null,
      totalValue: total,
      downPayment: down,
      financed,
      termMonths
    },
    verification: {
      nationalIdHash: nationalIdHash ? sha256(nationalIdHash) : null,
      hubVerificationStamp: hubVerificationStamp ? String(hubVerificationStamp).slice(0, 200) : null
    },
    schedule: schedule.map((amountDue, i) => ({
      index: i,
      dueDate: new Date(Date.now() + (i + 1) * 30 * 86400000).toISOString().slice(0, 10),
      amountDue
    })),
    status: 'active',
    createdAt: now,
    updatedAt: now
  });
  recordAudit('lipa_mdogo_contract_created', { objectType: 'lipaMdogoContract', objectId: contract.id, actorId: customerId });
  return contract;
}

/**
 * Request collection of one installment via the STK rail. Mirrors
 * workPayment.requestPayment: the amount comes from the schedule (never the
 * client), the provider moves whole units, and "accepted" means the prompt was
 * dispatched — NOT that money arrived.
 */
export async function requestCollection(contractId, installmentIndex, { phone = null, idempotencyKey = null, fetchImpl = fetch } = {}) {
  const contract = store.find('lipaMdogoContracts', (c) => c.id === contractId);
  if (!contract) fail('contract not found', 404, 'not_found');
  if (contract.status !== 'active') fail('this contract is no longer active', 409, 'invalid_state');
  const idx = Number(installmentIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx >= contract.schedule.length) fail('installment index out of range');
  const amountDue = contract.schedule[idx].amountDue;
  if (amountDue <= 0) fail('nothing to collect for this installment', 409, 'no_amount');

  const providerName = activeCollectionProvider();
  if (!providerName) fail('payment is unavailable — no collection provider is configured', 503, 'provider_unavailable');
  const provider = collectionProvider(providerName);
  if (!provider?.collect) fail('payment is unavailable', 503, 'provider_unavailable');

  if (idempotencyKey) {
    const prior = store.find('lipaMdogoPayments', (p) => p.idempotencyKey === idempotencyKey && p.contractId === contractId);
    if (prior) {
      // A collection request retried by a phone on a bad connection. The
      // payment row is the authority; the key is recorded at the edge so the
      // whole set is auditable in one place.
      intake.note({ key: `lipa-mdogo:${contractId}:${idempotencyKey}`, source: 'lipaMdogo', handler: 'request_collection', outcome: { paymentId: prior.id } });
      return { ok: true, duplicate: true, payment: prior };
    }
  }

  const intentId = newId('lmdp');
  const res = await provider.collect({
    amount: amountDue,
    phone: normalisePhone(phone),
    description: `Lipa Mdogo installment ${idx + 1}/${contract.schedule.length} — ${contract.asset.name ?? 'asset'}`,
    fetchImpl
  });

  // The STK push was not dispatched (invalid phone, provider down, no amount).
  // Honest failure — no money moved, no dangling intent.
  if (!res.ok) {
    return { ok: false, charged: false, reason: res.reason, detail: res };
  }

  const payment = store.insert('lipaMdogoPayments', {
    id: intentId,
    contractId,
    installmentIndex: idx,
    amountDue,
    amount: amountDue,
    phone: phone ? normalisePhone(phone) : null,
    idempotencyKey: idempotencyKey ?? null,
    providerRef: res?.checkoutRequestId ?? null,
    status: 'intent',
    receiptHash: null,
    receipt: null,
    collectedAt: null,
    createdAt: new Date().toISOString()
  });

  return { ok: true, charged: Boolean(res?.ok), payment, provider: providerName, checkoutRequestId: res?.checkoutRequestId ?? null };
}

/**
 * Confirm an installment payment from the verified provider callback. The ONLY
 * place a payment becomes real. Idempotent; a replayed receipt is refused.
 */
export function confirmPayment({ providerRef, succeeded, amount, receipt, failureReason, cancelled }) {
  const payment = store.find('lipaMdogoPayments', (p) => p.providerRef === providerRef);
  if (!payment) return { ok: false, reason: 'unknown_reference' };
  if (payment.status === 'confirmed') return { ok: true, duplicate: true, payment };

  if (!succeeded || cancelled) {
    store.update('lipaMdogoPayments', payment.id, { status: 'failed', failureReason: failureReason ?? null, updatedAt: new Date().toISOString() });
    return { ok: true, duplicate: false, payment: store.find('lipaMdogoPayments', (p) => p.id === payment.id) };
  }

  // The callback amount must match the schedule amount exactly — a token
  // payment cannot mark an installment paid.
  if (Number(amount) !== Number(payment.amountDue)) {
    store.update('lipaMdogoPayments', payment.id, { status: 'failed', failureReason: `amount mismatch (expected ${payment.amountDue})`, updatedAt: new Date().toISOString() });
    return { ok: false, reason: 'amount_mismatch', payment: store.find('lipaMdogoPayments', (p) => p.id === payment.id) };
  }

  // Signed receipt: a SHA-256 of the real facts, so the trail is tamper-evident.
  const at = new Date().toISOString();
  const receiptHash = sha256(`${payment.contractId}:${payment.installmentIndex}:${amount}:${providerRef}:${at}`);
  const updated = store.update('lipaMdogoPayments', payment.id, {
    status: 'confirmed',
    receipt: receipt ?? null,
    receiptHash,
    collectedAt: at,
    updatedAt: at
  });

  // The ledger records the collection; it does not settle the contract (the
  // lender owns the loan, Brief records the money movement).
  const tx = ledger.createTransaction({
    amount: Number(amount),
    currency: 'KES',
    type: 'lipa_mdogo_installment',
    description: `Lipa Mdogo installment ${payment.installmentIndex + 1} — ${store.find('lipaMdogoContracts', (c) => c.id === payment.contractId)?.asset?.name ?? 'asset'}`,
    counterparty: store.find('lipaMdogoContracts', (c) => c.id === payment.contractId)?.customerId ?? null,
    metadata: { contractId: payment.contractId, installmentIndex: payment.installmentIndex, providerRef, receiptHash }
  });
  ledger.transitionTransaction(tx.id, 'pending');
  ledger.transitionTransaction(tx.id, 'confirmed');
  ledger.transitionTransaction(tx.id, 'settled');

  return { ok: true, duplicate: false, payment: updated, transactionId: tx.id };
}

/** The derived state of one contract: per-installment status + maturity. */
export function contractState(contractId) {
  const contract = store.find('lipaMdogoContracts', (c) => c.id === contractId);
  if (!contract) fail('contract not found', 404, 'not_found');
  const payments = store.filter('lipaMdogoPayments', (p) => p.contractId === contractId && p.status === 'confirmed');

  const now = new Date();
  const schedule = contract.schedule.map((inst) => {
    const paid = payments.filter((p) => p.installmentIndex === inst.index)
      .reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const dueDate = new Date(inst.dueDate);
    let state = 'pending';
    if (paid >= inst.amountDue) state = 'paid';
    else if (now > dueDate) state = 'overdue';
    return { ...inst, paid, state };
  });

  const totalFinanced = contract.asset.financed;
  const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paidCount = schedule.filter((i) => i.state === 'paid').length;
  const overdueCount = schedule.filter((i) => i.state === 'overdue').length;
  const matured = paidCount === schedule.length && schedule.length > 0;

  return {
    id: contract.id,
    status: contract.status,
    asset: contract.asset,
    lender: { id: contract.lenderId, key: contract.lenderKey, name: contract.lenderName },
    vendorId: contract.vendorId,
    customerId: contract.customerId,
    onboardingRiderId: contract.onboardingRiderId,
    schedule,
    summary: {
      totalFinanced,
      totalPaid,
      remaining: Math.max(0, totalFinanced - totalPaid),
      paidCount,
      overdueCount,
      matured
    },
    // The honest maturity statement: derived from real on-time payments.
    maturity: matured
      ? 'matured'
      : overdueCount > 0 ? 'overdue' : paidCount > 0 ? 'paying' : 'started',
    note: 'Maturity is derived from real, provider-confirmed payments. Nothing here is a credit score or a stored rating.'
  };
}

/** Everything a member is party to (as customer, vendor, or lender). */
export function listFor(userId) {
  return store.filter('lipaMdogoContracts', (c) =>
    c.customerId === userId || c.vendorId === userId || c.lenderId === userId
  ).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function listAll() {
  return store.all('lipaMdogoContracts').slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getContract(id) {
  return store.find('lipaMdogoContracts', (c) => c.id === id) ?? null;
}
