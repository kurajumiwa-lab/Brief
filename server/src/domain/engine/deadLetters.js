// ---------------------------------------------------------------------------
// DEAD LETTERS — zero invisible failures (EVENT-ENGINE.md §7)
//
// WHY THIS EXISTS
//
// Today a failed automated action is recorded in one of two places and then
// forgotten: `queue.js` writes a line into `errors`, and `workflow.js` writes
// `ok: false` into a run row. Neither has an attempt count, a backoff, a
// terminal state, or a queue a person can work. A job that failed once is
// indistinguishable from one that failed forty times, and — worse — a *thrown*
// action escapes the sweep entirely.
//
// THE RULE
//
// The goal is not zero failures. The goal is zero INVISIBLE failures. Every
// terminal failure becomes a row here, carrying the payload, the attempts, and
// the last error in the failing system's own words ("transaction not found" is
// actionable; "action failed" is not). Resolving one is an act with an author,
// and it emits an event, so the resolution is in the log too.
// ---------------------------------------------------------------------------

import { store, newId } from '../../store.js';
import { emitSignal } from '../signal.js';

/** The retry ladder, in milliseconds. After the last rung: the dead letter. */
export const RETRY_LADDER_MS = [
  30 * 1000,
  5 * 60 * 1000,
  60 * 60 * 1000
];

export function nextRetryAt(attempt) {
  const delay = RETRY_LADDER_MS[attempt];
  if (delay === undefined) return null; // ladder exhausted
  return new Date(Date.now() + delay).toISOString();
}

export function exhausted(attempt) {
  return RETRY_LADDER_MS[attempt] === undefined;
}

/**
 * Open a dead letter. `key` dedupes: the same unit of work failing repeatedly
 * updates the row it already has rather than growing a new one per attempt —
 * otherwise the queue a person works becomes the pile that buried them.
 */
export function open({
  key,
  action = null,
  workflowId = null,
  runId = null,
  eventId = null,
  payload = {},
  attempts = 0,
  error = 'unknown error',
  cause = null
}) {
  const existing = key ? store.find('deadLetters', (d) => d.key === key && d.status === 'open') : null;
  const now = new Date().toISOString();

  if (existing) {
    store.update('deadLetters', existing.id, {
      attempts,
      lastFailedAt: now,
      lastError: String(error),
      payload: payload ?? existing.payload
    });
    return existing;
  }

  const row = store.insert('deadLetters', {
    id: newId('dead'),
    key: key ?? null,
    workflowId,
    runId,
    eventId,
    // `cause` is the failing system's own words; `error` is the summary. Both
    // are kept because a reader needs to search the summary and act on the cause.
    cause,
    action,
    payload,
    attempts,
    firstFailedAt: now,
    lastFailedAt: now,
    lastError: String(error),
    status: 'open',
    resolvedBy: null,
    resolvedAt: null,
    resolutionNote: null
  });

  try {
    emitSignal({
      type: 'dead_letter_created',
      actorKind: 'rule',
      entityKind: 'dead_letter',
      entityId: row.id,
      source: 'internal',
      causationId: eventId,
      metadata: {
        deadLetterId: row.id,
        workflowId,
        action,
        attempts,
        error: String(error),
        // The event that was being handled when this failed. Without it, an
        // operator knows something broke but not what was happening.
        eventId
      }
    });
  } catch {
    // Never let the log's refusal hide a failure we already recorded.
  }
  return row;
}

/**
 * A person dealt with it. `resolution` says how: `retried` (and it worked),
 * `discarded` (the work is not needed), or `noted` (understood, nothing to do).
 */
export function resolve(id, { by = null, note = null, resolution = 'noted' } = {}) {
  const row = store.find('deadLetters', (d) => d.id === id);
  if (!row) throw new Error('dead letter not found');
  if (row.status !== 'open') return row; // already resolved: not an error, just done

  const now = new Date().toISOString();
  store.update('deadLetters', id, {
    status: resolution === 'discarded' ? 'discarded' : 'resolved',
    resolution,
    resolvedBy: by,
    resolvedAt: now,
    resolutionNote: note
  });

  try {
    emitSignal({
      type: 'dead_letter_resolved',
      actorId: by,
      actorKind: by ? 'operator' : 'system',
      entityKind: 'dead_letter',
      entityId: id,
      source: 'internal',
      metadata: { deadLetterId: id, resolution, note, workflowId: row.workflowId, action: row.action }
    });
  } catch {
    // see above
  }
  return store.find('deadLetters', (d) => d.id === id);
}

export function get(id) {
  return store.find('deadLetters', (d) => d.id === id) ?? null;
}

export function list({ status = 'open', limit = 100 } = {}) {
  let rows = store.all('deadLetters');
  if (status) rows = rows.filter((d) => d.status === status);
  return rows
    .slice()
    .sort((a, b) => String(b.lastFailedAt).localeCompare(String(a.lastFailedAt)))
    .slice(0, limit);
}

/** The number on the ops wall. A queue nobody can count is a queue nobody works. */
export function stats() {
  const rows = store.all('deadLetters');
  return {
    open: rows.filter((d) => d.status === 'open').length,
    resolved: rows.filter((d) => d.status === 'resolved').length,
    discarded: rows.filter((d) => d.status === 'discarded').length,
    total: rows.length
  };
}
