// ---------------------------------------------------------------------------
// NOTIFICATIONS — the in-app return loop.
//
// A notification is a REAL, derived event, written by the code that produced
// the underlying change — never a marketing broadcast. It is local-only: the
// center is the product surface; push (FCM/APNs) is a separate, still-
// unconnected rail that this module deliberately does not fake.
//
// Rules carried from the surround systems:
//   * a notification references the underlying Brief object/entity — it never
//     copies content (the row may carry a short title/context line, but the
//     object stays the single source of truth);
//   * generation passes the relevance gate FIRST: explicit follow, saved
//     object, followed location/type, meaningful status change, or an
//     important local alert. Ingestion alone never notifies;
//   * dedup uses the canonical object id (the pipeline already merges
//     Telegram + RSS + Web into one object), so one event = one notification;
//   * coalescing: several items from the same followed area become one batched
//     "N new events in Westlands" row — quietness by design;
//   * privacy: every row is scoped to userId, and every read route resolves
//     the caller's own rows only.
// ---------------------------------------------------------------------------

import { store, newId } from '../store.js';
import { dayBucket } from '../dayBoundary.js';
import * as discovery from './discovery.js';
import * as publicFeed from './publicFeed.js';
import * as personal from './personal.js';
import * as entities from './entities.js';
import * as corrections from './corrections.js';
import * as campaigns from './campaign.js';
import { emitSignal } from './signal.js';

// ---------------------------------------------------------------------------
// TYPES, PRIORITY, PREFERENCES
// ---------------------------------------------------------------------------

/**
 * The typed notification surface. Legacy kinds (confirmed, challenge,
 * workflow, coop, system, saved_changed, event_soon) stay valid so existing
 * writers keep working; every row carries BOTH `kind` (writer's word) and
 * `type` (the surface's word).
 */
export const NOTIFICATION_TYPES = [
  // --- return-loop types ---------------------------------------------------
  'following',      // new meaningful activity from a followed entity
  'location',       // important/new activity in a followed location
  'event',          // a saved/followed event is approaching
  // An event the person is PARTY TO changed under them, or was withdrawn.
  // These are not the return-loop's "coming up" reminder: they are the host
  // changing or cancelling something already relied on, so they fire from the
  // host's action (domain/campaign.js), never from a generation sweep.
  'event_changed',
  'event_withdrawn',
  'offer',          // a saved offer is approaching expiry
  'alert',          // a relevant important alert appears
  'collection',     // a saved item's status changed
  'correction',     // important information on a saved/followed object corrected
  'source_update',  // a followed publisher/source produced new information
  'broadcast',      // a space told its followers something (24h update)
  'shop_brief',     // the morning read of one business: yesterday's rows, in
                    // the owner's own words. Sent only to an owner who asked for
                    // it, at the hour they named, and never for a quiet day.
                    // See domain/shopBrief.js.
  'reminder',       // something the person themselves left open, arriving when
                    // the ENGINE decided the time had come (a schedule row, not
                    // a timer in a process). Its own type so a person can turn
                    // reminders off without muting alerts about the world.
  'errand',         // a posted errand an eligible carrier can pick up, or a
                    // stage change on one they are party to
  // --- legacy kinds (kept for the existing notification rail) ---------------
  'confirmed',
  'challenge',
  'saved_changed',
  'event_soon',
  'system',
  'workflow',
  'coop'
];

export const NOTIFICATION_KINDS = NOTIFICATION_TYPES;

export const PRIORITIES = ['important', 'normal', 'low'];

export const TYPE_LABELS = {
  following: 'Following',
  location: 'Location',
  event: 'Event',
  offer: 'Offer',
  alert: 'Alert',
  collection: 'Saved',
  correction: 'Corrected',
  source_update: 'News',
  errand: 'Errands',
  broadcast: 'Updates',
  shop_brief: 'Shop brief',
  confirmed: 'Confirmed',
  saved_changed: 'Saved',
  event_soon: 'Event',
  event_changed: 'Event changed',
  event_withdrawn: 'Event withdrawn',
  system: 'Brief',
  workflow: 'Workflow',
  coop: 'Co-op'
};

