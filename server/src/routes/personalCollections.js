// ---------------------------------------------------------------------------
// PERSONAL COLLECTIONS ROUTES
//
// /api/me/collections*   — authed, owner-scoped CRUD + membership.
// /api/collections/:id   — PUBLIC shareable page (404 for private/unknown).
//
// The public page is the only anonymous surface and it projects strictly
// public objects (publicFeed.publicObject), so nothing private ever crosses
// it — including the very existence of privatised items.
//
// NOTE: this is the USER collections layer. The editorial collections layer
// (home-feed groupings) lives in routes/collections.js + domain/collection.js
// and is untouched.
// ---------------------------------------------------------------------------

import * as collections from '../domain/collections.js';
import { requireAuth } from './helpers.js';
import { emitSignal } from '../domain/signal.js';

function json(res, value) {
  res.json(value);
}

export function register(app) {
  /** The owner's collections (optionally searched by name or item title). */
  app.get('/api/me/collections', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const q = String(req.query.q ?? '').trim().slice(0, 120);
    json(res, { collections: collections.listCollections(me, { q }) });
  });

  /** Create a collection (private by default). */
  app.post('/api/me/collections', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    try {
      const { name, description, coverImage, visibility } = req.body ?? {};
      const c = collections.createCollection(me, { name, description, coverImage, visibility });
      emitSignal({ type: 'collection_created', actorId: me, metadata: { collectionId: c.id, visibility: c.visibility } });
      json(res, { ok: true, collection: c });
    } catch (e) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  /** Owner-only rename / description / cover / visibility. */
  app.patch('/api/me/collections/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    try {
      const c = collections.updateCollection(me, req.params.id, req.body ?? {});
      if (!c) return res.status(404).json({ error: 'collection not found' });
      json(res, { ok: true, collection: c });
    } catch (e) {
      res.status(400).json({ error: String(e.message ?? e) });
    }
  });

  /** Owner-only delete. Objects are never touched. */
  app.delete('/api/me/collections/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    if (!collections.deleteCollection(me, req.params.id)) {
      return res.status(404).json({ error: 'collection not found' });
    }
    json(res, { ok: true });
  });

  /** The owner's full collection view (items resolved live). */
  app.get('/api/me/collections/:id', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const page = collections.collectionForOwner(me, req.params.id);
    if (!page) return res.status(404).json({ error: 'collection not found' });
    emitSignal({ type: 'collection_opened', actorId: me, metadata: { collectionId: page.id } });
    json(res, { collection: page });
  });

  /** Add an object reference. Idempotent; public objects only. */
  app.post('/api/me/collections/:id/items', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const objectId = String(req.body?.objectId ?? '').slice(0, 120);
    if (!objectId) return res.status(400).json({ error: 'objectId is required' });
    const result = collections.addObject(me, req.params.id, objectId);
    if (!result.ok) {
      const status = result.reason === 'object_not_public' ? 400 : 404;
      return res.status(status).json({ error: result.reason });
    }
    json(res, { ok: true, added: result.added, collectionId: result.collection.id });
  });

  /** Remove an object reference (a no-op when not a member). */
  app.delete('/api/me/collections/:id/items/:objectId', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const removed = collections.removeObject(me, req.params.id, req.params.objectId);
    if (removed) {
      emitSignal({ type: 'collection_item_removed', actorId: me, metadata: { collectionId: req.params.id, objectId: req.params.objectId } });
    }
    json(res, { ok: true, removed });
  });

  /** Owner-only reorder: body { objectIds: [...] } sets the new order. */
  app.put('/api/me/collections/:id/items/order', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const objectIds = Array.isArray(req.body?.objectIds)
      ? req.body.objectIds.map((x) => String(x).slice(0, 120))
      : [];
    if (!collections.reorderCollection(me, req.params.id, objectIds)) {
      return res.status(404).json({ error: 'collection not found' });
    }
    json(res, { ok: true });
  });

  /** Share a public collection: emits the share signal, returns the URL. */
  app.post('/api/me/collections/:id/share', (req, res) => {
    const me = requireAuth(req, res);
    if (!me) return;
    const c = collections.collectionForOwner(me, req.params.id);
    if (!c) return res.status(404).json({ error: 'collection not found' });
    if (c.visibility !== 'public') return res.status(400).json({ error: 'collection is not public' });
    let origin;
    try {
      const url = new URL(process.env.BRIEF_PUBLIC_ORIGIN);
      if (url.protocol !== 'https:') throw new Error('https required');
      origin = url.origin;
    } catch {
      return res.status(503).json({ error: 'Public sharing requires BRIEF_PUBLIC_ORIGIN to be configured as HTTPS.' });
    }
    emitSignal({ type: 'collection_shared', actorId: me, metadata: { collectionId: c.id } });
    json(res, { ok: true, url: `${origin}/collections/${encodeURIComponent(c.id)}` });
  });

  /** PUBLIC shareable page — 404 for unknown OR private ids.
   *  /api/collections/:key belongs to the EDITORIAL layer (routes/
   *  collections.js); personal public pages live under /collections/personal/. */
  app.get('/api/collections/personal/:id', (req, res) => {
    const page = collections.collectionPagePublic(String(req.params.id ?? '').slice(0, 120));
    if (!page) return res.status(404).json({ error: 'collection not found' });
    json(res, { collection: page });
  });
}
