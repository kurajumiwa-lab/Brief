// Real production AppShell + real isolated API. No elevated browser fixtures.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const fs = require('fs'), os = require('os'), path = require('path');
const { spawn } = require('child_process');
const realFetch = global.fetch;
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
global.localStorage = dom.window.localStorage;
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.getComputedStyle = dom.window.getComputedStyle; global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'); const { act } = React; const { createRoot } = require('react-dom/client');
const api = require('./src/api/briefApi.ts');
const { AppShell } = require('./src/app/AppShell.tsx');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brief-admin-ui-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [path.resolve(__dirname, '../server/src/index.js')], { env: { ...process.env, PORT: String(port), BRIEF_DATA_DIR: dir, BRIEF_ADMINS: 'ui_admin', BRIEF_DEV_AUTH: '0', NODE_ENV: 'development' }, stdio: ['ignore', 'ignore', 'pipe'] });
let log = '', root, passed = 0;
server.stderr.on('data', (d) => { log += d; });
let failDirectory = false;
global.fetch = (url, init) => {
  const p = String(url?.url ?? url);
  if (failDirectory && /\/api\/ops\/members\?/.test(p)) return Promise.resolve(new Response(JSON.stringify({ error: 'Directory temporarily unavailable' }), { status: 503 }));
  return realFetch(p.startsWith('/ingest') ? base + p.slice(7) : p, init);
};
const sleep = (n) => new Promise((r) => setTimeout(r, n));
const text = () => document.body.textContent.replace(/\s+/g, ' ').trim();
const by = (id) => document.querySelector(`[data-testid="${id}"]`);
const button = (label) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === label);
const wait = async (fn, name) => { const deadline = Date.now() + 8000; while (Date.now() < deadline) { if (fn()) return fn(); await act(async () => { await sleep(20); }); } throw new Error(`Timeout: ${name}\n${text().slice(-2000)}`); };
const click = async (el) => { assert.ok(el, 'click target exists'); await act(async () => { el.click(); }); };
const type = async (el, value) => { assert.ok(el); await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); };
const go = async (hash) => { await act(async () => { window.location.hash = hash; await sleep(20); }); };
const call = async (url, token, method = 'GET', body) => { const r = await realFetch(base + url, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }); const json = await r.json(); assert.ok(r.ok, JSON.stringify(json)); return json; };
const mount = async (hash, token) => {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  window.history.replaceState(null, '', '#' + hash);
  api.setSessionToken(token);
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(AppShell)); });
};
const pass = (s) => { passed++; console.log('PASS ' + s); };
(async () => {
  try {
    for (let n = 0; ; n++) { try { if ((await realFetch(base + '/api/auth/me')).status === 401) break; } catch {} if (n > 100) throw new Error('server startup ' + log); await sleep(50); }
    const register = (handle) => call('/api/auth/register', null, 'POST', { handle, password: 'long-test-passphrase' });
    const admin = await register('ui_admin'), member = await register('ui_member');
    for (let i = 0; i < 30; i++) await register(`ui_paged_${i}`);
    await call('/api/spaces', member.token, 'POST', { name: 'Member private business', visibility: 'private' });
    await call('/api/me/work/profile', member.token, 'PUT', { displayName: 'Jane Field Worker', phone: '0712345678', modes: ['home'], areas: ['Nairobi'], device: { smartphone: true, gps: false } });
    await mount('admin/members', null);
    await wait(() => text().includes('Sign in to the admin desk'), 'signed out sign-in');
    assert.equal(by('menu-tile-admin-members'), null);
    pass('anonymous direct link offers sign-in, never a user directory');

    localStorage.setItem('brief.firstRunDismissed', '1');
    await mount('home', member.token);
    await click(await wait(() => document.querySelector('[aria-label="Open all sections"]'), 'menu'));
    await wait(() => by('nav-sheet-panel'), 'drawer');
    assert.equal(by('menu-tile-admin-members'), null, 'non-admin has no drawer entry');
    await go('admin/members/' + member.user.id);
    await wait(() => text().includes('Admin access required'), 'direct URL refusal');
    assert.equal(by('admin-member-profile'), null);
    pass('ordinary member has no admin entry and cannot bypass it with a profile URL');

    // Sign in on the existing screen: shell capability/menu state must update.
    await act(async () => { api.setSessionToken(admin.token); });
    await wait(() => by('admin-member-profile')?.textContent.includes('@ui_member'), 'new admin session opens linked profile');
    assert.ok(button('Account'));
    await click(button('Business profiles'));
    await wait(() => text().includes('Member private business'), 'business summary');
    assert.equal(document.querySelector('[aria-label="Member profile"] a[href^="#shop/"]'), null);
    await click(button('Worker profile'));
    assert.ok(text().includes('Jane Field Worker') && text().includes('No reviewed work yet'));
    pass('session change unlocks admin profile with business and worker drill-downs, not impersonation');

    await click(document.querySelector('[aria-label="Close the operator desk"]'));
    await wait(() => !document.querySelector('[aria-label="Admin desk"]'), 'desk closes');
    await click(document.querySelector('[aria-label="Open all sections"]'));
    const entry = await wait(() => by('menu-tile-admin-members'), 'admin drawer entry');
    await click(entry);
    await wait(() => document.querySelector('[aria-label="Admin desk"]'), 'desk from menu');
    await wait(() => button('Next') && !button('Next').disabled, 'paginated directory');
    assert.ok(text().includes('32 members'));
    await click(button('Next'));
    await wait(() => text().includes('Page 2 of 2'), 'next page');
    assert.equal(document.querySelectorAll('[data-testid="admin-member-row"]').length, 2);
    await type(document.querySelector('input[placeholder="search members…"]'), '@UI_MEMBER');
    await wait(() => text().includes('1 member matching'), 'search across all pages');
    assert.ok(text().includes('Page 1 of 1'));
    await click(by('admin-member-row'));
    await wait(() => by('admin-member-profile')?.textContent.includes('@ui_member'), 'selected profile');
    assert.equal(window.location.hash, '#admin/members/' + member.user.id);
    pass('production drawer opens Members; pagination and searchable deep-linked profiles work');

    await mount('admin/members/' + member.user.id, admin.token);
    await wait(() => by('admin-member-profile')?.textContent.includes('@ui_member'), 'profile reload');
    await go('admin/members');
    await wait(() => !by('admin-member-profile'), 'back to directory');
    await go('admin/members/unknown');
    await wait(() => text().includes('member not found'), 'missing member');
    assert.equal(button('Suspend — locks them out now'), undefined);
    pass('profile reload, directory navigation and unknown IDs do not leave stale details');

    await go('admin/members');
    failDirectory = true;
    await click(button('Refresh'));
    await wait(() => text().includes('Directory temporarily unavailable'), 'directory failure');
    assert.equal(document.querySelectorAll('[data-testid="admin-member-row"]').length, 0);
    failDirectory = false;
    await click(button('Retry'));
    await wait(() => document.querySelectorAll('[data-testid="admin-member-row"]').length === 30, 'retry');
    pass('failed directory reads are explicit and retryable, not fake empty lists');

    // Another tab signs out: cached private content must be discarded.
    await act(async () => { localStorage.removeItem('brief_session'); window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'brief_session', newValue: null })); });
    await wait(() => text().includes('Sign in to the admin desk'), 'cross-tab signout');
    assert.equal(document.querySelectorAll('[data-testid="admin-member-row"]').length, 0);
    assert.equal(by('admin-member-profile'), null);
    pass('cross-tab sign-out removes the private desk and profile');

    // An admin with no completed first-run setup can still follow a deep link.
    localStorage.removeItem('brief.firstRunDismissed');
    await mount('admin/members/' + member.user.id, admin.token);
    await wait(() => by('admin-member-profile')?.textContent.includes('@ui_member'), 'admin not intercepted by consumer onboarding');
    pass('first-run consumer onboarding does not intercept administration');
    const delegate = await register('ui_delegate');
    await call('/api/ops/roles', admin.token, 'POST', { userId: delegate.user.id, roles: ['admin'], reason: 'Test delegated admin' });
    await mount('admin/members/' + member.user.id, delegate.token);
    await wait(() => by('admin-member-profile')?.textContent.includes('@ui_member'), 'delegated admin');
    await call('/api/ops/roles', admin.token, 'POST', { userId: delegate.user.id, roles: [], reason: 'Revoke delegate' });
    await click(button('Refresh'));
    await wait(() => text().includes('Admin access required'), 'revoked access');
    assert.equal(by('admin-member-profile'), null);
    assert.equal(document.querySelectorAll('[data-testid="admin-member-row"]').length, 0);
    pass('revoked admin access clears cached profiles on the next read');
    console.log(`PASSED ${passed} FAILED 0`);
  } catch (e) { console.error(e); console.log(`PASSED ${passed} FAILED 1`); process.exitCode = 1; }
  finally {
    if (root) act(() => root.unmount());
    const exited = new Promise((r) => server.exitCode !== null ? r() : server.once('exit', r));
    server.kill('SIGTERM'); await Promise.race([exited, sleep(2000)]);
    fs.rmSync(dir, { recursive: true, force: true });
    process.exit(process.exitCode ?? 0);
  }
})();