/** Notification category -> the single preference toggle that gates it. */
export const TYPE_TO_CATEGORY = {
  following: 'following',
  location: 'locations',
  event: 'events',
  event_changed: 'events',
  event_withdrawn: 'events',
  offer: 'offers',
  alert: 'alerts',
  collection: 'saved',
  correction: 'saved',
  source_update: 'news',
  errand: 'alerts',
  broadcast: 'alerts',
  shop_brief: 'alerts',
  reminder: 'alerts',
  confirmed: 'saved',
  challenge: 'events',
  saved_changed: 'saved',
  event_soon: 'events',
  system: 'alerts',
  workflow: 'saved',
  coop: 'following'
};

/** The preference categories — seven simple toggles, defaults ON. */
export const PREF_CATEGORIES = ['following', 'events', 'offers', 'alerts', 'news', 'locations', 'saved'];

export const DEFAULT_PREFS = Object.fromEntries(PREF_CATEGORIES.map((c) => [c, true]));

const LEGACY_TYPE = {
  confirmed: 'confirmed',
  challenge: 'challenge',
  saved_changed: 'saved_changed',
  event_soon: 'event_soon',
  system: 'system',
  workflow: 'workflow',
  coop: 'coop'
};

const HOUR = 3_600_000;
const DAY = 86_400_000;

function nowIso() {
  return new Date().toISOString();
}

// The day a notification belongs to comes from the one shared rule
// (src/dayBoundary.js), so a batch can never disagree with an overdue deadline
// about when "today" ends. Re-exported here because the day rule is part of this
// domain's contract with the people it notifies — the suite reads it off this
// module on purpose.
export { dayBucket };

// ---------------------------------------------------------------------------
// PREFERENCES (one row per user, created lazily, defaults ON)
// ---------------------------------------------------------------------------

function prefsRow(userId) {
  return store.find('notificationPrefs', (p) => p.userId === userId);
}

export function ensurePreferences(userId) {
  const existing = prefsRow(userId);
  if (existing) return existing;
  return store.insert('notificationPrefs', {
    id: newId('ntfp'),
    userId,
    categories: { ...DEFAULT_PREFS },
    // null until the first generation sweep runs: the sweep then baselines
    // from the moment the user started caring (follow/save/interest), never
    // from the dawn of the database.
    generatedAt: null,
    createdAt: nowIso(),
    updatedAt: nowIso()
  });
}

/** The user's preference state (categories + next-generation watermark). */
export function getPreferences(userId, { ensure = true } = {}) {
  const row = ensure ? ensurePreferences(userId) : prefsRow(userId);
  if (!row) return { categories: { ...DEFAULT_PREFS }, generatedAt: null };
  return {
    categories: { ...DEFAULT_PREFS, ...(row.categories ?? {}) },
    generatedAt: row.generatedAt ?? null
  };
}

/** Patch categories (partial allowed). Returns the new state. */
export function setPreferences(userId, patch = {}) {
  const row = ensurePreferences(userId);
  const incoming = patch && typeof patch === 'object' ? patch : {};
  const categories = { ...DEFAULT_PREFS, ...(row.categories ?? {}) };
  let changed = false;
  for (const key of PREF_CATEGORIES) {
    if (typeof incoming[key] === 'boolean' && incoming[key] !== categories[key]) {
      categories[key] = incoming[key];
      changed = true;
    }
  }
  if (changed) {
    store.update('notificationPrefs', row.id, { categories, updatedAt: nowIso() });
    emitSignal({ type: 'notification_pref_changed', actorId: userId, metadata: { categories } });
  }
  return { categories, changed };
}

/** The preference gate: is this type wanted by this user right now? */
export function wanted(userId, type) {
  const category = TYPE_TO_CATEGORY[type] ?? 'alerts';
  return getPreferences(userId).categories[category] === true;
}

// ---------------------------------------------------------------------------
// WRITE — the single creation path, shared by the engine and legacy writers
// ---------------------------------------------------------------------------

