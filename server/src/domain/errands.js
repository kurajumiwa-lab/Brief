// ---------------------------------------------------------------------------
// ERRANDS — the lobby board.
//
// An errand is a small, concrete task someone needs carried: a parcel across
// town, a document dropped at town hall, a queue stood in, a buy-and-drop. The
// loop is short and every stage is a row:
//
//   POSTED → A CARRIER TOOK IT → PICKED UP AT THE SOURCE → DELIVERED
//          → FEE AGREED BETWEEN YOU → RATED BY BOTH SIDES
//
// Who may carry: a person Brief can actually identify as an agent or partner.
// Not a vibe, not a self-declared badge — one of three real facts:
//   · an active platform role of `field_agent` or `partner`;
//   · an active shop claim in the field-agent ledger (they onboarded vendors,
//     which is the same on-the-ground network);
//   · a rider who has actually been assigned a pickup in this store.
// Anyone may POST. Only the above may ACCEPT, and the refusal names the reason
// and the way to become eligible.
//
// Money: the fee on an errand is the poster's own STATED amount. Brief moves
// nothing — there is no errand payment provider wired — so "settled" is
// recorded as both parties confirming it happened off-platform, and the row
// says exactly that. No balance, no escrow, no promise of a payout.
//
// Ratings: one per person per completed delivery, written by the two parties to
// that delivery, stored as what they said. There is deliberately NO average, no
// per-person score, no tier, no ranking and no endpoint that computes one:
// aggregating stars into a reputation number is how a credit score is born, and
// Brief is not a bank.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
import { platformRolesOf } from '../identity.js';
import { notify } from './notifications.js';

export const ERRAND_STATUS = ['open', 'accepted', 'picked_up', 'delivered', 'cancelled'];

/**
 * What kind of job it is. A small, honest set — six, chosen so that a person can
 * find their errand in one glance and a carrier can read it in the same second.
 *
 * Two rules that come with it:
 *   • `kind` is OPTIONAL. An errand with no kind is not misfiled and not hidden;
 *     it appears under "Any kind" and in no filter. Same doctrine as the
 *     marketplace flows: an untagged listing is counted as untagged rather than
 *     guessed into a category by reading its title.
 *   • there is deliberately NO count on a tile. Six tiles each saying "0" is a
 *     picture of an empty shelf, and a number that only exists to be zero is not
 *     information. If a count is added later it must be a real one, on read.
 */
export const ERRAND_KINDS = [
  { id: 'delivery', label: 'Delivery', blurb: 'A to B, someone carries it' },
  { id: 'pickup', label: 'Pickup', blurb: 'Collect it and bring it back' },
  { id: 'food', label: 'Food', blurb: 'Meals, market runs, hot now' },
  { id: 'skilled', label: 'Repairs & skilled', blurb: 'Needs a hand that knows' },
  { id: 'care', label: 'Care & household', blurb: 'People, pets, the house' },
  { id: 'other', label: 'Something else', blurb: 'Say it in your own words' }
];
export const ERRAND_KIND_IDS = ERRAND_KINDS.map((k) => k.id);
export const kindLabel = (id) => ERRAND_KINDS.find((k) => k.id === id)?.label ?? null;
export const RATING_MIN = 1;
export const RATING_MAX = 5;

const now = () => new Date().toISOString();
const text = (v, max) => String(v ?? '').trim().slice(0, max);
const err = (message, status = 400) => ({ error: message, status });

// ---------------------------------------------------------------------------
// WHO MAY CARRY
// ---------------------------------------------------------------------------

/** The real facts that make someone a carrier. Empty array = they are not one. */
export function carrierBasis(userId) {
  if (!userId) return [];
  const basis = [];
  const roles = platformRolesOf(userId);
  if (roles.includes('field_agent')) basis.push('role:field_agent');
  if (roles.includes('partner')) basis.push('role:partner');
  const claims = store.filter(
    'vendorClaims',
    (c) => c.agentId === userId && c.status === 'active'
  );
  if (claims.length) basis.push(`agent:${claims.length} active shop claim${claims.length === 1 ? '' : 's'}`);
  const carried = store.filter('pickups', (p) => p.riderId === userId);
  if (carried.length) basis.push(`rider:${carried.length} pickup${carried.length === 1 ? '' : 's'} assigned`);
  return basis;
}

