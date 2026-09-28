// ---------------------------------------------------------------------------
// INTAKE — idempotency at the edge (EVENT-ENGINE.md §4.4)
//
// THE PROBLEM THIS EXISTS FOR
//
// A webhook is not delivered once. Stripe retries for days; a phone on a bad
// connection retries a POST because it never saw the response; a cron slot
// fires twice across a restart. Every one of those is the same real-world act
// arriving again, and the system must not do it twice — two payouts, two
// reservations, two notifications.
//
// WHAT "IDEMPOTENT" MEANS HERE, EXACTLY
//
// A duplicate does not merely skip. It returns THE FIRST OUTCOME. That
// distinction is the whole point: a client that retried because it never saw
// the response is owed the response, not a second receipt and not an error
// saying "already done" that it cannot interpret.
//
// THE WRITE-AHEAD RULE
//
// The row is written BEFORE the effect runs, never after. A crash therefore
// leaves `processing` — evidence that something was attempted — instead of
// leaving nothing at all. `recoverStale()` later turns a stuck `processing`
// row into a visible `failed` one, because the alternative (an attempt with no
// trace) is exactly the invisible failure this whole engine exists to prevent.
//
// WHY NOT A UNIQUE INDEX
//
// The store is a single-writer JSON document; there is no second writer to
// race. `find` IS the constraint, and it is honest about that. If this ever
// grows a second process, this same row becomes the lock and no caller here
// changes shape.
// ---------------------------------------------------------------------------

import { store, newId } from '../../store.js';

/** How long a `processing` row may sit before it is treated as a crash. */
const STALE_MS = 2 * 60 * 1000;

const STATUSES = ['processing', 'processed', 'duplicate', 'failed', 'rejected', 'recovered'];

function keyOf(source, key) {
  return `${source}::${key}`;
}

function find(source, key) {
  const k = keyOf(source, key);
  return store.find('intakeEvents', (r) => keyOf(r.source, r.key) === k) ?? null;
}

/**
 * Run `fn` at most once for a given `(source, key)`.
 *
 * Returns `{ duplicate, outcome, row }`. When the key has been seen, `fn` is
 * not called and the recorded outcome is returned instead — a retry gets the
 * answer the first attempt produced.
 *
 * A key is MANDATORY. An optional key is not a boundary; it is a comment in a
 * README, because the caller that forgets it is the caller that needed it.
 */
export function once({ key, source = 'http', actorId = null, handler = null, meta = {} }, fn) {
  if (!key || !String(key).trim()) {
    throw new Error('intake.once requires an idempotency key');
  }
  if (typeof fn !== 'function') {
    throw new Error('intake.once requires a function to run');
  }

  const seen = find(source, key);
  if (seen) {
    // A row still marked `processing` is either an in-flight call (impossible
    // in a single-writer process: the call that owned it has already returned
    // or thrown) or the residue of a crash. Either way it is not an outcome,
    // so it is NOT returned as one — the work is retried and the row is
    // corrected. Returning "processing" as an answer would tell a client the
    // work exists when nothing had run.
    if (seen.status === 'processing') {
      return run(seen, fn);
    }
    return { duplicate: true, outcome: seen.outcome ?? null, status: seen.status, row: seen };
  }

  const row = store.insert('intakeEvents', {
    id: newId('intk'),
    key: String(key),
    source,
    handler,
    actorId,
    meta,
    receivedAt: new Date().toISOString(),
    status: 'processing',
    attempts: 0,
    lastError: null,
    outcome: null
  });
  return run(row, fn);
}

function run(row, fn) {
  store.update('intakeEvents', row.id, {
    status: 'processing',
    attempts: (row.attempts ?? 0) + 1,
    startedAt: new Date().toISOString()
  });
  try {
    const outcome = fn();
    store.update('intakeEvents', row.id, {
      status: 'processed',
      outcome: outcome === undefined ? null : outcome,
      processedAt: new Date().toISOString(),
      lastError: null
    });
    return { duplicate: false, outcome: outcome === undefined ? null : outcome, status: 'processed', row };
  } catch (error) {
    // THE FAILURE IS RECORDED, and the error still propagates: a caller that
    // asked for something must not be told it succeeded because the failure
    // was written down.
    store.update('intakeEvents', row.id, {
      status: 'failed',
      lastError: String(error?.message ?? error),
      failedAt: new Date().toISOString()
    });
    throw error;
  }
}

/**
 * A rejection is a *decision*, not a fault: the request was understood and
 * refused (bad payload, unknown subject). Recording it means a retrying sender
 * gets the same refusal instead of a different error each time.
 */
export function reject({ key, source = 'http', reason, actorId = null, meta = {} }) {
  const existing = find(source, key);
  if (existing) return { duplicate: true, outcome: existing.outcome ?? null, status: existing.status, row: existing };
  const row = store.insert('intakeEvents', {
    id: newId('intk'),
    key: String(key),
    source,
    actorId,
    meta,
    receivedAt: new Date().toISOString(),
    processedAt: new Date().toISOString(),
    status: 'rejected',
    attempts: 0,
    lastError: null,
    outcome: { rejected: true, reason: String(reason ?? 'refused') }
  });
  return { duplicate: false, outcome: row.outcome, status: 'rejected', row };
}

/** Mark a key as seen without running anything (an ack that had no effect). */
export function note({ key, source = 'http', outcome = null, actorId = null, meta = {} }) {
  const existing = find(source, key);
  if (existing) return { duplicate: true, outcome: existing.outcome ?? null, status: existing.status, row: existing };
  const row = store.insert('intakeEvents', {
    id: newId('intk'),
    key: String(key),
    source,
    actorId,
    meta,
    receivedAt: new Date().toISOString(),
    processedAt: new Date().toISOString(),
    status: 'processed',
    attempts: 0,
    lastError: null,
    outcome
  });
  return { duplicate: false, outcome, status: 'processed', row };
}

/**
 * Boot recovery. A `processing` row older than STALE_MS is the residue of a
 * crash — nobody is coming back for it. It is marked `recovered` (a distinct
 * status, so "we gave up on this" is never confused with "this failed") and
 * counted.
 */
export function recoverStale({ now = Date.now(), staleMs = STALE_MS } = {}) {
  const recovered = [];
  for (const row of store.all('intakeEvents')) {
    if (row.status !== 'processing') continue;
    const started = Date.parse(row.startedAt ?? row.receivedAt ?? 0) || 0;
    if (now - started < staleMs) continue;
    store.update('intakeEvents', row.id, {
      status: 'recovered',
      lastError: 'interrupted before it recorded an outcome (crash or restart)',
      recoveredAt: new Date().toISOString()
    });
    recovered.push(row.id);
  }
  return { recovered: recovered.length, ids: recovered };
}

export function get({ key, source = 'http' }) {
  return find(source, key);
}

export function list({ source = null, status = null, limit = 100 } = {}) {
  let rows = store.all('intakeEvents');
  if (source) rows = rows.filter((r) => r.source === source);
  if (status) rows = rows.filter((r) => r.status === status);
  return rows.slice().sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt))).slice(0, limit);
}

export function stats() {
  const byStatus = {};
  for (const r of store.all('intakeEvents')) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
  return { total: store.all('intakeEvents').length, byStatus };
}

export const INTAKE_STATUSES = STATUSES;