function destFor(opts) {
  if (opts.dest) return String(opts.dest);
  if (opts.entityId) return `entity:${opts.entityId}`;
  if (opts.collectionId) return `collection:${opts.collectionId}`;
  if (opts.objectId) return `object:${opts.objectId}`;
  return null;
}

/**
 * Create (or dedup/coalesce) one notification. Never throws for a quiet
 * outcome: a preference-gated or duplicated row returns null from creation.
 *
 * opts: { kind?, type?, title, body?, objectId?, entityId?, collectionId?,
 *         imageUrl?, sourceName?, context?, dest?, priority?, dedupeKey?,
 *         coalesce?, metadata?, at? }
 */
export function notify(userId, opts = {}) {
  if (!userId) return null;
  const type = opts.type ?? LEGACY_TYPE[opts.kind] ?? opts.kind ?? 'system';
  if (!NOTIFICATION_TYPES.includes(type)) {
    throw new Error(`unknown notification type: ${type}`);
  }
  if (!opts.title) throw new Error('title is required');
  if (!wanted(userId, type)) return null;

  const dedupeKey = opts.dedupeKey ? String(opts.dedupeKey) : null;

  if (dedupeKey) {
    const existing = store.find('notifications', (n) => n.userId === userId && n.dedupeKey === dedupeKey);
    if (existing) {
      if (opts.coalesce) {
        // New content on the same thread: bump the count by the batch size,
        // refresh the line, and surface it as unread again — the user has
        // NOT seen this part.
        const batch = Number(opts.metadata?.count) || 1;
        const count = Number(existing.metadata?.count ?? 1) + batch;
        const priority = opts.priority ?? existing.priority ?? 'normal';
        store.update('notifications', existing.id, {
          title: String(opts.title).slice(0, 140),
          body: opts.body ? String(opts.body).slice(0, 320) : existing.body,
          priority,
          read: false,
          readAt: null,
          metadata: {
            ...(existing.metadata ?? {}),
            ...(opts.metadata ?? {}),
            count,
            objectIds: [...new Set([...(existing.metadata?.objectIds ?? []), ...(opts.metadata?.objectIds ?? [])])].slice(0, 20)
          }
        });
        return { notification: store.find('notifications', (n) => n.id === existing.id), created: false, coalesced: true };
      }
      // Already delivered, already read, same thread: nothing new to say.
      return { notification: existing, created: false, deduped: true };
    }
  }

  const at = opts.at ? new Date(opts.at).toISOString() : nowIso();
  const row = {
    id: newId('ntf'),
    userId,
    kind: opts.kind ?? type,
    type,
    title: String(opts.title).slice(0, 140),
    body: opts.body ? String(opts.body).slice(0, 320) : null,
    objectId: opts.objectId ?? null,
    entityId: opts.entityId ?? null,
    collectionId: opts.collectionId ?? null,
    imageUrl: typeof opts.imageUrl === 'string' && opts.imageUrl ? opts.imageUrl : null,
    sourceName: typeof opts.sourceName === 'string' && opts.sourceName ? opts.sourceName : null,
    context: typeof opts.context === 'string' && opts.context ? opts.context : null,
    dest: destFor(opts),
    priority: PRIORITIES.includes(opts.priority) ? opts.priority : 'normal',
    status: 'active',
    read: false,
    readAt: null,
    dedupeKey,
    metadata: { ...(opts.metadata ?? {}) },
    createdAt: at,
    updatedAt: at
  };
  const inserted = store.insert('notifications', row);
  emitSignal({ type: 'notification_generated', actorId: userId, objectId: row.objectId, metadata: { notificationId: row.id, type: row.type } });
  return { notification: inserted, created: true };
}

// ---------------------------------------------------------------------------
// READ
// ---------------------------------------------------------------------------

export function listNotifications(userId, { limit = 50, unreadOnly = false } = {}) {
  let rows = store.filter('notifications', (n) => n.userId === userId);
  if (unreadOnly) rows = rows.filter((n) => !n.read);
  rows = rows.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, Math.max(1, Math.min(200, limit)));
  return rows.map((n) => enrich(n, userId));
}

