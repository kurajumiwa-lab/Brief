// ---------------------------------------------------------------------------
// ANNOUNCE — one line for a domain to say what it just did
//
// Every domain that changes a state has to emit an event, and five copies of
// the same try/catch would drift. This is that block, once.
//
// IT NEVER THROWS, and that is deliberate. A domain write that already happened
// must not be rolled back because the log refused it: the row is the source of
// truth, the event is how it becomes legible. The alternative — a failed log
// write failing a payment — trades a legibility problem for a correctness one.
// ---------------------------------------------------------------------------

import { emitSignal } from '../signal.js';

export function announce(type, {
  actorId = null,
  actorKind = null,
  entityKind = null,
  entityId = null,
  objectId = null,
  circleId = null,
  value = null,
  metadata = {},
  correlationId = null,
  causationId = null,
  source = 'internal',
  idempotencyKey = null,
  occurredAt = null
} = {}) {
  try {
    return emitSignal({
      type,
      actorId,
      actorKind: actorKind ?? (actorId ? 'user' : 'system'),
      entityKind,
      entityId,
      objectId,
      circleId,
      value,
      metadata,
      correlationId,
      causationId,
      source,
      idempotencyKey,
      occurredAt
    });
  } catch {
    return null;
  }
}
