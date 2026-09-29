import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

process.env.NODE_ENV = 'test';
process.env.BRIEF_DEV_AUTH = '0';
process.env.BRIEF_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-safety-'));
const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const email = await import('../src/domain/emailAuth.js');
const federated = await import('../src/domain/federated.js');
const vendors = await import('../src/domain/vendor.js');
const listings = await import('../src/domain/listing.js');
const orders = await import('../src/domain/order.js');
const { limitAuth } = await import('../src/routes/authLimits.js');
const { default: app } = await import('../src/index.js');
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS ' + name); };
const nativeFetch = globalThis.fetch;
const server = app.listen(0, '127.0.0.1');
await new Promise(resolve => server.once('listening', resolve));
const url = (p) => `http://127.0.0.1:${server.address().port}${p}`;
const post = async (p, body, token) => {
  const r = await nativeFetch(url(p), { method: 'POST', headers: {
    'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, data: await r.json() };
};

try {
  store._reset();
  const a = auth.createUser({ handle: 'safety_a', password: 'a good passphrase' });
  const b = auth.signInWithVerifiedIdentity({ provider: 'google', email: 'b@example.test', subject: 'verified-b' }).user;
  const aSession = auth.issueSession(a.id).token;
  process.env.BRIEF_PUBLIC_ORIGIN = 'https://brief.example';
  process.env.RESEND_API_KEY = 'fixture-not-a-real-key';
  process.env.BRIEF_EMAIL_FROM = 'Brief <sign-in@example.test>';
  const delivered = [];
  globalThis.fetch = async (input, init) => {
    if (String(input) !== 'https://api.resend.com/emails') throw new Error('unexpected external fetch');
    delivered.push(JSON.parse(init.body));
    return { ok: true };
  };
  const request = await post('/api/auth/email-link/request', { email: b.email }, aSession);
  check('A receives no credential for B after requesting B email', () => {
    assert.equal(request.status, 200);
    assert.equal(request.data.token, undefined);
    assert.equal(request.data.email, undefined);
    assert.equal(delivered.length, 1);
    assert.deepEqual(delivered[0].to, [b.email]);
  });
  const link = delivered[0].text.match(/https:\/\/\S+/)[0];
  const proof = new URL(link).searchParams.get('bt');
  check('legacy forged/member-minted links are revoked', () => {
    assert.throws(() => federated.mintEmailLinkToken(b.email));
    assert.equal(federated.redeemEmailLinkToken(link).ok, false);
  });
  const formerMint = await post('/api/auth/email-link/mint', { email: b.email }, aSession);
  check('legacy HTTP mint is gone', () => assert.equal(formerMint.status, 410));
  const altered = proof[0] === 'A' ? `B${proof.slice(1)}` : `A${proof.slice(1)}`;
  const bad = await post('/api/auth/email-link', { token: altered });
  check('modified credential cannot target another account', () => assert.equal(bad.status, 401));
  const success = await post('/api/auth/email-link', { token: proof });
  check('mailbox proof logs in its existing owner', () => {
    assert.equal(success.status, 200);
    assert.equal(success.data.user.id, b.id);
    assert.ok(auth.resolveSession(success.data.token).ok);
  });
  const used = await post('/api/auth/email-link', { token: proof });
  check('proof is single-use', () => assert.equal(used.status, 401));
  const other = await post('/api/auth/email-link/request', { email: 'new@example.test' });
  check('new and existing accounts have indistinguishable request responses', () => {
    assert.equal(other.status, 200);
    assert.deepEqual(other.data, request.data);
  });
  const newProof = new URL(delivered[1].text.match(/https:\/\/\S+/)[0]).searchParams.get('bt');
  const created = await post('/api/auth/email-link', { token: newProof });
  check('delivered proof can create a new verified account', () => {
    assert.equal(created.status, 201);
    assert.equal(created.data.user.email, 'new@example.test');
  });
  let expired;
  await email.requestEmailSignIn('expires@example.test', { now: Date.now() - email.EMAIL_LINK_TTL_MS - 1,
    deliver: async ({ token }) => { expired = token; return true; } });
  check('expired credentials are refused', () => assert.equal(email.redeemEmailSignIn(expired).ok, false));
  const wrongPurpose = crypto.randomBytes(32).toString('base64url');
  store.insert('emailChallenges', { id: 'wrong_purpose', fingerprint: crypto.createHash('sha256').update(wrongPurpose).digest('hex'),
    email: b.email, purpose: 'invite', expiresAt: Date.now() + 10000, usedAt: null });
  check('a proof for another purpose cannot create a session', () => assert.equal(email.redeemEmailSignIn(wrongPurpose).ok, false));
  check('only hashed credentials are stored', () => assert.equal(JSON.stringify(store.all('emailChallenges')).includes(newProof), false));
  check('rate control bounds attempts and supplies Retry-After', () => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; },
      status(n) { this.statusCode = n; return this; }, json() { return this; } };
    const req = { ip: '192.0.2.251' };
    assert.equal(limitAuth(req, res, 'fixture-attempt', 2), true);
    assert.equal(limitAuth(req, res, 'fixture-attempt', 2), true);
    assert.equal(limitAuth(req, res, 'fixture-attempt', 2), false);
    assert.equal(res.statusCode, 429); assert.ok(Number(res.headers['Retry-After']) > 0);
  });
  check('development identity is impossible in production', () => {
    process.env.NODE_ENV = 'production'; process.env.BRIEF_DEV_AUTH = '1';
    assert.equal(auth.devAuthAllowed(), false);
    process.env.NODE_ENV = 'test'; process.env.BRIEF_DEV_AUTH = '0';
    const child = spawnSync(process.execPath, ['src/index.js'], { cwd: path.resolve(new URL('../', import.meta.url).pathname),
      env: { ...process.env, NODE_ENV: 'production', BRIEF_DEV_AUTH: '1', BRIEF_DATA_DIR: process.env.BRIEF_DATA_DIR }, encoding: 'utf8' });
    assert.notEqual(child.status, 0); assert.match(child.stderr, /forbidden in production/);
  });

  const collections = await import('../src/domain/collections.js');
  const collection = collections.createCollection(a.id, { name: 'Public shelf', visibility: 'public' });
  const shared = await post(`/api/me/collections/${collection.id}/share`, {}, aSession);
  check('collection share uses the documented public origin', () =>
    assert.equal(shared.data.url, `https://brief.example/collections/${collection.id}`));
  const publicRead = await nativeFetch(url(`/api/collections/personal/${collection.id}`));
  check('shared collection has an anonymous public API projection', () => assert.equal(publicRead.status, 200));
  const builtIndex = path.resolve(new URL('../../preview/dist/index.html', import.meta.url).pathname);
  if (fs.existsSync(builtIndex)) {
    const publicPage = await nativeFetch(url(`/collections/${collection.id}`));
    check('compiled production entry serves the shared collection path', () =>
      assert.equal(publicPage.status, 200));
    // The three-pillar concept surface is public too, and its link preview must
    // say it is a concept rather than a live network.
    const pillars = await nativeFetch(url('/pillars'));
    const pillarsHtml = await pillars.text();
    check('the three-pillar concept route serves with an honest title', () => {
      assert.equal(pillars.status, 200);
      assert.match(pillarsHtml, /<title>Brief Trade[\s\S]*?<\/title>/);
      assert.match(pillarsHtml, /Concept preview/);
      assert.doesNotMatch(pillarsHtml, /<title>Wairo Blue Avenue<\/title>/);
    });
  } else console.log('SKIP compiled collection HTML: build client first');

  // Every economic failure must leave the same order, listing, log, and
  // derived totals as before. The transaction persists exactly once on success.
  const vendor = vendors.createVendor({ ownerId: a.id, displayName: 'Test stall' });
  const offer = listings.createListing({ vendorId: vendor.id, title: 'Test rice', price: 50, quantityAvailable: 8 });
  listings.transitionListing(offer.id, 'active');
  const start = () => ({ orders: store.filter('orders', x => x.listingId === offer.id).map(x => x.total),
    stock: store.find('listings', x => x.id === offer.id).quantityAvailable,
    history: store.filter('stockChanges', x => x.listingId === offer.id).length });
  const before = start();
  const purchase = () => orders.createOrder({ listingId: offer.id, buyerId: b.id, quantity: 2 });
  for (const [name, owner, method, failWhen] of [
    ['order write', store, 'insert', (collection) => collection === 'orders'],
    ['stock decrement', store, 'update', (collection) => collection === 'listings'],
    ['stock-history write', store, 'insert', (collection) => collection === 'stockChanges'],
    ['final file persistence', fs, 'writeFileSync', (file) => String(file).endsWith('.tmp')]
  ]) {
    const original = owner[method];
    owner[method] = function (...args) { if (failWhen(...args)) throw new Error('injected failure'); return original.apply(this, args); };
    try { assert.throws(purchase, /injected failure/); }
    finally { owner[method] = original; }
    check(`${name} rolls back order, stock, history and totals`, () => {
      assert.deepEqual(start(), before);
      const disk = JSON.parse(fs.readFileSync(store._file, 'utf8'));
      assert.equal(disk.orders.filter(x => x.listingId === offer.id).length, before.orders.length);
      assert.equal(disk.listings.find(x => x.id === offer.id).quantityAvailable, before.stock);
    });
  }
  const saved = purchase();
  check('successful purchase commits consistent order and shelf history', () => {
    assert.equal(saved.total, 100);
    assert.deepEqual(start(), { orders: [100], stock: 6, history: 1 });
    assert.equal(store.filter('stockChanges', x => x.listingId === offer.id)[0].orderId, saved.id);
  });
  store.insert('objects', { id: 'retain-on-error' });
  const diskBeforeRemove = fs.readFileSync(store._file, 'utf8');
  const write = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) { if (String(file).endsWith('.tmp')) throw new Error('disk failure'); return write.call(this, file, ...args); };
  try { assert.throws(() => store.remove('objects', 'retain-on-error'), /disk failure/); }
  finally { fs.writeFileSync = write; }
  check('failed deletion restores memory and leaves disk unchanged', () => {
    assert.ok(store.find('objects', x => x.id === 'retain-on-error'));
    assert.equal(fs.readFileSync(store._file, 'utf8'), diskBeforeRemove);
  });

  // Restart in separate processes: no test-only in-memory reload can fake it.
  const snapshot = fs.readFileSync(store._file, 'utf8');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-recovery-'));
  const boot = (dir) => spawnSync(process.execPath, ['--input-type=module', '-e', `
    const { store } = await import('./src/store.js');
    const before = store.all('users').length;
    store.insert('objects', { id: 'after-restart' });
    process.stdout.write(JSON.stringify({ before, after: store.all('users').length, restored: store.recovery.restored }));
  `], { cwd: path.resolve(new URL('../', import.meta.url).pathname), env: { ...process.env, BRIEF_DATA_DIR: dir, NODE_ENV: 'test', BRIEF_DEV_AUTH: '0' }, encoding: 'utf8' });
  for (const kind of ['missing', 'empty', 'corrupt']) {
    const dir = fs.mkdtempSync(path.join(dataDir, `${kind}-`));
    fs.mkdirSync(path.join(dir, 'backups'));
    fs.writeFileSync(path.join(dir, 'backups', 'brief-2026-09-28.json'), snapshot);
    if (kind === 'empty') fs.writeFileSync(path.join(dir, 'brief.json'), '{}');
    if (kind === 'corrupt') fs.writeFileSync(path.join(dir, 'brief.json'), '{invalid');
    const result = boot(dir);
    check(`${kind} primary restores live rows before the next write`, () => {
      assert.equal(result.status, 0, result.stderr);
      const body = JSON.parse(result.stdout.trim().split('\n').at(-1));
      assert.ok(body.before >= 2); assert.equal(body.after, body.before);
      assert.equal(body.restored, true);
      const disk = JSON.parse(fs.readFileSync(path.join(dir, 'brief.json'), 'utf8'));
      assert.equal(disk.users.length, body.before);
      assert.ok(disk.objects.some(x => x.id === 'after-restart'));
    });
    if (kind === 'corrupt') check('corrupt source is preserved for investigation', () =>
      assert.ok(fs.readdirSync(dir).some(f => f.includes('.corrupt-'))));
  }
  const brokenDir = fs.mkdtempSync(path.join(dataDir, 'no-valid-'));
  fs.mkdirSync(path.join(brokenDir, 'backups'));
  fs.writeFileSync(path.join(brokenDir, 'brief.json'), '{bad');
  fs.writeFileSync(path.join(brokenDir, 'backups', 'brief-invalid.json'), '{bad');
  const failed = boot(brokenDir);
  check('corrupt primary without valid backup refuses startup observably', () => {
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /no valid|database unreadable/);
    assert.equal(fs.readFileSync(path.join(brokenDir, 'brief.json'), 'utf8'), '{bad');
  });
  const emptyDir = fs.mkdtempSync(path.join(dataDir, 'empty-production-'));
  fs.writeFileSync(path.join(emptyDir, 'brief.json'), JSON.stringify({ users: [] }));
  const prodEmpty = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/store.js')"], {
    cwd: path.resolve(new URL('../', import.meta.url).pathname),
    env: { ...process.env, NODE_ENV: 'production', BRIEF_DATA_DIR: emptyDir, BRIEF_ALLOW_EMPTY_STORE: '' }, encoding: 'utf8'
  });
  check('production rejects a pre-existing but empty primary without operator consent', () => {
    assert.notEqual(prodEmpty.status, 0);
    assert.match(prodEmpty.stderr, /missing or empty/);
  });
  fs.rmSync(dataDir, { recursive: true, force: true });
} finally {
  globalThis.fetch = nativeFetch;
  server.close();
  delete process.env.RESEND_API_KEY;
  delete process.env.BRIEF_EMAIL_FROM;
  fs.rmSync(process.env.BRIEF_DATA_DIR, { recursive: true, force: true });
}
console.log('PASS ' + passed);
