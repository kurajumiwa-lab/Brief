const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
const q = require('./src/api/offlineQueue.ts');
const api = require('./src/api/briefApi.ts');
const reply = (body, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) });
let offline = false, calls = [];
global.fetch = async (url, init = {}) => {
  if (String(url).includes('/api/auth/me')) {
    const token = init.headers?.authorization?.split(' ')[1];
    return token ? reply({ user: { id: token === 'token-A' ? 'A' : 'B', handle: 'member' } }) : reply({ error: 'login required' }, 401);
  }
  if (offline) throw new TypeError('network offline');
  calls.push({ url: String(url), authorization: init.headers?.authorization, body: init.body });
  return reply({ sale: { id: 's1' }, replayed: false });
};
let checks = 0;
const test = async (name, fn) => { await fn(); checks++; console.log('PASS ' + name); };
const sale = (name) => api.logShopSale({ name, qty: 1, unitKes: 10, clientKey: name });
(async () => {
  api.setSessionToken('token-A');
  assert.equal((await api.whoAmI()).data.id, 'A');
  offline = true;
  assert.equal((await sale('A-first')).queued, true);
  await test('A queues with stable verified account and without serialized bearer', () => {
    const [w] = JSON.parse(localStorage.getItem('brief.offlineQueue.v1'));
    assert.equal(w.accountId, 'A'); assert.equal(w.headers, undefined);
  });
  api.setSessionToken('token-B');
  await api.whoAmI();
  offline = false;
  await api.flushOfflineQueue();
  await test('B cannot replay an A write', () => {
    assert.equal(calls.length, 0); assert.equal(api.offlineQueueBlockedDepth(), 1);
  });
  offline = true;
  assert.equal((await sale('B-first')).queued, true);
  offline = false;
  await api.flushOfflineQueue();
  await test('B sends only B and A remains intact', () => {
    assert.deepEqual(calls.map(c => JSON.parse(c.body).name), ['B-first']);
    assert.equal(calls[0].authorization, 'Bearer token-B');
    assert.equal(q.queueDepth(), 1);
  });
  api.setSessionToken(null);
  offline = true;
  const anonymous = await sale('anonymous');
  await test('anonymous writes cannot silently move to the next login', () => {
    assert.equal(anonymous.queued, undefined);
    assert.match(anonymous.error, /Sign in/);
    assert.equal(q.queueDepth(), 1);
  });
  api.setSessionToken('token-A');
  offline = false;
  await api.whoAmI();
  await api.flushOfflineQueue();
  await test('signing back into A safely drains only A', () => {
    assert.deepEqual(calls.map(c => JSON.parse(c.body).name), ['B-first', 'A-first']);
    assert.equal(calls[1].authorization, 'Bearer token-A');
    assert.equal(q.queueDepth(), 0);
  });
  q.enqueue({ path: '/api/test', method: 'POST', accountId: 'A', body: '{"n":1}', clientKey: 'race1' });
  q.enqueue({ path: '/api/test', method: 'POST', accountId: 'B', body: '{"n":2}', clientKey: 'raceB' });
  await q.replayQueue(async (w) => {
    q.enqueue({ path: '/api/test', method: 'POST', accountId: 'A', body: '{"n":3}', clientKey: 'race3' });
    return { ok: true };
  }, 'A');
  await test('concurrent enqueue survives replay and B queue stays untouched', () => {
    const rows = JSON.parse(localStorage.getItem('brief.offlineQueue.v1'));
    assert.equal(rows.filter(w => w.accountId === 'B').length, 1);
    assert.equal(rows.filter(w => w.accountId === 'A').length, 1);
    assert.ok(rows.some(w => w.clientKey === 'race3'));
  });
  localStorage.setItem('brief.offlineQueue.v1', JSON.stringify([{ id: 'old', path: '/api/test', method: 'POST', body: '{}', headers: { authorization: 'Bearer old' } }]));
  const oldCalls = calls.length;
  await api.flushOfflineQueue();
  await test('legacy unbound entries are quarantined, never replayed', () => {
    assert.equal(calls.length, oldCalls); assert.equal(api.offlineQueueBlockedDepth(), 1);
  });
  const originalStorage = global.localStorage;
  global.localStorage = { getItem: k => originalStorage.getItem(k), setItem: () => { throw new Error('storage full'); } };
  offline = true;
  const refused = await sale('not-saved');
  await test('storage failure never claims a change is queued', () => {
    assert.equal(refused.queued, undefined); assert.match(refused.error, /storage full/);
  });
  global.localStorage = originalStorage;
  console.log(`PASSED ${checks} FAILED 0`);
})().catch(e => { console.error(e); process.exitCode = 1; });
