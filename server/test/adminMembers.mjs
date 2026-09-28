import './test-env.mjs';
import assert from 'node:assert/strict';
process.env.BRIEF_DEV_AUTH = '0';
process.env.BRIEF_ADMINS = 'registered_admin';
const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const members = await import('../src/domain/members.js');
const wf = await import('../src/domain/workforce.js');
const { createSpace } = await import('../src/domain/space.js');
const { default: app } = await import('../src/index.js');
store._reset();
const admin = auth.createUser({ handle: 'registered_admin', password: 'test-passphrase-long' });
const worker = auth.createUser({ handle: 'registered_worker', displayName: 'Jane Worker', password: 'test-passphrase-long' });
const other = auth.createUser({ handle: 'registered_other', password: 'test-passphrase-long' });
store.update('users', other.id, { platformRoles: ['operator'] });
const adminToken = auth.issueSession(admin.id).token;
const workerToken = auth.issueSession(worker.id).token;
const operatorToken = auth.issueSession(other.id).token;
let count = 0;
const test = async (name, fn) => { await fn(); count++; console.log('PASS ' + name); };
const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
const call = async (path, token, method = 'GET', body) => {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
};
try {
  await test('directory and profiles require server-side admin, not a claimed body or query role', async () => {
    for (const path of ['/api/ops/members', '/api/ops/onboarding', `/api/ops/members/${worker.id}`]) {
      assert.equal((await call(path)).status, 401);
      assert.equal((await call(path + '?role=admin&userId=' + admin.id, workerToken)).status, 403);
      assert.equal((await call(path, operatorToken)).status, 403);
      const r = await call(path, adminToken);
      assert.equal(r.status, 200);
      assert.equal(r.cache, 'no-store');
    }
    assert.throws(() => members.memberProfile(worker.id, other.id), (e) => e.status === 403);
  });
  await test('bootstrap admin appears as an effective role without inventing a stored assignment', async () => {
    const me = (await call('/api/auth/me', adminToken)).body.user;
    assert.ok(me.capabilities.includes('admin'));
    const p = (await call(`/api/ops/members/${admin.id}`, adminToken)).body.profile;
    assert.deepEqual(p.member.platformRoles, []);
    assert.ok(p.member.effectiveRoles.includes('admin'));
  });
  await test('directory has stable pagination and case-insensitive @handle/name search', async () => {
    // Registration rows suffice here; no password or synthetic identity is returned to a client.
    for (let i = 0; i < 34; i++) store.insert('users', { id: `usr_page_${i}`, handle: `page_${i}`, displayName: `Page member ${i}`, status: 'active', createdAt: '2026-01-01T00:00:00.000Z', passwordHash: 'never-return-this' });
    const first = (await call('/api/ops/members', adminToken)).body;
    const second = (await call('/api/ops/members?page=1', adminToken)).body;
    assert.equal(first.total, 37); assert.equal(first.rows.length, 30); assert.equal(second.rows.length, 7);
    assert.equal(new Set([...first.rows, ...second.rows].map((r) => r.id)).size, 37);
    for (const bad of ['-1', '1.5', 'Infinity', 'x']) assert.equal((await call(`/api/ops/members?page=${bad}`, adminToken)).body.page, 0);
    const match = (await call('/api/ops/members?q=%40REGISTERED_WORKER', adminToken)).body;
    assert.equal(match.total, 1); assert.equal(match.rows[0].id, worker.id);
    assert.equal((await call('/api/ops/members?q=Jane', adminToken)).body.total, 1);
  });
  await test('profile joins only the target account, businesses and workforce rows', async () => {
    createSpace({ ownerId: worker.id, name: 'Jane private shop', visibility: 'private' });
    createSpace({ ownerId: worker.id, name: 'Jane public shop', visibility: 'public' });
    createSpace({ ownerId: other.id, name: 'Other private shop' });
    const pub = store.find('spaces', (s) => s.name === 'Jane public shop');
    store.update('spaces', pub.id, { slug: 'jane-public' });
    wf.saveProfile(worker.id, { displayName: 'Jane Worker', phone: '0712345678', modes: ['home'], areas: ['Nairobi'], device: { smartphone: true, gps: false } });
    const team = wf.createWorkforce(admin.id, { name: 'Admin Field Team' });
    wf.joinByCode(worker.id, team.joinCode);
    const r = await call(`/api/ops/members/${worker.id}`, adminToken);
    const p = r.body.profile;
    assert.equal(p.spaces.length, 2);
    assert.equal(p.spaces.find((s) => s.visibility === 'private').publicSlug, null);
    assert.equal(p.spaces.find((s) => s.visibility === 'public').publicSlug, 'jane-public');
    assert.equal(p.worker.displayName, 'Jane Worker');
    assert.equal(p.memberships[0].name, 'Admin Field Team');
    assert.equal(p.memberships[0].status, 'applied');
    assert.equal(p.memberships[0].onboarding.complete, false);
    assert.equal(p.record.byTemplate.length, 0);
    assert.ok(p.businesses.length > 0);
    assert.equal(JSON.stringify(p).includes('Other private shop'), false);
    assert.equal(JSON.stringify(p).includes(team.joinCode), false, 'workforce invite code stays private');
    const privateSpace = p.spaces.find((s) => s.visibility === 'private');
    assert.ok([403, 404].includes((await call(`/api/spaces/${privateSpace.id}`, adminToken)).status), 'admin profile does not impersonate an owner');
  });
  await test('allowlisted projections exclude secrets and log administrative reads', async () => {
    store.update('users', worker.id, { email: 'jane@example.test', accessToken: 'PRIVATE_OAUTH_TOKEN', otp: 'PRIVATE_OTP' });
    const p = (await call(`/api/ops/members/${worker.id}`, adminToken)).body.profile;
    const json = JSON.stringify(p);
    for (const secret of ['passwordHash', 'passwordSalt', 'PRIVATE_OAUTH_TOKEN', 'PRIVATE_OTP', 'session', 'proofIds', 'ledgerTransactions']) assert.equal(json.includes(secret), false, secret);
    assert.equal(p.account.email, 'jane@example.test');
    assert.ok(store.find('auditLog', (r) => r.action === 'ops.member.view' && r.actorId === admin.id && r.objectId === worker.id));
    assert.equal((await call('/api/ops/members/not-real', adminToken)).status, 404);
    assert.equal((await call(`/api/ops/members/${other.id}`, adminToken)).body.profile.worker, null);
  });
  await test('role changes are admin-only, audited and cannot remove own admin access', async () => {
    assert.equal((await call('/api/ops/roles', workerToken, 'POST', { userId: worker.id, roles: ['admin'] })).status, 403);
    assert.equal((await call('/api/ops/roles', adminToken, 'POST', { userId: admin.id, roles: [] })).status, 409);
    assert.equal((await call('/api/ops/roles', adminToken, 'POST', { userId: worker.id, roles: ['reviewer'], reason: 'Review team' })).status, 200);
    assert.ok(store.find('auditLog', (r) => r.action === 'ops.roles.set' && r.objectId === worker.id));
  });
  await test('suspension is audited, requires a reason and revokes sessions; self-suspension refused', async () => {
    const path = `/api/ops/members/${worker.id}/status`;
    assert.equal((await call(path, adminToken, 'POST', { status: 'suspended' })).status, 400);
    assert.equal((await call(`/api/ops/members/${admin.id}/status`, adminToken, 'POST', { status: 'suspended', reason: 'self removal' })).status, 409);
    const r = await call(path, adminToken, 'POST', { status: 'suspended', reason: 'Duplicate registration review' });
    assert.equal(r.status, 200); assert.ok(r.body.sessionsRevoked > 0);
    assert.equal((await call('/api/auth/me', workerToken)).status, 401);
    assert.equal((await call(path, adminToken, 'POST', { status: 'active' })).status, 200);
    assert.equal((await call('/api/auth/me', workerToken)).status, 401, 'reinstatement does not resurrect a revoked session');
  });
  await test('revocation is effective on the very next privileged read', async () => {
    delete process.env.BRIEF_ADMINS;
    assert.equal((await call(`/api/ops/members/${worker.id}`, adminToken)).status, 403);
    assert.equal((await call('/api/ops/members', adminToken)).status, 403);
  });
  console.log(`PASS ${count}`);
} finally { await new Promise((resolve) => server.close(resolve)); }
