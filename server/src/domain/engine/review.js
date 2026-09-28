// ---------------------------------------------------------------------------
// REVIEW — human escalation as a first-class STATE (EVENT-ENGINE.md §5)
//
// WHY THIS EXISTS
//
// The system already escalates in two places: settlement mismatches become
// `settlementEscalations`, and abuse reports become rows a moderator works.
// Both are the right idea and neither is general: a payout, a listing or a
// work order cannot sit IN a review state with an owner, an age and a reason.
// So "automate everything and let the hard cases fall out into a human queue"
// is not expressible, and the automation frontier in §8 stays a table in a
// document.
//
// THE STATES
//
//   pending       — waiting for a person; an age past `deadlineAt` is overdue
//   auto_approved — a rule decided, and said so; nothing is pending
//   auto_rejected — a rule decided, and said so
//   approved      — a person decided
//   rejected      — a person decided
//   withdrawn     — the question stopped mattering (the subject was withdrawn)
//
// The decision is a row either way, because "the rule approved it" and
// "somebody approved it" are different facts and the log must be able to tell
// them apart. That is also what makes the frontier auditable: what the machine
// decided on its own is exactly the set of `auto_*` rows.
// ---------------------------------------------------------------------------

import { store, newId } from '../../store.js';
import { emitSignal } from '../signal.js';

export const DECISIONS = ['pending', 'auto_approved', 'auto_rejected', 'approved', 'rejected', 'withdrawn'];

/** Kinds are a closed set so the ops wall can group without guessing. */
export const KINDS = [
  'payout_large',
  'settlement_mismatch',
  'fraud_suspicion',
  'dispute',
  'account_termination',
  'listing_flagged',
  'work_order_stuck',
  'refund_owed',
  'other'
];

const DEFAULT_DEADLINE_HOURS = { payout_large: 24, dispute: 72, settlement_mismatch: 48, fraud_suspicion: 12 };

/**
 * Open a review item — or return the one already open for this subject.
 *
 * Idempotence matters here more than anywhere: a state-based rule evaluating
 * every 30 seconds must not open a new escalation each tick. One open item per
 * (subject, reason) is the contract; a repeat call is a no-op that returns the
 * existing row.
 */
export function open({
  kind = 'other',
  subject = {},
  reason = null,
  openedBy = null,
  openedByKind = null,
  deadlineAt = null,
  eventId = null,
  data = {}
} = {}) {
  if (!KINDS.includes(kind)) throw new Error(`unknown review kind: ${kind}`);
  if (!subject?.kind || !subject?.id) throw new Error('a review item needs a subject { kind, id }');

  const existing = store.find(
    'reviewItems',
    (r) => r.status === 'pending' && r.kind === kind && r.subject?.kind === subject.kind && r.subject?.id === subject.id
  );
  if (existing) return existing;

  const now = new Date().toISOString();
  const hours = DEFAULT_DEADLINE_HOURS[kind] ?? 48;
  const row = store.insert('reviewItems', {
    id: newId('rev'),
    kind,
    subject: { kind: subject.kind, id: subject.id },
    reason: reason ?? `${kind} needs a person`,
    status: 'pending',
    decision: 'pending',
    data,
    openedBy,
    openedByKind: openedByKind ?? (openedBy ? 'user' : 'rule'),
    openedAt: now,
    deadlineAt: deadlineAt ?? new Date(Date.now() + hours * 3600 * 1000).toISOString(),
    decidedBy: null,
    decidedByKind: null,
    decidedAt: null,
    note: null,
    eventId
  });

  try {
    emitSignal({
      type: 'review_opened',
      actorId: openedBy,
      actorKind: row.openedByKind,
      entityKind: 'review_item',
      entityId: row.id,
      source: 'internal',
      causationId: eventId,
      metadata: {
        reviewId: row.id,
        kind,
        subjectKind: subject.kind,
        subjectId: subject.id,
        reason: row.reason,
        deadlineAt: row.deadlineAt,
        // WHICH of the two kinds of "needs review" this is: a rule that cannot
        // decide (auto) or an exception a person must judge (human). The ops
        // wall orders by this, and the frontier report counts it.
        openedByKind: row.openedByKind
      }
    });
  } catch {
    // The row is the record; the log is how it is legible.
  }
  return row;
}