export function canCarry(userId) {
  const basis = carrierBasis(userId);
  return {
    eligible: basis.length > 0,
    basis,
    // Not eligible is a state, not a verdict: this says how it changes.
    howToJoin:
      'Carry rights follow a real record — onboard a shop as a field agent, hold a partner or field-agent role, or complete a WAIRO pickup.',
    note:
      'Eligibility is derived from rows in this store on read. It is not a score, and it does not expire on a timer.'
  };
}

/** Everyone who can carry, deduped, with the fact that qualifies them. */
export function carryBoard() {
  const ids = new Set();
  for (const c of store.filter('vendorClaims', (x) => x.status === 'active')) ids.add(c.agentId);
  for (const p of store.all('pickups')) ids.add(p.riderId);
  for (const u of store.filter('users', () => true)) {
    const roles = platformRolesOf(u.id);
    if (roles.includes('field_agent') || roles.includes('partner')) ids.add(u.id);
  }
  const carriers = [];
  for (const id of ids) {
    const u = id ? store.find('users', (x) => x.id === id) : null;
    if (!u) continue; // never list a name nobody registered
    carriers.push({
      id,
      displayName: u.displayName ?? u.handle ?? 'Carrier',
      handle: u.handle ?? null,
      basis: carrierBasis(id)
    });
  }
  return carriers.sort((a, b) => String(a.displayName).localeCompare(String(b.displayName)));
}

// ---------------------------------------------------------------------------
// THE ERRAND ITSELF
// ---------------------------------------------------------------------------

function event(actorId, action, extra = {}) {
  return { at: now(), actorId, action, ...extra };
}

/**
 * Post an errand. Open to anyone signed in: stating what you need carried is
 * not a privileged act. The fee is optional and, when present, is a number the
 * POSTER stated — never an estimate generated here.
 */
export function postErrand({
  actorId,
  what,
  pickup,
  dropoff,
  whenNeeded = null,
  offeredFeeKes = null,
  note = '',
  sizeOrWeight = null,
  kind = null
} = {}) {
  if (!actorId) return err('a session is required to post an errand', 401);
  const chosenKind = kind == null || String(kind).trim() === '' ? null : String(kind).trim().toLowerCase();
  if (chosenKind !== null && !ERRAND_KIND_IDS.includes(chosenKind)) {
    return err(`kind must be one of ${ERRAND_KIND_IDS.join(', ')} — or left blank`, 400);
  }
  const title = text(what, 140);
  if (title.length < 4) return err('say what needs carrying in at least 4 characters');
  if (!text(pickup, 200)) return err('name the place to collect from');
  if (!text(dropoff, 200)) return err('name the place it goes to');

  let fee = null;
  if (offeredFeeKes !== null && offeredFeeKes !== undefined && String(offeredFeeKes).trim() !== '') {
    const n = Number(offeredFeeKes);
    if (!Number.isFinite(n) || n < 0 || n > 1e7) return err('the fee you state must be a number from 0 to 10,000,000');
    fee = Math.round(n);
  }
  const when = whenNeeded ? text(whenNeeded, 10) : null;
  if (when && !/^\d{4}-\d{2}-\d{2}$/.test(when)) return err('when it is needed must be a date');

  const row = store.insert('errands', {
    id: newId('erd'),
    posterId: actorId,
    what: title,
    pickup: text(pickup, 200),
    dropoff: text(dropoff, 200),
    sizeOrWeight: sizeOrWeight ? text(sizeOrWeight, 80) : null,
    kind: chosenKind ?? null,
    whenNeeded: when,
    offeredFeeKes: fee,
    currency: 'KES',
    note: text(note, 500),
    status: 'open',
    carrierId: null,
    acceptedBy: null,
    settlement: null,
    cancelReason: null,
    history: [event(actorId, 'errand_posted', { status: 'open' })],
    createdAt: now(),
    updatedAt: now()
  });

  const notified = notifyCarriers(row);
  return { errand: row, notified };
}

/**
 * Ping the carriers who can actually take this. In-app notification rows are
 * real; no SMS/WhatsApp provider is wired for errands, so that part is reported
 * as not sent rather than assumed.
 */
