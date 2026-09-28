// ---------------------------------------------------------------------------
// SCHEDULES — durable "do X at T" (EVENT-ENGINE.md §7)
//
// WHY ROWS AND NOT TIMERS
//
// A `setTimeout` is not durable: it dies with the process, it cannot be
// inspected, and it cannot be replayed. So "remind the requester in 24 hours"
// is stored as a row with a due time and a key, and the tick fires whatever is
// due. Two consequences worth stating:
//
//   * A restart does not lose a reminder; it fires late (and the row says how
//     late, so "why did this arrive at 03:00" has an answer).
//   * The KEY is what makes a missed tick safe. A schedule is created once per
//     subject+intent, so a double tick, a restart mid-fire, or a replay firing
//     the same slot twice all hit the same row.
// ---------------------------------------------------------------------------

import { store, newId } from '../../store.js';
import { emitSignal } from '../signal.js';

export const SCHEDULE_STATUS = ['pending', 'fired', 'cancelled', 'failed'];

/**
 * Create a schedule. `key` is mandatory — "something should happen later" with
 * no identity is how the same reminder gets sent four times.
 */
export function schedule({
  key,
  action,
  params = {},
  dueAt,
  workflowId = null,
  subject = null,
  eventId = null,
  note = null
} = {}) {
  if (!key) throw new Error('a schedule needs a key');
  if (!action) throw new Error('a schedule needs an action');
  if (!dueAt || !Number.isFinite(Date.parse(dueAt))) throw new Error('a schedule needs a due time');

  const existing = store.find('schedules', (s) => s.key === key && s.status === 'pending');
  if (existing) return existing;

  const now = new Date().toISOString();
  const row = store.insert('schedules', {
    id: newId('sch'),
    key,
    action,
    params,
    workflowId,
    subject,
    dueAt,
    createdAt: now,
    status: 'pending',
    firedAt: null,
    lateByMs: null,
    result: null,
    eventId,
    note
  });

  try {
    emitSignal({
      type: 'schedule_created',
      actorKind: 'rule',
      entityKind: 'schedule',
      entityId: row.id,
      source: 'scheduler',
      causationId: eventId,
      metadata: { scheduleId: row.id, action, dueAt, key, subjectKind: subject?.kind ?? null, subjectId: subject?.id ?? null }
    });
  } catch {
    // the row is the record
  }
  return row;
}

export function cancel(key, { note = null } = {}) {
  const rows = store.filter('schedules', (s) => s.key === key && s.status === 'pending');
  for (const row of rows) {
    store.update('schedules', row.id, { status: 'cancelled', cancelledAt: new Date().toISOString(), note });
    try {
      emitSignal({
        type: 'schedule_cancelled',
        actorKind: 'rule',
        entityKind: 'schedule',
        entityId: row.id,
        source: 'scheduler',
        metadata: { scheduleId: row.id, action: row.action, key, note }
      });
    } catch {
      // see above
    }
  }
  return rows.length;
}

/** What is due right now, oldest first. */
export function due({ now = Date.now(), limit = 50 } = {}) {
  return store
    .filter('schedules', (s) => s.status === 'pending' && Date.parse(s.dueAt) <= now)
    .slice()
    .sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt)))
    .slice(0, limit);
}

/**
 * Mark a schedule as fired. Called by the runner AFTER the action, so a crash
 * during the action leaves the row `pending` and it fires again — at-least-once
 * on purpose, because the action it invokes is itself idempotent by key.
 */
export function markFired(id, { result = null } = {}) {
  const row = store.find('schedules', (s) => s.id === id);
  if (!row) return null;
  const now = Date.now();
  const lateByMs = Math.max(0, now - Date.parse(row.dueAt));
  store.update('schedules', id, {
    status: 'fired',
    firedAt: new Date(now).toISOString(),
    lateByMs,
    result
  });
  try {
    emitSignal({
      type: 'schedule_fired',
      actorKind: 'rule',
      entityKind: 'schedule',
      entityId: id,
      source: 'scheduler',
      metadata: { scheduleId: id, action: row.action, key: row.key, lateByMs, result }
    });
  } catch {
    // see above
  }
  return store.find('schedules', (s) => s.id === id);
}

export function markFailed(id, { error }) {
  const row = store.find('schedules', (s) => s.id === id);
  if (!row) return null;
  // `failed` is terminal for the row, but the failure itself is what the
  // dead-letter record exists for — the runner opens one and links back here.
  store.update('schedules', id, {
    status: 'failed',
    lastError: String(error),
    failedAt: new Date().toISOString()
  });
  return store.find('schedules', (s) => s.id === id);
}

export function list({ status = null, limit = 100 } = {}) {
  let rows = store.all('schedules');
  if (status) rows = rows.filter((s) => s.status === status);
  return rows.slice().sort((a, b) => String(a.dueAt).localeCompare(String(b.dueAt))).slice(0, limit);
}

export function stats() {
  const rows = store.all('schedules');
  const byStatus = {};
  for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  const now = Date.now();
  return { total: rows.length, byStatus, due: rows.filter((s) => s.status === 'pending' && Date.parse(s.dueAt) <= now).length };
}
