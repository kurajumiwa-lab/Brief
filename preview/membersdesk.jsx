// THE MEMBERS DESK — onboarding real people. The admin directory is derived
// (search, roles, verification, the rung each member actually climbed), the
// funnel counts real activation events only, and suspension is immediate +
// audited with a reason. Non-admins see an honest refusal, not a shell.
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent; global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
require('./suiteauth.cjs').installSuiteSession();
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');

const RUNGS = [
  { id: 'identity', label: 'Be someone' },
  { id: 'orient', label: 'Say what you came for' },
  { id: 'value', label: 'Keep your first real thing' },
  { id: 'contribute', label: 'Add something of your own' },
  { id: 'reach', label: 'Put it in front of people' }
];
const mkMember = (over = {}) => ({
  id: over.id ?? 'usr_1', handle: over.handle ?? 'newbie', displayName: over.displayName ?? 'Newbie',
  createdAt: '2026-08-30T10:00:00.000Z', status: over.status ?? 'active',
  platformRoles: over.platformRoles ?? [], verification: over.verification ?? 'none',
  onboarding: over.onboarding ?? { rung: 'identity', latestEvent: 'signed_in', latestAt: '2026-08-30T10:00:01.000Z', finished: false },
  shop: over.shop ?? null
});
let MEMBERS = [mkMember(), mkMember({ id: 'usr_2', handle: 'climber', displayName: 'Climber', onboarding: { rung: 'value', latestEvent: 'object_saved', latestAt: '2026-08-30T11:00:00.000Z', finished: true } })];
const FUNNEL = {
  funnel: { signed_in: 2, goal_chosen: 1, object_saved: 1 },
  members: MEMBERS,
  totals: { members: 2, withAnyEvent: 2, finishedOnboarding: 1 },
  rungs: RUNGS,
  note: 'Every count is a scan of real rows. A member with no events has genuinely not started.'
};
let ROLE_CALLS = [], STATUS_CALLS = [], CAPS = ['admin'];

global.fetch = async (url, init = {}) => {
  const p = String(url);
  const send = (b, s = 200) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
  if (!CAPS.includes('admin') && p.includes('/api/ops/')) return send({ error: 'this desk needs the admin capability' }, 403);
  if (p.includes('/api/ops/onboarding')) return send(FUNNEL);
  if (p.includes('/api/ops/members/') && (init.method ?? 'GET') === 'GET') {
    const member = MEMBERS.find((m) => p.endsWith('/' + m.id));
    return send({ profile: { member, account: { email: null, authProvider: 'password' }, spaces: [], businesses: [], worker: null, memberships: [], ownedWorkforces: [], record: { byTemplate: [], note: '', userId: member.id, lastActiveAt: null } } });
  }
  if (p.includes('/api/ops/members/')) {
    STATUS_CALLS.push(JSON.parse(init.body));
    const m = MEMBERS.find((x) => x.id === 'usr_1');
    if (STATUS_CALLS[STATUS_CALLS.length - 1].status === 'suspended') MEMBERS[0] = mkMember({ status: 'suspended' });
    else MEMBERS[0] = mkMember({ status: 'active' });
    return send({ user: MEMBERS[0], changed: true, sessionsRevoked: 1 });
  }
  if (p.includes('/api/ops/members')) {
    const q = new URL(p, 'https://brief.test').searchParams.get('q') ?? '';
    const rows = q ? MEMBERS.filter((m) => m.handle.includes(q.toLowerCase()) || m.displayName.toLowerCase().includes(q.toLowerCase())) : MEMBERS;
    return send({ rows, total: rows.length, page: 0, pageSize: 30 });
  }
  if (p.includes('/api/ops/roles')) {
    ROLE_CALLS.push(JSON.parse(init.body));
    return send({ user: { id: 'usr_2', handle: 'climber', platformRoles: JSON.parse(init.body).roles } });
  }
  if (p.includes('/api/capabilities')) return send({ capabilities: CAPS, connectors: {}, payments: { configured: false }, arenaMoney: { enabled: false } });
  if (p.includes('/api/auth/me')) return send({ user: { id: 'usr_admin', handle: 'admin', displayName: 'Admin' } });
  if (p.includes('/api/health')) return send({ ok: true, uptimeSeconds: 10, version: 'test' });
  return { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
};

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); } };

(async () => {
  const { AdminDesk } = await import('./src/components/AdminDesk.tsx');
  let tick = 0;
  const root = createRoot(document.getElementById('root'));
  const render = async () => {
    tick++;
    await act(async () => { root.render(React.createElement(AdminDesk, { open: true, onClose: () => {}, me: { id: 'usr_admin', handle: 'admin', displayName: 'Admin', capabilities: CAPS }, tick })); });
    await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  };
  await render();

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = () => text(document.body);
  const btn = (t) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === t);
  const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); }); };

  console.log('=== the members desk is the first tab ===');
  check('Members leads the tabs', Boolean(btn('Members')), body().slice(0, 80));
  await click(btn('Members'));

  console.log('\n=== the onboarding funnel counts real events ===');
  check('members, started and finished are stated', body().includes('Members') && /Started \(any event\)/.test(body()) && /Finished onboarding/.test(body()));
  check('named events are shown as chips, not invented', body().includes('signed_in · 2') && body().includes('object_saved · 1'));

  console.log('\n=== the directory ===');
  check('both members are listed', body().includes('Newbie') && body().includes('Climber'));
  check("the rung each member climbed is named in the ladder's own words", body().includes('Climbed to: Keep your first real thing'), body().slice(-260));
  const search = document.querySelector('input[placeholder="search members…"]');
  const setNativeValue = (el, v) => Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, v);
  await act(async () => { setNativeValue(search, 'climb'); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  check('search narrows the directory', body().includes('Climber') && !body().includes('Newbie'), '');
  await act(async () => { setNativeValue(search, ''); search.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 15)); });

  console.log('\n=== acting on a member, audited ===');
  const row = Array.from(document.querySelectorAll('button')).find((b) => text(b).includes('@newbie'));
  await click(row);
  check('the member panel opens with status', body().includes('Status') && body().includes('active'));
  const grant = Array.from(document.querySelectorAll('button')).find((b) => text(b) === 'operator');
  await click(grant);
  check('granting a role rides the audited route with a reason', ROLE_CALLS.length === 1 && ROLE_CALLS[0].roles.includes('operator') && /members desk/.test(ROLE_CALLS[0].reason ?? ''), JSON.stringify(ROLE_CALLS));
  const why = document.querySelector('input[placeholder="why suspend? (audited)"]');
  await act(async () => { setNativeValue(why, 'spam signups'); why.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(btn('Suspend — locks them out now'));
  await act(async () => { await new Promise((r) => setTimeout(r, 15)); });
  check('suspension sends status + the audited reason', STATUS_CALLS.length === 1 && STATUS_CALLS[0].status === 'suspended' && STATUS_CALLS[0].reason === 'spam signups', JSON.stringify(STATUS_CALLS));
  check('the desk confirms the lockout in words', /Suspended — newbie is locked out now/.test(body()), body().slice(-160));
  check('the suspended member shows a red chip in the directory', body().includes('suspended'));

  console.log('\n=== non-admins get an honest refusal ===');
  CAPS = ['operator'];
  await render();
  await click(btn('Members'));
  check('without the admin capability the desk says so', /needs the admin capability/.test(body()), body().slice(-120));

  console.log(`\nPASS ${pass} FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