function notifyCarriers(errand) {
  let created = 0;
  let skipped = 0;
  const body = `${errand.pickup} → ${errand.dropoff}${errand.offeredFeeKes != null ? ` · fee stated KES ${errand.offeredFeeKes}` : ' · no fee stated'}`;
  for (const c of carryBoard()) {
    if (c.id === errand.posterId) continue;
    try {
      const n = notify(c.id, {
        type: 'errand',
        title: `Errand open: ${errand.what}`,
        body,
        priority: 'normal',
        dedupeKey: `errand:${errand.id}:${c.id}`,
        metadata: { errandId: errand.id, kind: 'errand_open' }
      });
      if (n) created++;
      else skipped++;
    } catch {
      skipped++;
    }
  }
  return {
    notified: created,
    skippedByPreference: skipped,
    channels: {
      inApp: 'created',
      sms: 'not_configured',
      whatsapp: 'not_configured'
    },
    note: 'An in-app notification is a row. Nothing was texted or sent on WhatsApp: Brief has no errand messaging provider wired.'
  };
}

/**
 * Stated fees on completed runs: route, cargo and fee exactly as the poster
 * wrote them, newest first. Listed, never averaged — there is no index here
 * because an index would need normalized corridors and the rows hold free
 * text. A fee without its cargo line would mislead, so it is never shown
 * without it.
 */
export function listStatedFees({ limit = 20 } = {}) {
  return store
    .filter('errands', (e) => e.status === 'delivered' && typeof e.offeredFeeKes === 'number')
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map((e) => ({
      what: e.what,
      pickup: e.pickup,
      dropoff: e.dropoff,
      sizeOrWeight: e.sizeOrWeight ?? null,
      offeredFeeKes: e.offeredFeeKes,
      currency: e.currency,
      at: e.createdAt
    }));
}

export function listErrands({ viewerId = null, status = null, kind = null, limit = 50 } = {}) {
  const want = kind == null || String(kind).trim() === '' || String(kind) === 'any'
    ? null
    : String(kind).trim().toLowerCase();
  if (want && !ERRAND_KIND_IDS.includes(want)) return [];
  const rows = store
    .filter('errands', (e) => (status ? e.status === status : true) && (want ? e.kind === want : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, Math.max(1, Math.min(limit, 200)));
  return rows.map((r) => errandView(r, viewerId));
}

export function getErrand(id, viewerId = null) {
  const row = rawErrand(id);
  return row ? errandView(row, viewerId) : null;
}

export function myErrands(userId, { limit = 30 } = {}) {
  if (!userId) return [];
  return store
    .filter('errands', (e) => e.posterId === userId || e.acceptedBy === userId)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
    .slice(0, limit)
    .map((r) => errandView(r, userId));
}

function rawErrand(id) {
  return store.find('errands', (e) => e.id === id) ?? null;
}

const TRANSITIONS = {
  open: ['accepted', 'cancelled'],
  accepted: ['picked_up', 'cancelled'],
  picked_up: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: []
};

/** Accept: the gate is the whole point of the screen. */
export function acceptErrand(id, { carrierId } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (e.status !== 'open') return err(`this errand is ${e.status}, so it cannot be taken`, 409);
  if (e.posterId === carrierId) return err('you posted this one — a carrier has to be someone else', 403);
  const gate = canCarry(carrierId);
  if (!gate.eligible) {
    return {
      ...err('carrying an errand needs a real record as an agent or partner', 403),
      eligibility: gate
    };
  }
  const updated = store.update('errands', id, {
    status: 'accepted',
    acceptedBy: carrierId,
    carrierId,
    history: [...e.history, event(carrierId, 'errand_accepted', { basis: gate.basis })]
  });
  notifyQuietly(e.posterId, `Someone took your errand`, `“${e.what}” was accepted by ${nameOf(carrierId)}.`, e.id, 'errand_accepted');
  return { errand: updated, eligibility: gate };
}

export function markPicked(id, { actorId } = {}) {
  return advance(id, actorId, 'picked_up', 'errand_picked_up');
}

export function markDelivered(id, { actorId, photo } = {}) {
  const pod = cleanPodPhoto(photo);
  if (pod?.error) return pod;
  const r = advance(id, actorId, 'delivered', 'errand_delivered');
  if (r.error || !pod) return r;
  return attachPod(id, { actorId, photo: pod });
}

/**
 * Live courier position: the carrier's phone reports where it is, but only
 * while the delivery is active (accepted → delivered). Parties-only on read,
 * and every pin carries its timestamp — a stale pin reads as stale, never
 * live. No trail is kept: the row holds the latest report, nothing more.
 */
export function sharePosition(id, { actorId, lat, lon, accuracy = null } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (actorId !== e.acceptedBy) return err('only the carrier on this errand shares its position', 403);
  if (!['accepted', 'picked_up'].includes(e.status))
    return err('position sharing is only for an active delivery', 403);
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon))
    return err('lat and lon come as a pair of numbers', 422);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180)
    return err('those coordinates are nowhere on earth', 422);
  const at = now();
  // A pinging client is throttled, not punished: repeat reports inside the
  // window get the current row back with no new write.
  if (e.carrierPosition?.at && Date.parse(at) - Date.parse(e.carrierPosition.at) < 10000) {
    return { errand: errandView(e, actorId) };
  }
  const acc = accuracy === undefined || accuracy === null ? null : Number(accuracy);
  const updated = store.update('errands', id, {
    carrierPosition: { lat, lon, accuracy: Number.isFinite(acc) ? acc : null, at }
  });
  return { errand: updated };
}

