import './test-env.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
process.env.BRIEF_DEV_AUTH = '0';
const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const vendor = await import('../src/domain/vendor.js');
const listing = await import('../src/domain/listing.js');
const spaces = await import('../src/domain/space.js');
const wf = await import('../src/domain/workforce.js');
const work = await import('../src/domain/workExecution.js');
const feed = await import('../src/domain/businessFeed.js');
const supply = await import('../src/domain/supply.js');
const requests = await import('../src/domain/requests.js');
const { default: app } = await import('../src/index.js');
store._reset();
const user = (handle) =>
  auth.createUser({ handle, password: 'feed-test-password' });
const owner = user('feed_owner'),
  reader = user('feed_reader'),
  stranger = user('feed_stranger'),
  supplier = user('feed_supplier');
const vend = vendor.createVendor({
  ownerId: owner.id,
  displayName: 'Actual software studio',
  contactMethod: 'PRIVATE_CONTACT'
});
function offer(title, extra = {}) {
  const l = listing.createListing({
    vendorId: vend.id,
    title,
    description: 'Real software with setup support for sales and invoicing.',
    type: 'product',
    price: 2000,
    locationName: 'Nairobi',
    ...extra
  });
  listing.transitionListing(l.id, 'active');
  return l;
}
const tool = offer('Restaurant CRM software'),
  tool2 = offer('Inventory software', { price: 3000 }),
  service = offer('Bookkeeping setup', {
    type: 'service',
    currency: 'USD',
    price: 50
  }),
  bulk = offer('Bulk software licences', { price: 1000, minOrderQuantity: 10 });
const privateSpace = spaces.createSpace({
  ownerId: owner.id,
  name: 'Private business',
  type: 'business',
  visibility: 'private'
});
const secretOffer = spaces.createSpaceOffer(privateSpace.id, {
  callerId: owner.id,
  title: 'SECRET_PRIVATE_OFFER',
  price: 20
});
spaces.publishSpaceOffer(privateSpace.id, secretOffer.id, {
  callerId: owner.id
});
const force = wf.createWorkforce(owner.id, { name: 'Real execution team' });
const tomorrow = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
function program(title, audience = 'network', target = 10) {
  let p = work.createProgram(force.id, owner.id, {
    title,
    objective: 'Run a consent-based calling pilot',
    templateKey: 'lead_calling',
    audience,
    target,
    unitPriceKes: 300,
    deadline: tomorrow
  });
  return work.changeProgramStatus(p.id, owner.id, {
    action: 'publish',
    revision: p.revision
  });
}
const network = program('Outreach pilot'),
  privateProgram = program('PRIVATE_MEMBER_PROGRAM', 'workforce'),
  single = program('One calling task', 'network', 1);
const enterprise = supply.createEnterprise(supplier.id, {
  displayName: 'Paper bag supplier',
  businessType: 'manufacturer',
  supplyRole: 'direct_supplier',
  location: 'Nairobi',
  serviceAreas: ['Nairobi'],
  publication: 'public',
  firstCapability: {
    name: 'Paper takeaway bags',
    category: 'Packaging',
    productsServices: ['Paper bags'],
    minimumQuantity: 100,
    maximumQuantity: 50000,
    typicalCapacity: 20000,
    unit: 'pieces',
    capacityKind: 'production',
    leadTime: { minDays: 2, maxDays: 4 },
    serviceAreas: ['Nairobi']
  }
});
let demand = requests.createRequest(reader.id, {
  title: 'Need printed paper bags',
  description: 'PRIVATE_INTERNAL_DESCRIPTION with customer contacts',
  quantity: 5000,
  unit: 'pieces',
  category: 'Packaging',
  location: 'Nairobi',
  requiredBy: tomorrow,
  budgetMax: 987654,
  specifications: { otherNotes: 'PRIVATE_SPEC' },
  visibility: 'public',
  intent: 'submit'
});
demand = requests.changeRequestStatus(reader.id, demand.id, {
  status: 'matching',
  revision: demand.revision
});
const economicNames = [
  'ledgerTransactions',
  'orders',
  'workTasks',
  'workUnits',
  'workOrders',
  'requests',
  'matches'
];
const economicSnapshot = () =>
  JSON.stringify(
    Object.fromEntries(economicNames.map((k) => [k, store.all(k)]))
  );