export function unreadCount(userId) {
  return store.filter('notifications', (n) => n.userId === userId && !n.read).length;
}

export function markRead(userId, notificationId) {
  const n = store.find('notifications', (x) => x.id === notificationId && x.userId === userId);
  if (!n) return null;
  if (!n.read) {
    store.update('notifications', notificationId, { read: true, readAt: nowIso() });
    emitSignal({ type: 'notification_marked_read', actorId: userId, notificationId: null, metadata: { notificationId: n.id, action: 'read' } });
  }
  return store.find('notifications', (x) => x.id === notificationId);
}

export function markUnread(userId, notificationId) {
  const n = store.find('notifications', (x) => x.id === notificationId && x.userId === userId);
  if (!n) return null;
  if (n.read) store.update('notifications', notificationId, { read: false, readAt: null });
  return store.find('notifications', (x) => x.id === notificationId);
}

export function markAllRead(userId) {
  let n = 0;
  for (const x of store.filter('notifications', (i) => i.userId === userId && !i.read)) {
    store.update('notifications', x.id, { read: true, readAt: nowIso() });
    n++;
  }
  if (n > 0) {
    emitSignal({ type: 'notification_marked_read', actorId: userId, metadata: { all: true, marked: n } });
  }
  return { marked: n };
}

/** A tap on a notification = read + a real "opened" event for analytics. */
export function openNotification(userId, notificationId) {
  const n = store.find('notifications', (x) => x.id === notificationId && x.userId === userId);
  if (!n) return null;
  if (!n.read) store.update('notifications', notificationId, { read: true, readAt: nowIso() });
  const updated = store.find('notifications', (x) => x.id === notificationId);
  emitSignal({
    type: 'notification_opened',
    actorId: userId,
    objectId: updated.objectId,
    metadata: { notificationId: updated.id, type: updated.type, dest: updated.dest }
  });
  return updated;
}

// ---------------------------------------------------------------------------
// PROJECTION — what the center may see (privacy: the caller's own rows only,
// and object summaries only where the caller could open the object anyway)
// ---------------------------------------------------------------------------

function objectPreview(objectId, viewerId, now) {
  const object = store.find('objects', (o) => o.id === objectId);
  if (!object) return null;
  const accessible = object.publication === 'public' || campaigns.mayAttachObject(viewerId, object);
  if (!accessible) return null;
  const projected = object.publication === 'public'
    ? publicFeed.publicObject({ ...object, temporal: discovery.temporalFields(object, now) })
    : null;
  const fields = projected ?? object;
  return {
    id: object.id,
    type: object.type,
    title: typeof fields.title === 'string' ? fields.title : null,
    status: (fields.temporal ?? discovery.temporalFields(object, now))?.status ?? null,
    imageUrl: fields.media?.url ?? fields.imageUrl ?? null,
    sourceNames: Array.isArray(fields.sourceNames) ? fields.sourceNames.slice(0, 3) : []
  };
}

