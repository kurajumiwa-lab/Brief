// ---------------------------------------------------------------------------
// PERSONAL COLLECTIONS TEST SUITE
//
// Pins the Collections brief: create/rename/delete, save quick-path (existing
// `saves` rows), add/remove/reorder, duplicate prevention, mixed object
// types, private-by-default with owner-only modification, public sharing with
// a stable page containing ONLY public objects, expired items rendered with
// their real status, missing-image covers (never fabricated), ownership
// enforced server-side, authentication, search scoped to the owner, and the
// Personal Brief weak save-type signal (repeated saves only).
//
//   node test/collections.mjs
// ---------------------------------------------------------------------------

import fs from 'node:fs';

process.env.NODE_ENV = 'test';
process.env.BRIEF_DATA_DIR = `/tmp/brief-cols-${process.pid}`;
fs.rmSync(process.env.BRIEF_DATA_DIR, { recursive: true, force: true });

const { store } = await import('../src/store.js');
const collections = await import('../src/domain/collections.js');
const personal = await import('../src/domain/personal.js');
const discovery = await import('../src/domain/discovery.js');

store._reset();

let pass = 0;
let fail = 0;
const check = (name, cond, detail = '') => {
  // A Promise is truthy whatever it resolves to, so an un-awaited condition
  // would print PASS no matter what happened. Refuse it loudly instead.
  if (cond && typeof cond.then === 'function') {
    fail++; console.log(`  FAIL  ${name} -> condition is a Promise; await it before asserting`);
    process.exitCode = 1; return;
  }
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' -> ' + detail : ''}`); process.exitCode = 1; }
};

const now = new Date();
const iso = (d) => d.toISOString();
const isoDays = (days) => {
  const d = new Date(now.getTime() + days * 86400000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const mkSource = (id, name) =>
  store.insert('sources', {
    id, name, type: 'telegram', platform: 'telegram',
    accessType: 'public', connectionStatus: 'connected', enabled: true,
    confidence: 0.9, trustStatus: 'normal',
    createdAt: iso(now), updatedAt: iso(now)
  });

const mkObject = (id, {
  type = 'offer', title = null, area = null, county = null,
  deadlineDays = null, eventDays = null, publication = 'public', image = null
} = {}) => {
  const metadata = {};
  if (area) metadata.area = area;
  if (county) metadata.county = county;
  if (deadlineDays !== null) metadata.deadlineCanonical = isoDays(deadlineDays);
  if (eventDays !== null) metadata.eventStart = `${isoDays(eventDays)}T18:00:00`;
  const t = new Date(now.getTime() - 2 * 3600000).toISOString();
  return store.insert('objects', {
    id, type, title: title ?? `${type} ${id}`, summary: `summary ${id}`,
    category: type, metadata, publication,
    extractionConfidence: 0.9, verificationStatus: 'unverified',
    media: image ? { url: image, alt: null, attribution: null } : null,
    createdAt: t, updatedAt: t, ingestedAt: t
  });
};

// ---------------------------------------------------------------------------
// FIXTURES
// ---------------------------------------------------------------------------
mkSource('src_col_1', 'Kilimani Wire');
const event = mkObject('col_event', { type: 'event', title: 'Weekend Jazz Night', area: 'Kilimani', county: 'Nairobi', eventDays: 3, image: 'https://img.example/jazz.jpg' });
const place = mkObject('col_place', { type: 'place', title: 'Kilimani Studio', area: 'Kilimani', county: 'Nairobi', image: 'https://img.example/studio.jpg' });
const offer = mkObject('col_offer', { type: 'offer', title: 'Studio Hoodie Deal', area: 'Kilimani', county: 'Nairobi', deadlineDays: 7 });
const news = mkObject('col_news', { type: 'news', title: 'Studio Report', area: 'Kilimani', county: 'Nairobi', image: 'https://img.example/report.jpg' });
const expiredOffer = mkObject('col_expired', { type: 'offer', title: 'Old Hoodie Deal', area: 'Kilimani', county: 'Nairobi', deadlineDays: -2, image: 'https://img.example/old.jpg' });
const offer2 = mkObject('col_offer2', { type: 'offer', title: 'Second Hoodie Deal', area: 'Kilimani', county: 'Nairobi', deadlineDays: 9 });
mkObject('col_private', { type: 'event', title: 'Private Party', area: 'Kilimani', county: 'Nairobi', eventDays: 1, publication: 'private' });
mkObject('col_unknown_public', { type: 'place', title: 'Westlands Square', area: 'Westlands', county: 'Nairobi' });

const me = 'usr_collector';
const other = 'usr_other';

// ---------------------------------------------------------------------------
// DOMAIN: CREATE / UPDATE / DELETE
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: CREATE / UPDATE / DELETE ===');
{
  const c = collections.createCollection(me, { name: 'Weekend Plans' });
  check('create defaults to private', c.visibility === 'private', JSON.stringify(c));
  check('create stamps timestamps', Boolean(c.createdAt) && Boolean(c.updatedAt));
  check('collection id is unguessable-prefixed', c.id.startsWith('pcol_'));

  let threw = false;
  try { collections.createCollection(me, { name: '   ' }); } catch { threw = true; }
  check('empty name is rejected', threw);

  threw = false;
  try { collections.createCollection(me, { name: 'weekend plans' }); } catch { threw = true; }
  check('duplicate name (case-insensitive) is rejected', threw);

  const renamed = collections.updateCollection(me, c.id, { name: 'Weekend Ideas', description: 'Things to do', visibility: 'public' });
  check('owner renames + edits + publishes', renamed.name === 'Weekend Ideas' && renamed.description === 'Things to do' && renamed.visibility === 'public');

  check('non-owner cannot update (null)', collections.updateCollection(other, c.id, { name: 'Hijack' }) === null);
  check('non-owner cannot delete', collections.deleteCollection(other, c.id) === false);
  check('owner can delete', collections.deleteCollection(me, c.id) === true);
  check('delete leaves the objects untouched', store.find('objects', (o) => o.id === event.id) !== null);
}

// ---------------------------------------------------------------------------
// DOMAIN: MEMBERSHIP (add / remove / reorder / dedupe / mixed types)
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: MEMBERSHIP ===');
{
  const c = collections.createCollection(me, { name: 'Events' });

  const a1 = collections.addObject(me, c.id, event.id);
  check('add event (mixed types ok)', a1.ok && a1.added === true);
  const a2 = collections.addObject(me, c.id, event.id);
  check('duplicate add is a no-op', a2.ok && a2.added === false);
  collections.addObject(me, c.id, place.id);
  collections.addObject(me, c.id, offer.id);
  collections.addObject(me, c.id, news.id);

  check('add refuses private objects', collections.addObject(me, c.id, 'col_private').reason === 'object_not_public');
  check('add refuses unknown objects', collections.addObject(me, c.id, 'col_nope').reason === 'not_found');
  check('non-owner cannot add', collections.addObject(other, c.id, event.id).ok === false);

  const page = collections.collectionForOwner(me, c.id);
  check('mixed types all render', page.items.length === 4, JSON.stringify(page.items.map((i) => i.object.type)));
  check('item order follows insertion', page.items[0].object.id === event.id);
  check('item carries its public projection', page.items[0].object.title === 'Weekend Jazz Night');
  check('count is real', page.count === 4, `count ${page.count}`);

  collections.reorderCollection(me, c.id, [news.id, offer.id, event.id, place.id]);
  const reordered = collections.collectionForOwner(me, c.id);
  check('reorder applies owner order', reordered.items.map((i) => i.object.id).join(',') === [news.id, offer.id, event.id, place.id].join(','));

  check('remove is owner-only', collections.removeObject(other, c.id, news.id) === false);
  check('remove works for owner', collections.removeObject(me, c.id, news.id) === true);
  check('remove of a non-member is a no-op', collections.removeObject(me, c.id, news.id) === false);
  check('removed item is gone from the page', collections.collectionForOwner(me, c.id).items.length === 3);
}

// ---------------------------------------------------------------------------
// DOMAIN: EXPIRED ITEMS + COVERS + LOCATIONS
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: EXPIRED + COVER + LOCATION ===');
{
  const c = collections.createCollection(me, { name: 'Deals' });
  collections.addObject(me, c.id, offer.id);       // no image
  collections.addObject(me, c.id, expiredOffer.id); // old.jpg
  collections.addObject(me, c.id, event.id);        // jazz.jpg
  const page = collections.collectionForOwner(me, c.id);

  const expiredItem = page.items.find((i) => i.object.id === expiredOffer.id);
  check('expired item still renders (honest, never dropped silently)',
    Boolean(expiredItem), JSON.stringify(page.items.map((i) => i.object.id)));
  check('expired item carries its real temporal status',
    expiredItem?.object?.temporal?.status === 'expired', JSON.stringify(expiredItem?.object?.temporal));

  const cover = page.cover;
  check('cover derives from real item images (mosaic)', cover.kind === 'mosaic' && cover.urls.length === 2, JSON.stringify(cover));

  const noImage = collections.createCollection(me, { name: 'No Pics' });
  collections.addObject(me, noImage.id, offer.id); // offer has no image
  const noImageCover = collections.collectionForOwner(me, noImage.id).cover;
  check('no images -> honest none cover, nothing fabricated', noImageCover.kind === 'none', JSON.stringify(noImageCover));

  const custom = collections.createCollection(me, { name: 'Custom', coverImage: 'https://img.example/custom.jpg' });
  check('custom cover wins', collections.collectionForOwner(me, custom.id).cover.kind === 'custom');

  check('locations come from item fields only', page.locations.areas.includes('Kilimani'), JSON.stringify(page.locations));
}

// ---------------------------------------------------------------------------
// DOMAIN: PRIVACY + PUBLIC PROJECTION
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: PRIVACY + PUBLIC PROJECTION ===');
{
  const c = collections.createCollection(me, { name: 'Public Weekend' });
  collections.addObject(me, c.id, event.id);
  collections.addObject(me, c.id, place.id);
  collections.addObject(me, c.id, expiredOffer.id);
  collections.updateCollection(me, c.id, { visibility: 'public' });

  const pub = collections.collectionPagePublic(c.id);
  check('public page resolves for public collections', pub !== null);
  check('public page projects only public objects', pub.items.length === 3, JSON.stringify(pub.items.map((i) => i.object.id)));
  check('public page keeps expired item with real status',
    pub.items.some((i) => i.object.id === expiredOffer.id && i.object.temporal.status === 'expired'));
  check('public page never serializes the private row', !JSON.stringify(pub).includes('col_private'));

  const hidden = collections.createCollection(me, { name: 'Secret' });
  check('private collection public page is null (cannot be probed)', collections.collectionPagePublic(hidden.id) === null);
  check('unknown id public page is null', collections.collectionPagePublic('pcol_nope') === null);

  // An object that later becomes private drops out of the public rendering
  // without leaking.
  store.update('objects', place.id, { publication: 'private' });
  const after = collections.collectionPagePublic(c.id);
  check('privatised object drops out of public rendering', !after.items.some((i) => i.object.id === place.id));
  check('no private info leaks (title absent)', !JSON.stringify(after).includes('Kilimani Studio'));
  store.update('objects', place.id, { publication: 'public' });
  check('re-public object returns to rendering', collections.collectionPagePublic(c.id).items.length === 3);
}

// ---------------------------------------------------------------------------
// DOMAIN: SEARCH SCOPED TO OWNER + LIST
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: SEARCH + LIST ===');
{
  collections.createCollection(me, { name: 'Job Hunt' });
  const week = collections.createCollection(me, { name: 'Weekend Plans' });
  collections.addObject(me, week.id, event.id);

  const byName = collections.listCollections(me, { q: 'job' });
  check('search matches collection names', byName.length === 1 && byName[0].name === 'Job Hunt', JSON.stringify(byName.map((c) => c.name)));

  const byItem = collections.listCollections(me, { q: 'jazz' });
  // The jazz event lives in several collections above, so every one of them
  // matches — and only the owner's collections are ever searched.
  check('search matches item titles (owner scope)',
    byItem.length >= 3 && byItem.some((c) => c.name === 'Weekend Plans'),
    JSON.stringify(byItem.map((c) => c.name)));

  const all = collections.listCollections(me);
  check('list returns counts + covers + locations', all.every((c) => typeof c.count === 'number' && c.cover && c.locations));
  check('list is most-recently-updated first', all.length >= 2 && all[0].updatedAt >= all[1].updatedAt);

  check('search never leaks to another user', collections.listCollections(other, { q: '' }).length === 0);
}

// ---------------------------------------------------------------------------
// DOMAIN: PERSONAL BRIEF (weak save-type affinity)
// ---------------------------------------------------------------------------
console.log('\n=== DOMAIN: PERSONAL BRIEF (weak save signal) ===');
{
  // One save must NOT create a preference.
  personal.saveObject(me, event.id);
  check('single save creates no type affinity', personal.saveAffinityTypes(me).size === 0);

  personal.saveObject(me, 'col_place');   // place x1
  personal.saveObject(me, 'col_offer');   // offer x1 (expired row still counts as a save)
  const affinity = personal.saveAffinityTypes(me);
  check('no type reaches the threshold at 1 save each', affinity.size === 0, JSON.stringify([...affinity]));

  personal.saveObject(me, offer2.id);     // offer x2 (distinct object)
  personal.saveObject(me, 'col_news');    // news x1
  check('still no affinity at 2 offers', personal.saveAffinityTypes(me).size === 0);

  personal.saveObject(me, 'col_expired'); // offer x3
  const affinity3 = personal.saveAffinityTypes(me);
  check('3 saves of one type create weak affinity', affinity3.has('offer') && affinity3.size === 1, JSON.stringify([...affinity3]));

  const boostPlain = personal.personalBoost(offer, personal.interestsOf(me), personal.relevanceOf(me), null, null);
  const boostAff = personal.personalBoost(offer, personal.interestsOf(me), personal.relevanceOf(me), null, affinity3);
  check('affinity adds a small bounded boost with reason',
    boostAff.boost === boostPlain.boost + 2 && boostAff.reasons.includes('saved_type'), JSON.stringify(boostAff));

  const boostEvent = personal.personalBoost(event, personal.interestsOf(me), personal.relevanceOf(me), null, affinity3);
  check('affinity only touches the saved type (event unaffected)', boostEvent.reasons.includes('saved_type') === false);

  // Unsave everything so the HTTP section starts clean-ish.
  personal.unsaveObject(me, event.id);
  personal.unsaveObject(me, 'col_place');
  personal.unsaveObject(me, 'col_offer');
  personal.unsaveObject(me, offer2.id);
  personal.unsaveObject(me, 'col_news');
  personal.unsaveObject(me, 'col_expired');
  check('cleared saves reset affinity', personal.saveAffinityTypes(me).size === 0);
}

// ---------------------------------------------------------------------------
// ROUTE CONTRACT (HTTP)
// ---------------------------------------------------------------------------
console.log('\n=== ROUTE CONTRACT (HTTP) ===');
{
  process.env.BRIEF_DEV_AUTH = '0';
  process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example';
  const { default: app } = await import('../src/index.js');
  const srv = app.listen(0);
  const port = srv.address().port;
  const call = async (path, method = 'GET', body, token) => {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: body ? JSON.stringify(body) : undefined
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  try {
    const anon = await call('/api/me/collections');
    check('anonymous /api/me/collections is refused', anon.status === 401, `got ${anon.status}`);

    const reg = await call('/api/auth/register', 'POST', { handle: 'col_user', password: 'pw-123456', displayName: 'Col User' });
    check('user registers', reg.status === 201, `got ${reg.status}`);
    const token = reg.body?.token;
    const reg2 = await call('/api/auth/register', 'POST', { handle: 'col_other', password: 'pw-123456', displayName: 'Col Other' });
    const token2 = reg2.body?.token;

    const created = await call('/api/me/collections', 'POST', { name: 'Nairobi Food Spots', description: 'Places to eat' }, token);
    check('create via HTTP', created.status === 200 && created.body.collection.visibility === 'private', `got ${created.status}`);
    const cid = created.body.collection.id;

    const added = await call(`/api/me/collections/${cid}/items`, 'POST', { objectId: event.id }, token);
    check('add item via HTTP', added.status === 200 && added.body.added === true);
    const addedDup = await call(`/api/me/collections/${cid}/items`, 'POST', { objectId: event.id }, token);
    check('duplicate add via HTTP is idempotent', addedDup.body.added === false);
    const badAdd = await call(`/api/me/collections/${cid}/items`, 'POST', { objectId: 'col_private' }, token);
    check('private object add is rejected', badAdd.status === 400);

    const otherAdd = await call(`/api/me/collections/${cid}/items`, 'POST', { objectId: place.id }, token2);
    check('non-owner cannot add to someone else\'s collection', otherAdd.status === 404, `got ${otherAdd.status}`);

    const mine = await call(`/api/me/collections/${cid}`, 'GET', null, token);
    check('owner view carries items + cover', mine.status === 200 && mine.body.collection.items.length === 1 && mine.body.collection.cover.kind === 'single');

    const privPub = await call(`/api/collections/personal/${cid}`);
    check('private collection public page is 404', privPub.status === 404, `got ${privPub.status}`);

    const renamed = await call(`/api/me/collections/${cid}`, 'PATCH', { name: 'Food Spots', visibility: 'public' }, token);
    check('rename + publish via HTTP', renamed.status === 200 && renamed.body.collection.visibility === 'public');

    const shared = await call(`/api/me/collections/${cid}/share`, 'POST', {}, token);
    check('share emits a URL for public collections', shared.status === 200 && typeof shared.body.url === 'string', JSON.stringify(shared.body));
    const sharePrivate = await call(`/api/me/collections/${cid}/share`, 'POST', {}, token2);
    check('non-owner cannot share', sharePrivate.status === 404);

    const pubPage = await call(`/api/collections/personal/${cid}`);
    check('public page is public (200)', pubPage.status === 200, `got ${pubPage.status}`);
    check('public page shows only public items', pubPage.body.collection.items.every((i) => i.object.publication !== 'private') && pubPage.body.collection.items.length === 1);
    check('public page never leaks internal fields', !JSON.stringify(pubPage.body).includes('connectionStatus') && !JSON.stringify(pubPage.body).includes('accessType'));

    const missing = await call('/api/collections/personal/pcol_nope');
    check('unknown public page is 404', missing.status === 404);

    const removed = await call(`/api/me/collections/${cid}/items/${event.id}`, 'DELETE', null, token);
    check('remove item via HTTP', removed.status === 200 && removed.body.removed === true);
    const empty = await call(`/api/collections/personal/${cid}`);
    check('public page reflects removal', empty.body.collection.items.length === 0);

    const del = await call(`/api/me/collections/${cid}`, 'DELETE', null, token);
    check('delete via HTTP', del.status === 200 && del.body.ok === true);
    const gone = await call(`/api/me/collections/${cid}`, 'GET', null, token);
    check('deleted collection is gone for the owner', gone.status === 404);
    const gonePub = await call(`/api/collections/personal/${cid}`);
    check('deleted collection public page is 404', gonePub.status === 404);

    const listed = await call('/api/me/collections?q=Food', 'GET', null, token);
    check('search scoped to owner works over HTTP', listed.status === 200 && Array.isArray(listed.body.collections));

    srv.close();
  } catch (e) {
    srv.close();
    throw e;
  }
}

console.log(`\n${'='.repeat(52)}\nPASSED ${pass}   FAILED ${fail}\n${'='.repeat(52)}`);
process.exit(fail ? 1 : 0);