const ledgerBefore = JSON.stringify(store.all('ledgerTransactions'));
const token = auth.issueSession(reader.id).token;
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const call = async (path = '', method = 'GET', body, session) => {
  const r = await fetch(
    `http://127.0.0.1:${server.address().port}/api/discover/business${path}`,
    {
      method,
      headers: {
        'content-type': 'application/json',
        ...(session ? { authorization: `Bearer ${session}` } : {})
      },
      ...(body ? { body: JSON.stringify(body) } : {})
    }
  );
  return { status: r.status, body: await r.json(), headers: r.headers };
};
let count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log('PASS ' + name);
};
const key = `listing:${tool.id}`;
try {
  await test('anonymous feed is public, no-store, useful but never seeded with invented customers', async () => {
    const r = await call();
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.body.authenticated, false);
    assert.equal(r.body.items.filter((c) => c.kind === 'playbook').length, 4);
    assert.ok(r.body.items.some((c) => c.key === key));
    assert.ok(!JSON.stringify(r.body).includes('PRIVATE_'));
    assert.equal(store.all('businessFeedStates').length, 0);
  });
  await test('listing projection redacts owner/contact data and shares the reviews privacy boundary', () => {
    const c = feed.feed(null).items.find((c) => c.key === key);
    assert.equal(c.source, vend.displayName);
    assert.equal(c.reviews.count, 0);
    assert.equal(c.kind, 'tool');
    assert.equal(c.price, 'KES 2,000');
    assert.ok(!JSON.stringify(c).includes(owner.id));
    assert.ok(!JSON.stringify(c).includes('PRIVATE_CONTACT'));
    store.update('vendors', vend.id, {
      enterprise: { publication: 'private', operatingStatus: 'active' }
    });
    assert.ok(!feed.feed(null).items.some((c) => c.key === key));
    store.update('vendors', vend.id, { enterprise: null });
  });
  await test('workforce-only programs never leak to strangers, anonymous shares or spoofed actor queries', async () => {
    const a = await call(
      `?userId=${reader.id}&card=program:${privateProgram.id}`
    );
    assert.equal(a.body.focus, null);
    assert.equal(a.body.focusUnavailable, true);
    assert.ok(!JSON.stringify(a.body).includes('PRIVATE_MEMBER_PROGRAM'));
    assert.ok(
      !feed
        .feed(reader.id)
        .items.some((c) => c.key === `program:${privateProgram.id}`)
    );
    wf.joinByCode(reader.id, force.joinCode);
    const cards = feed.feed(reader.id).items;
    assert.ok(cards.some((c) => c.key === `program:${privateProgram.id}`));
    assert.ok(
      !JSON.stringify(feed.feed(stranger.id)).includes('PRIVATE_MEMBER_PROGRAM')
    );
  });
  await test('work cards use original offered step fees and state eligibility; HOME does not require GPS', () => {
    const c = feed
      .feed(reader.id)
      .items.find((c) => c.key === `program:${network.id}`);
    assert.equal(c.price, 'KES 240');
    assert.equal(c.work.mode, 'home');
    assert.equal(c.work.remaining, 10);
    assert.ok(c.blockers.includes('Set up your worker profile'));
    assert.ok(!c.blockers.join().includes('GPS'));
    assert.match(c.href, /workforce\/program/);
    assert.ok(
      feed
        .feed(reader.id)
        .items.some(
          (c) => c.key === `program:${single.id}` && c.kind === 'task'
        )
    );
  });
  await test('expired and closed programs disappear without a read mutating work', () => {
    const before = economicSnapshot();
    feed.feed(reader.id);
    assert.equal(economicSnapshot(), before);
    store.update('workPrograms', single.id, { deadline: '2020-01-01' });
    assert.ok(
      !feed.feed(reader.id).items.some((c) => c.key === `program:${single.id}`)
    );
    store.update('workPrograms', single.id, {
      deadline: tomorrow,
      status: 'closed'
    });
    assert.ok(
      !feed.feed(reader.id).items.some((c) => c.key === `program:${single.id}`)
    );
  });
  await test('matched business briefs retain canonical scoped visibility and never project private descriptions/budgets', () => {
    const r = feed.feed(supplier.id, { kind: 'request' });
    assert.ok(
      r.items.length > 0,
      'real matching fixture must produce a scoped brief'
    );
    assert.equal(feed.feed(stranger.id, { kind: 'request' }).total, 0);
    assert.equal(feed.feed(null, { kind: 'request' }).total, 0);
    assert.ok(!JSON.stringify(r).includes('PRIVATE_INTERNAL_DESCRIPTION'));
    assert.ok(!JSON.stringify(r).includes('987654'));
    assert.ok(!JSON.stringify(r).includes('PRIVATE_SPEC'));
    assert.equal(r.items[0].scope, 'private');
    assert.match(r.items[0].href, /supply\/mine\?match=/);
  });
  await test('all preference/actions require authentication and reject forged identity or malformed controls', async () => {
    assert.equal(
      (await call('/actions', 'POST', { key, action: 'save', value: true }))
        .status,
      401
    );
    assert.equal(
      (
        await call(
          '/preferences',
          'PUT',
          { topic: 'software', userId: stranger.id },
          token
        )
      ).status,
      400
    );
    assert.equal(
      (await call('/preferences', 'PUT', { budget: true }, token)).status,
      400
    );
    assert.equal(
      (await call('/preferences', 'PUT', { budget: -1 }, token)).status,
      400
    );
    assert.equal(
      (
        await call(
          '/actions',
          'POST',
          { key, action: 'save', value: 'true' },
          token
        )
      ).status,
      400
    );
  });
  await test('save is idempotent, account-private, removable and survives a process restart', async () => {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await call(
            '/actions',
            'POST',
            { key, action: 'save', value: true },
            token
          )
        ).status,
        200
      );
    assert.equal(feed.feed(reader.id, { tab: 'saved' }).total, 1);
    assert.equal(feed.feed(stranger.id, { tab: 'saved' }).total, 0);
    // A FRESH PROCESS, because a cached module would prove nothing about what
    // was actually persisted. The specifier is an absolute file URL resolved
    // from THIS file's location, not from the working directory: the previous
    // root-relative path only worked when the suite happened to be launched
    // from the repo root, and `npm test` runs with cwd=server/, so it asked for
    // server/server/src/... and died — which stopped the whole chain here and
    // silently stranded every suite after it.
    const domain = new URL('../src/domain/businessFeed.js', import.meta.url).href;
    const result = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `const {feed}=await import(${JSON.stringify(domain)}); console.log(feed(${JSON.stringify(reader.id)},{tab:'saved'}).total);`
      ],
      { env: process.env, encoding: 'utf8' }
    );
    assert.equal(result.trim(), '1');
  });
  await test('only publication visibility governs saved/shared cards, so privatizing revokes read access', () => {
    store.update('listings', tool.id, { status: 'paused' });
    assert.equal(feed.feed(reader.id, { tab: 'saved' }).total, 0);
    assert.equal(feed.feed(reader.id, { card: key }).focusUnavailable, true);
    feed.act(reader.id, { key, action: 'save', value: false });
    store.update('listings', tool.id, { status: 'active' });
    assert.equal(feed.feed(reader.id, { tab: 'saved' }).total, 0);
  });
  await test('provider follows are idempotent and the following view uses only visible source records', () => {
    feed.act(reader.id, { key, action: 'follow', value: true });
    feed.act(reader.id, { key, action: 'follow', value: true });
    assert.equal(feed.preferences(reader.id).followingCount, 1);
    const rows = feed.feed(reader.id, { tab: 'following' }).items;
    assert.equal(rows.length, 4);
    assert.ok(rows.every((c) => c.vendorId === vend.id));
    assert.ok(
      rows.find((c) => c.key === key).reasons.some((r) => r.points === 6)
    );
    assert.throws(() =>
      feed.act(reader.id, {
        key: 'playbook:choose-software',
        action: 'follow',
        value: true
      })
    );
  });
  await test('ranking weights explain declared preferences without inferring currency conversions or bulk affordability', () => {
    feed.updatePreferences(reader.id, {
      topic: 'software',
      location: 'Nairobi',
      budget: 2500,
      stage: 'starting'
    });
    const rows = feed.feed(reader.id).items;
    const c = rows.find((c) => c.key === key);
    assert.ok(c.reasons.some((r) => r.points === 5));
    assert.ok(c.reasons.some((r) => r.points === 3));
    assert.ok(
      c.reasons.some(
        (r) => r.label.includes('minimum') || r.label.includes('Minimum')
      )
    );
    for (const id of [bulk.id, service.id])
      assert.ok(
        !rows
          .find((c) => c.key === `listing:${id}`)
          .reasons.some((r) => r.label.includes('spend'))
      );
    assert.ok(!c.reasons.some((r) => r.label.includes('stage')));
  });
  await test('guest tuning is ephemeral and does not read or overwrite another account', async () => {
    const before = JSON.stringify(store.all('businessFeedStates'));
    const r = await call('?topic=finance&location=Kisumu&budget=400');
    assert.equal(r.body.applied.topic, 'finance');
    assert.equal(r.body.preferences.topic, '');
    assert.equal(JSON.stringify(store.all('businessFeedStates')), before);
  });
  await test('history is opt-in, bounded and deduplicated; turning it off erases it', () => {
    feed.act(reader.id, { key, action: 'open' });
    assert.equal(feed.preferences(reader.id).activityCount, 0);
    feed.updatePreferences(reader.id, { rememberActivity: true });
    feed.act(reader.id, { key, action: 'open' });
    feed.act(reader.id, { key, action: 'open' });
    feed.act(reader.id, { key, action: 'share' });
    assert.equal(feed.preferences(reader.id).activityCount, 2);
    assert.ok(
      feed
        .feed(reader.id)
        .items.find((c) => c.key === key)
        .reasons.some((r) => r.points === 1)
    );
    feed.updatePreferences(reader.id, { rememberActivity: false });
    assert.equal(feed.preferences(reader.id).activityCount, 0);
  });
  await test('private program shares are refused and invisible cards cannot be acted on by other accounts', () => {
    assert.throws(
      () =>
        feed.act(reader.id, { key: `program:${network.id}`, action: 'share' }),
      (e) => e.status === 403
    );
    assert.throws(
      () =>
        feed.act(stranger.id, {
          key: `program:${privateProgram.id}`,
          action: 'save',
          value: true
        }),
      (e) => e.status === 404
    );
  });
  await test('hidden cards leave the feed but saved references survive; reset restores hidden cards', () => {
    feed.act(reader.id, { key, action: 'save', value: true });
    feed.act(reader.id, { key, action: 'hide', value: true });
    assert.ok(!feed.feed(reader.id).items.some((c) => c.key === key));
    assert.equal(feed.feed(reader.id, { tab: 'saved' }).items[0].hidden, true);
    feed.reset(reader.id, 'hidden');
    assert.ok(feed.feed(reader.id).items.some((c) => c.key === key));
  });
  await test('repeat saves are a bounded format preference, not a fabricated trust score', () => {
    feed.act(reader.id, {
      key: `listing:${tool2.id}`,
      action: 'save',
      value: true
    });
    const c = feed.feed(reader.id).items.find((c) => c.key === key);
    assert.equal(
      c.reasons.filter((r) => r.label.includes('two cards')).length,
      1
    );
    assert.equal(
      c.reasons.find((r) => r.label.includes('two cards')).points,
      2
    );
  });
  await test('review counts and average come only from published reviews and do not affect ranking', () => {
    store.insert('productReviews', {
      id: 'test_r1',
      listingId: tool.id,
      status: 'published',
      rating: 2
    });
    store.insert('productReviews', {
      id: 'test_r2',
      listingId: tool.id,
      status: 'published',
      rating: 5
    });
    store.insert('productReviews', {
      id: 'test_r3',
      listingId: tool.id,
      status: 'hidden',
      rating: 5
    });
    const c = feed.feed(null).items.find((c) => c.key === key);
    assert.equal(c.reviews.average, 3.5);
    assert.equal(c.reviews.count, 2);
    assert.ok(!c.reasons.some((r) => /review/.test(r.label)));
  });
  await test('search and typed filters, deterministic diverse pages, and newest preserve truthful ranges', () => {
    for (let i = 0; i < 15; i++)
      offer(`Pagination software ${String(i).padStart(2, '0')}`);
    const a = feed.feed(null, { q: 'Pagination', kind: 'tool', page: 1 }),
      b = feed.feed(null, { q: 'Pagination', kind: 'tool', page: 2 });
    assert.equal(a.total, 15);
    assert.equal(a.items.length, 12);
    assert.equal(b.items.length, 3);
    assert.equal(new Set([...a.items, ...b.items].map((c) => c.key)).size, 15);
    assert.deepEqual(
      a.items.map((c) => c.key),
      feed
        .feed(null, { q: 'Pagination', kind: 'tool', page: 1 })
        .items.map((c) => c.key)
    );
    const mixed = feed.feed(null).items;
    assert.notEqual(mixed[2].kind, mixed[0].kind);
    assert.equal(feed.feed(null, { q: 'nomatchhere' }).total, 0);
    assert.equal(feed.feed(null, { sort: 'latest' }).items[0].kind, 'tool');
  });
  await test('reset erases discovery state only, not business records or money', () => {
    const before = economicSnapshot();
    feed.reset(reader.id, 'all');
    assert.equal(feed.feed(reader.id, { tab: 'saved' }).total, 0);
    assert.equal(feed.preferences(reader.id).followingCount, 0);
    assert.equal(feed.preferences(reader.id).topic, '');
    assert.equal(economicSnapshot(), before);
    assert.equal(JSON.stringify(store.all('ledgerTransactions')), ledgerBefore);
  });
  await test('feature disables gate the endpoint and suppress independently disabled sources', async () => {
    process.env.BRIEF_DISABLED_FEATURES = 'commerce,workforce,request_matching';
    const r = await call('', 'GET', undefined, token);
    assert.equal(r.status, 200);
    assert.ok(r.body.items.every((c) => c.kind === 'playbook'));
    process.env.BRIEF_DISABLED_FEATURES = 'feed';
    assert.equal((await call()).status, 503);
    assert.equal(
      (
        await call(
          '/actions',
          'POST',
          { key, action: 'save', value: true },
          token
        )
      ).status,
      503
    );
    delete process.env.BRIEF_DISABLED_FEATURES;
  });
  console.log(`\n${count} business feed checks passed`);
} finally {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  fs.rmSync(process.env.BRIEF_DATA_DIR, { recursive: true, force: true });
}