/**
 * Decide. `by` is a user id for a human decision; an automated one passes
 * `decidedByKind: 'rule'` and gets an `auto_*` status, so the two are never
 * confused in a report about how much runs without a person.
 */
export function decide(id, { decision, by = null, byKind = null, note = null } = {}) {
  const row = store.find('reviewItems', (r) => r.id === id);
  if (!row) throw new Error('review item not found');
  if (row.status !== 'pending') return row; // decided already; not an error

  const kind = byKind ?? (by ? 'user' : 'rule');
  const automated = kind === 'rule';
  const approved = decision === 'approved' || decision === 'auto_approved';
  const rejected = decision === 'rejected' || decision === 'auto_rejected';
  if (!approved && !rejected && decision !== 'withdrawn') {
    throw new Error(`unknown decision: ${decision}`);
  }

  const status = decision === 'withdrawn'
    ? 'withdrawn'
    : automated
      ? (approved ? 'auto_approved' : 'auto_rejected')
      : (approved ? 'approved' : 'rejected');

  const now = new Date().toISOString();
  store.update('reviewItems', id, {
    status,
    decision: status,
    decidedBy: by,
    decidedByKind: kind,
    decidedAt: now,
    note
  });

  try {
    emitSignal({
      type: 'review_decided',
      actorId: by,
      actorKind: kind,
      entityKind: 'review_item',
      entityId: id,
      source: 'internal',
      metadata: { reviewId: id, kind: row.kind, decision: status, note, subjectKind: row.subject?.kind, subjectId: row.subject?.id }
    });
    // Its own event type as well, because "the machine decided on its own" is
    // the number the automation frontier is measured by, and asking for it
    // should not require filtering a free-text field.
    if (automated) {
      emitSignal({
        type: approved ? 'review_auto_approved' : 'review_auto_rejected',
        actorKind: 'rule',
        entityKind: 'review_item',
        entityId: id,
        source: 'internal',
        metadata: { reviewId: id, kind: row.kind, decision: status, note }
      });
    }
  } catch {
    // see above
  }
  return store.find('reviewItems', (r) => r.id === id);
}

/** Withdraw the question: the subject went away, so nothing is pending. */
export function withdrawFor(subjectKind, subjectId, { note = null } = {}) {
  const openRows = store.filter(
    'reviewItems',
    (r) => r.status === 'pending' && r.subject?.kind === subjectKind && r.subject?.id === subjectId
  );
  for (const row of openRows) decide(row.id, { decision: 'withdrawn', byKind: 'rule', note });
  return openRows.length;
}

export function get(id) {
  return store.find('reviewItems', (r) => r.id === id) ?? null;
}

export function list({ status = 'pending', kind = null, limit = 100, overdueOnly = false } = {}) {
  let rows = store.all('reviewItems');
  if (status) rows = rows.filter((r) => r.status === status);
  if (kind) rows = rows.filter((r) => r.kind === kind);
  if (overdueOnly) {
    const now = Date.now();
    rows = rows.filter((r) => r.deadlineAt && Date.parse(r.deadlineAt) < now);
  }
  return rows
    .slice()
    .sort((a, b) => String(a.deadlineAt ?? '').localeCompare(String(b.deadlineAt ?? '')))
    .slice(0, limit);
}

/**
 * The ops wall's numbers, including the one that matters for the frontier:
 * how many of this period's decisions the machine made by itself.
 */
export function stats() {
  const rows = store.all('reviewItems');
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const automated = rows.filter((r) => r.decidedByKind === 'rule').length;
  const human = rows.filter((r) => r.decidedByKind === 'user' || r.decidedByKind === 'operator').length;
  const now = Date.now();
  return {
    total: rows.length,
    pending: rows.filter((r) => r.status === 'pending').length,
    overdue: rows.filter((r) => r.status === 'pending' && r.deadlineAt && Date.parse(r.deadlineAt) < now).length,
    byStatus,
    decidedAutomatically: automated,
    decidedByPeople: human
  };
}