function enrich(n, viewerId) {
  const now = new Date();
  const out = { ...n };
  out.object = n.objectId ? objectPreview(n.objectId, viewerId, now) : null;
  if (n.entityId) {
    const e = entities.resolveEntities().get(n.entityId);
    out.entityName = e?.name ?? null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// GENERATION ENGINE — relevance gate, dedup, coalescing, priority
// ---------------------------------------------------------------------------

function isSince(iso, sinceMs) {
  const t = Date.parse(iso ?? '');
  return Number.isFinite(t) && t >= sinceMs;
}

function freshSince(defaultMs) {
  return (o) => isSince(o.updatedAt ?? o.createdAt ?? o.ingestedAt, defaultMs);
}

/** The timestamp the user started caring: earliest follow / save / interest. */
function careBaseline(userId) {
  const stamps = [];
  for (const f of store.filter('entityFollows', (f) => f.userId === userId)) stamps.push(f.createdAt);
  for (const s of store.filter('saves', (s) => s.userId === userId)) stamps.push(s.createdAt);
  for (const p of store.filter('personalCollectionItems', (r) => {
    const c = store.find('personalCollections', (x) => x.id === r.collectionId);
    return c?.ownerId === userId;
  })) stamps.push(p.addedAt);
  for (const i of store.filter('userInterests', (i) => i.userId === userId)) stamps.push(i.createdAt);
  const valid = stamps.map((s) => Date.parse(s)).filter(Number.isFinite);
  return valid.length ? Math.min(...valid) : Date.now();
}

function objectMeta(o) {
  return o?.metadata ?? {};
}

/** One object: image + real source name from provenance (never fabricated). */
function visualOf(object) {
  const sources = discovery.sourcesOf(object);
  const sourceName = sources[0]?.name ?? null;
  const image = object.imageUrl
    ?? object.media?.url
    ?? (typeof object.imageUrl === 'string' ? object.imageUrl : null);
  return { imageUrl: image ?? null, sourceName };
}

function titleOf(o) {
  return typeof o.title === 'string' && o.title.trim() ? o.title.trim() : 'This item';
}

function contextOf(object, now) {
  const meta = objectMeta(object);
  const area = typeof meta.area === 'string' ? meta.area
    : typeof object.locationName === 'string' ? object.locationName : null;
  return area ? `In ${area}` : null;
}

function saveObjectIds(userId) {
  const ids = new Set(personal.savedIdsOf(userId));
  for (const r of store.filter('personalCollectionItems', () => true)) {
    const c = store.find('personalCollections', (x) => x.id === r.collectionId);
    if (c?.ownerId === userId) ids.add(r.objectId);
  }
  return ids;
}

/** Which entities the user follows (id + kind), for entity-scoped scans. */
function followedOf(userId) {
  return entities.listFollows(userId);
}

function followedEntityOfObject(object) {
  return new Set(entities.entityKeysOfObject(object));
}

/**
 * Generate notifications for one user.
 *
 * Scans ONLY explicit signals (follows, saves, collection member items,
 * interests) against real objects. Idempotent: dedupe keys mean re-running
 * the sweep never duplicates. `now` can be frozen for deterministic tests.
 */
export function generateForUser(userId, now = new Date()) {
  const prefs = ensurePreferences(userId);
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const sinceMs = prefs.generatedAt ? Date.parse(prefs.generatedAt) : careBaseline(userId);
  const since = new Date(Number.isFinite(sinceMs) ? sinceMs : nowMs);

  const interests = personal.interestsOf(userId);
  const saved = saveObjectIds(userId);
  const relevance = personal.relevanceOf(userId);
  const follows = followedOf(userId);
  const followedSet = new Set(follows.map((f) => f.id));
  const entitiesMap = entities.resolveEntities();

  const created = [];
  const seenObjects = new Set();

  const sweepAt = new Date(nowMs).toISOString();

  /** Fire one notification and record it (silent on dedupe/coalesce). */
  const fire = (args) => {
    const moved = notify(userId, { ...args, at: args.at ?? sweepAt });
    if (moved?.created || moved?.coalesced) created.push({ ...moved, notification: moved.notification });
    return moved;
  };

  const skip = (object) => {
    if (!object || object.publication !== 'public') return true;
    if (discovery.isStale(object, now)) return true;
    if (personal.excludedFromPersonal(object, relevance)) return true;
    return false;
  };

  const newer = (object, anchorMs) => isSince(object.createdAt ?? object.ingestedAt, anchorMs);

  // -------------------------------------------------------------------------
  // 1. FOLLOWED ENTITIES — new activity, published after the follow itself.
  // -------------------------------------------------------------------------
  for (const f of follows) {
    const entity = entitiesMap.get(f.id);
    if (!entity) continue;
    const followMs = Date.parse(f.followedAt ?? f.createdAt ?? '') || 0;
    const anchor = Math.max(sinceMs, followMs);
    // A venue/business entity IS its own object — the identity row is not
    // "new activity", only the things attached to it are.
    const identityId = (f.kind === 'venue' || f.kind === 'business') ? f.entityKey : null;
    for (const o of entity.objects ?? []) {
      if (identityId && o.id === identityId) continue;
      if (seenObjects.has(o.id) || skip(o)) continue;
      if (saved.has(o.id)) continue; // saved objects get targeted notices below
      if (!newer(o, anchor)) continue;
      seenObjects.add(o.id);
      const { imageUrl, sourceName } = visualOf(o);
      const isPublisher = f.kind === 'publisher';
      fire({
        type: isPublisher ? 'source_update' : 'following',
        title: isPublisher
          ? `${entity.name} published something new`
          : `New from ${entity.name}`,
        body: isPublisher
          ? titleOf(o)
          : `${titleOf(o)}.${contextOf(o, now) ? ` ${contextOf(o, now)}.` : ''}`,
        objectId: o.id,
        entityId: f.id,
        imageUrl,
        sourceName: sourceName ?? entity.name,
        context: contextOf(o, now),
        dest: `object:${o.id}`,
        priority: o.type === 'alert' ? 'important' : 'normal',
        dedupeKey: `following:${f.id}:${o.id}`
      });
    }
  }

  // -------------------------------------------------------------------------
  // 2. FOLLOWED LOCATIONS — new activity, batched per area per day.
  // -------------------------------------------------------------------------
  const locationBuckets = new Map(); // `${loc}::${bucket}` -> { objects, types }
  for (const loc of interests.locations) {
    for (const o of store.all('objects')) {
      if (seenObjects.has(o.id) || skip(o)) continue;
      if (saved.has(o.id)) continue; // saved objects get targeted notices below
      if (!personal.matchesLocation(o, loc)) continue;
      if (!newer(o, sinceMs)) continue;
      if (!['event', 'experience', 'offer', 'alert', 'news', 'announcement', 'opportunity'].includes(o.type)) continue;
      seenObjects.add(o.id);
      const key = `${loc}::${dayBucket(o.createdAt ?? nowIso())}`;
      if (!locationBuckets.has(key)) locationBuckets.set(key, { loc, objects: [] });
      locationBuckets.get(key).objects.push(o);
    }
  }
  for (const { loc, objects: bucket } of locationBuckets.values()) {
    // Alerts are individually important; everything else batches.
    const alerts = bucket.filter((o) => o.type === 'alert');
    for (const o of alerts) {
      const { imageUrl, sourceName } = visualOf(o);
      fire({
        type: 'alert',
        title: `Alert in ${loc}`,
        body: titleOf(o),
        objectId: o.id,
        imageUrl,
        sourceName,
        context: `In ${loc}`,
        dest: `object:${o.id}`,
        priority: 'important',
        dedupeKey: `alert:${o.id}`
      });
    }
    const rest = bucket.filter((o) => o.type !== 'alert');
    if (rest.length === 0) continue;
    if (rest.length === 1) {
      const o = rest[0];
      const { imageUrl, sourceName } = visualOf(o);
      fire({
        type: 'location',
        title: `${titleOf(o)}`,
        body: `New in ${loc}`,
        objectId: o.id,
        imageUrl,
        sourceName,
        context: `In ${loc}`,
        dest: `location:${loc}`,
        priority: o.type === 'offer' ? 'low' : 'normal',
        dedupeKey: `location:${loc}:${o.id}`
      });
      continue;
    }
    const noun = (() => {
      const byType = {};
      for (const o of rest) byType[o.type] = (byType[o.type] ?? 0) + 1;
      const [top] = Object.entries(byType).sort((a, b) => b[1] - a[1])[0] ?? [];
      const label = { event: 'events', experience: 'events', offer: 'offers', news: 'updates', announcement: 'updates', opportunity: 'opportunities' }[top] ?? 'updates';
      return label;
    })();
    const first = rest[0];
    const { imageUrl } = visualOf(first);
    fire({
      type: 'location',
      title: `${rest.length} new ${noun} in ${loc}`,
      body: rest.slice(0, 3).map((o) => titleOf(o)).join(' · '),
      objectId: rest.length === 1 ? first.id : null,
      imageUrl,
      sourceName: null,
      context: `In ${loc}`,
      dest: `location:${loc}`,
      priority: 'normal',
      dedupeKey: `location:${loc}:${dayBucket(first.createdAt ?? nowIso())}`,
      coalesce: true,
      metadata: { count: rest.length, location: loc, objectIds: rest.map((o) => o.id).slice(0, 20) }
    });
  }

  // -------------------------------------------------------------------------
  // 3. SAVED / COLLECTED OBJECTS — approaching events, expiring offers,
  //    status changes. Scanned regardless of age; dedupe keys bucket by day /
  //    status so "tomorrow" surfaces exactly once per day. Status changes are
  //    deliberately allowed on STALE objects — "your saved offer expired" is
  //    precisely the news the return loop exists for.
  // -------------------------------------------------------------------------
  for (const objectId of saved) {
    const o = store.find('objects', (x) => x.id === objectId);
    if (!o || o.publication !== 'public') continue;
    if (personal.excludedFromPersonal(o, relevance)) continue;
    const life = discovery.lifecycleOf(o, now);
    const isEvent = o.type === 'event' || o.type === 'experience';
    const isOfferish = o.type === 'offer' || o.type === 'opportunity';
    const meta = objectMeta(o);
    const { imageUrl, sourceName } = visualOf(o);
    const live = !discovery.isStale(o, now);

    // Approaching event (≤ 48h): "today" is important, "tomorrow" normal.
    if (live && isEvent && life.startsAt) {
      const hours = (Date.parse(life.startsAt) - nowMs) / HOUR;
      if (hours >= 0 && hours <= 48) {
        const starts = new Date(life.startsAt);
        const timeLabel = starts.toLocaleTimeString('en-KE', { hour: 'numeric', minute: '2-digit' });
        const dayLabel = starts.toLocaleDateString('en-KE', { weekday: 'long' });
        fire({
          type: 'event',
          title: hours <= 24 ? 'Saved event starts today' : `Saved event ${dayLabel.toLowerCase()}`,
          body: `${titleOf(o)} — ${dayLabel} at ${timeLabel}`,
          objectId: o.id,
          imageUrl,
          sourceName,
          context: contextOf(o, now),
          dest: `object:${o.id}`,
          priority: hours <= 24 ? 'important' : 'normal',
          dedupeKey: `event_reminder:${o.id}:${dayBucket(life.startsAt)}`
        });
      }
    }

    // Approaching expiry (≤ 48h).
    if (live && isOfferish && life.deadlineAt) {
      const hours = (Date.parse(life.deadlineAt) - nowMs) / HOUR;
      if (hours >= 0 && hours <= 48) {
        const due = new Date(life.deadlineAt);
        const label = o.type === 'opportunity' ? 'Deadline' : 'Offer';
        fire({
          type: 'offer',
          title: hours <= 24
            ? (o.type === 'opportunity' ? 'Deadline is today' : 'Offer expires today')
            : `${label} ${due.toLocaleDateString('en-KE', { weekday: 'long' }).toLowerCase()}`,
          body: `${titleOf(o)} — ${due.toLocaleDateString('en-KE', { day: 'numeric', month: 'short' })}`,
          objectId: o.id,
          imageUrl,
          sourceName,
          context: contextOf(o, now),
          dest: `object:${o.id}`,
          priority: hours <= 24 ? 'important' : 'normal',
          dedupeKey: `offer_expiry:${o.id}:${dayBucket(life.deadlineAt)}`
        });
      }
    }

    // A real cancellation (statusBadge says so — never invented).
    const badge = String(meta.statusBadge ?? '').toLowerCase();
    if (badge === 'cancelled' || badge === 'canceled') {
      fire({
        type: 'collection',
        title: isEvent ? 'Event cancelled' : 'Item cancelled',
        body: titleOf(o),
        objectId: o.id,
        imageUrl,
        sourceName,
        context: contextOf(o, now),
        dest: `object:${o.id}`,
        priority: 'important',
        dedupeKey: `status_cancel:${o.id}`
      });
    } else {
      // Lifecycle crossed into ended/expired within the last 48h.
      const endedAt = isEvent ? (life.endsAt ?? life.startsAt) : life.deadlineAt;
      const ended = isEvent ? life.status === 'past' : life.status === 'expired' || life.status === 'past';
      if (ended && endedAt) {
        const ago = (nowMs - Date.parse(endedAt)) / HOUR;
        if (ago >= 0 && ago <= 48) {
          fire({
            type: 'collection',
            title: isEvent ? 'Event ended' : (o.type === 'opportunity' ? 'Deadline passed' : 'Offer expired'),
            body: `${titleOf(o)} — ${life.status}`,
            objectId: o.id,
            imageUrl,
            sourceName,
            context: contextOf(o, now),
            dest: `object:${o.id}`,
            priority: 'normal',
            dedupeKey: `status_end:${o.id}:${life.status}`
          });
        }
      }
    }

    // Saved opportunity application deadline (≤ 48h) handled above by deadline.
    // No extra type: Offer type covers "application deadline approaching".
  }

  // -------------------------------------------------------------------------
  // 4. FOLLOWED TYPE — an explicit type follow is an explicit signal.
  //    Events/offers/announcements only; knowledge/places never notify.
  // -------------------------------------------------------------------------
  for (const type of interests.types) {
    if (!['event', 'experience', 'offer', 'announcement', 'news', 'opportunity'].includes(type)) continue;
    for (const o of store.all('objects')) {
      if (seenObjects.has(o.id) || skip(o)) continue;
      if (o.type !== type || !newer(o, sinceMs)) continue;
      if (saved.has(o.id) || followedEntityOfObject(o).size > 0) continue; // already covered
      seenObjects.add(o.id);
      const { imageUrl, sourceName } = visualOf(o);
      fire({
        type: 'following',
        title: `New ${o.type} you follow`,
        body: titleOf(o),
        objectId: o.id,
        imageUrl,
        sourceName,
        context: contextOf(o, now),
        dest: `object:${o.id}`,
        priority: 'normal',
        dedupeKey: `typefollow:${type}:${o.id}`
      });
    }
  }

  // -------------------------------------------------------------------------
  // 5. CORRECTIONS on saved/followed objects.
  // -------------------------------------------------------------------------
  const corrected = corrections.listCorrections({ status: 'applied' });
  for (const c of corrected) {
    if (!isSince(c.createdAt, sinceMs)) continue;
    const o = store.find('objects', (x) => x.id === c.objectId);
    if (!o || o.publication !== 'public') continue;
    if (personal.excludedFromPersonal(o, relevance)) continue;
    const isMine = saved.has(o.id) || [...followedEntityOfObject(o)].some((k) => followedSet.has(k));
    if (!isMine) continue;
    const { imageUrl, sourceName } = visualOf(o);
    const fieldLabel = c.field === 'venue' ? 'venue'
      : c.field === 'dateCanonical' ? 'date'
        : c.field === 'eventStart' ? 'start time'
          : c.field === 'deadlineCanonical' ? 'deadline'
            : c.field === 'statusBadge' ? 'status'
              : c.field;
    fire({
      type: 'correction',
      title: `Corrected — ${fieldLabel} changed`,
      body: `${titleOf(o)}: ${c.originalValue ?? 'unknown'} → ${c.correctedValue}`,
      objectId: o.id,
      imageUrl,
      sourceName,
      context: contextOf(o, now),
      dest: `object:${o.id}`,
      priority: 'important',
      dedupeKey: `correction:${o.id}:${c.id}`
    });
  }

  // Advance the watermark even when nothing matched (the sweep ran).
  store.update('notificationPrefs', prefs.id, { generatedAt: sweepAt, updatedAt: nowIso() });
  return { generated: created.map((c) => c.notification), total: created.length };
}

/** Generate for every known user (ingest-time fan-out, bounded by rows). */
export function generateAll(now = new Date()) {
  const users = store.all('users').map((u) => u.id);
  const report = { users: users.length, generated: 0, notifications: 0 };
  for (const userId of users) {
    try {
      const r = generateForUser(userId, now);
      report.generated += r.generated.length;
      report.notifications += r.total;
    } catch (e) {
      store.insert('errors', { id: newId('err'), scope: 'notifications', message: String(e?.message ?? e), at: nowIso() });
    }
  }
  return report;
}