/** A delivery photo reference: a stored media id, never a pasted URL. */
function cleanPodPhoto(photo) {
  if (photo === undefined || photo === null || String(photo).trim() === '') return null;
  const s = String(photo).trim();
  if (s.length > 300) return err('the delivery photo reference is too long', 422);
  return s;
}

/**
 * Proof of delivery, attached at handoff or later (a courier at the door
 * with no signal photographs first and attaches when back online). Either
 * party may attach; the `by` name records who, so nothing masquerades.
 */
export function attachPod(id, { actorId, photo } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  const pod = cleanPodPhoto(photo);
  if (pod?.error) return pod;
  if (!pod) return err('a delivery photo is required — without it there is nothing to attach', 422);
  if (e.status !== 'delivered') return err('proof of delivery belongs to a delivered errand', 409);
  const parties = [e.posterId, e.acceptedBy].filter(Boolean);
  if (!parties.includes(actorId)) return err('only the poster or the carrier can attach delivery proof', 403);
  const at = now();
  const updated = store.update('errands', id, {
    pod: { photo: pod, by: actorId, at },
    history: [...e.history, event(actorId, 'errand_pod_attached', {})]
  });
  return { errand: updated };
}

function advance(id, actorId, next, action) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (actorId !== e.acceptedBy) return err('only the carrier who took this errand can update it', 403);
  const allowed = TRANSITIONS[e.status] ?? [];
  if (!allowed.includes(next)) {
    return err(`invalid errand transition: ${e.status} -> ${next}`, 409);
  }
  const updated = store.update('errands', id, {
    status: next,
    history: [...e.history, event(actorId, action, { status: next })]
  });
  notifyQuietly(e.posterId, `Errand ${next.replace('_', ' ')}`, `“${e.what}” is now ${next.replace('_', ' ')}.`, e.id, action);
  return { errand: updated };
}

export function cancelErrand(id, { actorId, reason = '' } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (actorId !== e.posterId) return err('only the person who posted it can cancel it', 403);
  if (['delivered', 'cancelled'].includes(e.status)) return err(`a ${e.status} errand cannot be cancelled`, 409);
  const updated = store.update('errands', id, {
    status: 'cancelled',
    cancelReason: text(reason, 200) || null,
    history: [...e.history, event(actorId, 'errand_cancelled', { reason: text(reason, 200) || null })]
  });
  if (e.acceptedBy) notifyQuietly(e.acceptedBy, 'An errand was cancelled', `“${e.what}” was cancelled by ${nameOf(actorId)}.`, e.id, 'errand_cancelled');
  return { errand: updated };
}

/**
 * The fee, agreed between the two people, recorded as agreed. Brief moved
 * nothing: a payment provider for errands is not wired, so this says who
 * confirmed and when, and stops there.
 */
export function confirmSettled(id, { actorId } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (e.status !== 'delivered') return err('the fee is confirmed once the delivery is marked delivered', 409);
  const parties = [e.posterId, e.acceptedBy].filter(Boolean);
  if (!parties.includes(actorId)) return err('only the two parties to this errand can confirm the fee', 403);
  const confirmedBy = Array.from(new Set([...(e.settlement?.confirmedBy ?? []), actorId]));
  const complete = parties.every((p) => confirmedBy.includes(p));
  const updated = store.update('errands', id, {
    settlement: {
      amountKes: e.offeredFeeKes,
      currency: e.currency,
      confirmedBy,
      at: complete ? now() : e.settlement?.at ?? null,
      movedBy: null
    }
  });
  return {
    errand: updated,
    settled: complete,
    note:
      e.offeredFeeKes == null
        ? 'No fee was stated on this errand, so there is nothing to confirm.'
        : 'Both sides have confirmed the stated fee changed hands. Brief did not move it and holds no payment for it.'
  };
}

/**
 * One rating per person, per completed delivery, from the two parties only.
 * No average is computed, because a per-person average is a score.
 */
export function rateErrand(id, { actorId, stars, note = '' } = {}) {
  const e = rawErrand(id);
  if (!e) return err('errand not found', 404);
  if (e.status !== 'delivered') return err('a delivery can only be rated once it is marked delivered', 409);
  const parties = [e.posterId, e.acceptedBy].filter(Boolean);
  if (!parties.includes(actorId)) return err('only the two parties to this delivery can rate it', 403);
  const n = Number(stars);
  if (!Number.isInteger(n) || n < RATING_MIN || n > RATING_MAX) {
    return err(`a rating is a whole number of stars from ${RATING_MIN} to ${RATING_MAX}`);
  }
  const existing = store.find('errandRatings', (r) => r.errandId === id && r.raterId === actorId);
  if (existing) return err('you have already rated this delivery — ratings are not edited away', 409);

  const row = store.insert('errandRatings', {
    id: newId('erat'),
    errandId: id,
    raterId: actorId,
    // Direction matters: a poster rating a carrier and a carrier rating the
    // walk are different facts and are never pooled.
    about: actorId === e.posterId ? 'carrier' : 'poster',
    stars: n,
    note: text(note, 300) || null,
    createdAt: now()
  });
  store.update('errands', id, { history: [...e.history, event(actorId, 'errand_rated', { stars: n })] });
  return { rating: row };
}

function nameOf(userId) {
  const u = userId ? store.find('users', (x) => x.id === userId) : null;
  return u?.displayName ?? u?.handle ?? 'someone';
}

function notifyQuietly(userId, title, body, errandId, kind) {
  if (!userId) return;
  try {
    notify(userId, {
      type: 'errand',
      title: text(title, 140),
      body: text(body, 320),
      priority: 'normal',
      dedupeKey: `errand:${errandId}:${kind}:${userId}`,
      metadata: { errandId, kind }
    });
  } catch {
    /* a preference toggle switched off is not an error worth surfacing */
  }
}

// ---------------------------------------------------------------------------
// READ MODELS
// ---------------------------------------------------------------------------

/** The loop, stage by stage, from the row's own history. Unreached stages are
 *  shown as upcoming with no timestamp — never back-filled with a guess. */
export const LOOP_STAGES = [
  { key: 'posted', label: 'Posted' },
  { key: 'accepted', label: 'A carrier took it' },
  { key: 'picked_up', label: 'Collected at the source' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'settled', label: 'Fee agreed between you' },
  { key: 'rated', label: 'Rated by both sides' }
];

function stageAt(errand, key) {
  const map = {
    posted: ['errand_posted'],
    accepted: ['errand_accepted'],
    picked_up: ['errand_picked_up'],
    delivered: ['errand_delivered'],
    settled: [],
    rated: ['errand_rated']
  };
  const hit = (errand.history ?? []).filter((h) => (map[key] ?? []).includes(h.action));
  if (key === 'settled') return errand.settlement?.at ?? null;
  return hit.length ? hit[hit.length - 1].at : null;
}

export function loopFor(errand, ratings = []) {
  return LOOP_STAGES.map((s) => {
    const at = stageAt(errand, s.key);
    return { ...s, at, done: Boolean(at) };
  });
}

/** One rating list, no aggregate. */
export function ratingsFor(errandId) {
  return store
    .filter('errandRatings', (r) => r.errandId === errandId)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .map((r) => ({
      id: r.id,
      by: nameOf(r.raterId),
      about: r.about,
      stars: r.stars,
      note: r.note,
      createdAt: r.createdAt
    }));
}

export function errandView(row, viewerId = null) {
  const ratings = ratingsFor(row.id);
  const iRated = viewerId
    ? store.find('errandRatings', (r) => r.errandId === row.id && r.raterId === viewerId) ?? null
    : null;
  const parties = [row.posterId, row.acceptedBy].filter(Boolean);
  return {
    id: row.id,
    what: row.what,
    pickup: row.pickup,
    dropoff: row.dropoff,
    sizeOrWeight: row.sizeOrWeight,
    // Stated as both id and words, so no surface re-maps the list and drifts.
    kind: row.kind ?? null,
    kindLabel: kindLabel(row.kind),
    whenNeeded: row.whenNeeded,
    offeredFeeKes: row.offeredFeeKes,
    currency: row.currency,
    note: row.note,
    status: row.status,
    posterId: row.posterId,
    posterName: nameOf(row.posterId),
    acceptedBy: row.acceptedBy,
    carrierName: row.acceptedBy ? nameOf(row.acceptedBy) : null,
    carrierBasis: row.acceptedBy ? carrierBasis(row.acceptedBy) : [],
    settlement: row.settlement
      ? { ...row.settlement, confirmedNames: (row.settlement.confirmedBy ?? []).map(nameOf) }
      : null,
    cancelReason: row.cancelReason,
    pod: row.pod ? { photo: row.pod.photo, by: nameOf(row.pod.by), at: row.pod.at } : null,
    // Courier GPS is parties-only: the poster and the carrier see it, the
    // open board never does. Always with its timestamp, so age is readable.
    carrierPosition:
      viewerId && [row.posterId, row.acceptedBy].filter(Boolean).includes(viewerId) && row.carrierPosition
        ? { ...row.carrierPosition }
        : null,
    isMine: viewerId ? parties.includes(viewerId) : false,
    iAmTheCarrier: viewerId ? row.acceptedBy === viewerId : false,
    iAmThePoster: viewerId ? row.posterId === viewerId : false,
    canRate: Boolean(viewerId) && row.status === 'delivered' && parties.includes(viewerId) && !iRated,
    canConfirmFee: Boolean(viewerId) && row.status === 'delivered' && parties.includes(viewerId)
      && !(row.settlement?.confirmedBy ?? []).includes(viewerId),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    history: (row.history ?? []).map((h) => ({ action: h.action, at: h.at, by: nameOf(h.actorId) })),
    loop: loopFor(row, ratings),
    ratings,
    // Stated, not hidden: there is no aggregate on purpose.
    ratingsNote: 'Ratings are listed as said, per delivery. Brief computes no average, score or rank from them.'
  };
}

// ---------------------------------------------------------------------------
// PROVIDERS — what else exists for moving a thing, stated honestly
// ---------------------------------------------------------------------------

/**
 * "Reveal the other mailing and courier services." Two different kinds of
 * answer, kept visibly apart:
 *
 *   integrated  — something Brief can actually dispatch or track through its
 *                 own rows (WAIRO riders, derived from real pickups).
 *   named-by-us — a service people arrange themselves. We list the name and
 *                 NOTHING else: no phone number, no rate, no SLA, because Brief
 *                 holds none of that and inventing a contact for a real company
 *                 is a lie that gets someone an angry call.
 *   used-here   — carriers that appear in this store's own dispatch rows
 *                 (Inter-County Cargo names typed by real users), counted.
 */
export function providers() {
  const riders = store.filter('vendorClaims', (c) => c.status === 'active').length;
  const carried = store.all('pickups').filter((p) => p.status === 'delivered').length;

  const used = new Map();
  for (const d of store.all('spaceDispatches')) {
    const name = text(d.carrierSacco, 80);
    if (!name) continue;
    const row = used.get(name) ?? { name, dispatches: 0, waybills: new Set() };
    row.dispatches++;
    if (d.waybillRef) row.waybills.add(d.waybillRef);
    used.set(name, row);
  }

  return {
    integrated: [
      {
        key: 'wairo',
        name: 'WAIRO riders',
        what: 'Bike and foot errands around town',
        canDispatchThroughBrief: true,
        agentsOnRecord: riders,
        deliveredPickups: carried,
        note: 'Dispatched and tracked in Brief: a rider is a real row and each stage is timestamped here.'
      }
    ],
    usedHere: [...used.values()]
      .sort((a, b) => b.dispatches - a.dispatches)
      .map((r) => ({
        key: `sacco:${r.name}`,
        name: r.name,
        what: 'Inter-county cargo, stage-to-stage',
        canDispatchThroughBrief: false,
        dispatchesRecorded: r.dispatches,
        waybillsCaptured: r.waybills.size,
        note: 'Named by people using Brief for their own cargo. Brief records the waybill you type; it cannot book or chase the vehicle.'
      })),
    external: [
      { key: 'fargo', name: 'Fargo Courier', canDispatchThroughBrief: false, reason: 'no integration in Brief' },
      { key: 'posta', name: 'Posta Kenya parcels', canDispatchThroughBrief: false, reason: 'no integration in Brief' },
      { key: 'own-vehicle', name: 'Your own vehicle or a boda you call', canDispatchThroughBrief: false, reason: 'nothing for Brief to record unless you post it as an errand' }
    ],
    disclosure:
      'For anything not dispatched through Brief, this list carries a name and nothing else: no phone number, no price, no promise. Arrange and pay them directly, and post the errand here if you want a carrier from this network to take it.'
  };
}
