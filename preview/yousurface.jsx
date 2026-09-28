// You regression: compact groups, inline details, working settings and real data.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');

const { YouSurface } = require('./src/features/you/YouSurface.tsx');

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
};
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));

let fetchHandler;
global.fetch = async (input, init) => fetchHandler(String(input?.url ?? input ?? ''), init);

// The stubbed ledger: a signed-in member ("Amina"), the world's reads offline
// for the suite, and one real notification so the centre has a row to show.
const stub = () => async (url) => {
  const u = String(url);
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (u.includes('/auth/me')) return ok({ user: { displayName: 'Amina', handle: 'amina' } });
  if (u.includes('/notifications') && u.includes('preferences')) return ok({ preferences: { categories: {} } });
  if (u.includes('/notifications')) return ok({
    notifications: [{
      id: 'n1', kind: 'errand', type: 'status', title: 'A carrier took your errand',
      body: 'Wakulima → Westlands', objectId: null, entityId: null, collectionId: null,
      imageUrl: null, sourceName: null, context: null, dest: null, priority: 'normal',
      read: false, createdAt: new Date().toISOString()
    }],
    unread: 1
  });
  return { ok: false, status: 503, text: async () => JSON.stringify({ error: 'offline for the suite' }) };
};

const mount = (props) => {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => { root.render(React.createElement(YouSurface, props)); });
  return { c, root };
};

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

// The sections now stand as icon TILES (the drawer's one tile shape), each
// with a stable test id, so the contract is checked by id and shape rather
// than by exact button text — the tile's text is title + description.
const SECTION_IDS = { Standing: 'standing', Following: 'following', 'Your network': 'network', Earn: 'earn', 'Table Banking': 'tableBanking', Subscriptions: 'subscriptions', Archive: 'archive', 'How it works': 'how', Language: 'language', Notifications: 'notifications', 'Privacy & sign out': 'privacy' };
const tiles = () => Array.from(document.querySelectorAll('[data-testid=you-tile-grid] button'));
const tileTitle = (t) => {
  const title = Array.from(t.querySelectorAll('span')).find((s) => s.classList.contains('text-[15px]'));
  return (title?.textContent || '').trim();
};
const clickTile = async (id) => {
  const back = document.querySelector('[aria-label="Back to You"]');
  if (back) { act(() => back.click()); await flush(20); }
  const b = document.querySelector(`[data-testid="${id === 'profile' ? 'you-profile-head' : id}"]`);
  if (!b) throw new Error('no tile: ' + id);
  act(() => { b.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  return flush(20);
};

async function main() {
  fetchHandler = stub();
  // Seeded on the device BEFORE the surface reads it: privacy names the store
  // as it is, and the surface reads it once on mount.
  dom.window.localStorage.setItem('brief.world.place', 'Kisii');
  const { c, root } = mount({ onOpenEntity: () => {}, onRequireAuth: () => {} });
  await flush(60);

  check('You does not greet as a page titled Your account', !/Your account/.test(text(c)));

  // The tile grid: every section once, and the one tile shape the refactor
  // holds (bold 15px title, grey 13px description capped at two lines).
  const allTiles = tiles();
  const seen = new Map();
  allTiles.forEach((t) => { const l = tileTitle(t); seen.set(l, (seen.get(l) ?? 0) + 1); });
  check('every section tile appears exactly once',
    Object.keys(SECTION_IDS).every((s) => seen.get(s) === 1) && allTiles.length === Object.keys(SECTION_IDS).length);
  check('each tile is the one shape: 15px bold title, no note',
    allTiles.length > 0 && allTiles.every((t) => {
      const title = Array.from(t.querySelectorAll('span')).find((s) => s.classList.contains('text-[15px]'));
      const desc = Array.from(t.querySelectorAll('span')).find((s) => s.classList.contains('text-[13px]'));
      return title && title.classList.contains('font-semibold') && !desc;
    }));
  check('only three groups, collapsed by default', document.querySelectorAll('[data-testid=you-tile-grid] details').length === 3 && document.querySelectorAll('[data-testid=you-tile-grid] details[open]').length === 0);
  check('profile is one identity row; Orders/Selling link to their single home', document.querySelectorAll('[data-testid=you-profile-head]').length === 1 && document.querySelector('a[href="#spaces/orders"]') && !document.querySelector('[data-testid=orders]'));

  // The settings group exists, in the drawer's order.
  const tileIdx = (id) => allTiles.findIndex((t) => t.getAttribute('data-testid') === id);
  check('settings group holds Language · Notifications · Privacy',
    /Settings/.test(text(c)) && tileIdx('language') < tileIdx('notifications') && tileIdx('notifications') < tileIdx('privacy'));

  // ── Language: one honest line, no selector that switches nothing. ──
  await clickTile('language');
  check('language says the one language, plainly',
    /English/.test(text(c)) && /one language/i.test(text(c)));
  check('language has no fake selector',
    !document.querySelector('select') && !Array.from(document.querySelectorAll('button')).some((b) => /switch|change language/i.test(b.textContent || '')));

  // ── Notifications: the real centre, reading the server's one row. ──
  await clickTile('notifications');
  await flush(30);
  check('notifications shows the server row, not an invention',
    /carrier took your errand/.test(text(c)));

  // ── Privacy: the device's stores, named, with real controls. ──
  await clickTile('privacy');
  check('privacy names the area the device keeps',
    /Your area/.test(text(c)) && /Kisii/.test(text(c)));
  check('privacy shows the offline queue as a count',
    /Offline queue/.test(text(c)) && /Nothing is parked|waiting for signal/.test(text(c)));
  check('privacy carries a real sign-out',
    Array.from(document.querySelectorAll('button')).some((b) => (b.textContent || '').trim() === 'Sign out'));

  // The area clear acts on the store, not on a copy of it.
  const clearBtn = Array.from(document.querySelectorAll('button')).find((b) => (b.textContent || '').trim() === 'Clear');
  act(() => { clearBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
  check('clearing the area empties the device store',
    dom.window.localStorage.getItem('brief.world.place') === null);

  // ── The old sections survive the reorg: profile still leads. ──
  await clickTile('profile');
  check('profile shelf uses the session name, not a placeholder',
    text(c).includes('Amina') && /@amina/.test(text(c)));
  check('detail replaces the group list', !document.querySelector('[data-testid="you-tile-grid"]'));
  check('profile is inline, with a real back action', document.querySelector('[data-testid="you-detail"]') && document.querySelector('[data-testid="you-shelf-profile"]') && !document.querySelector('[data-testid="sheet"]') && document.querySelector('[aria-label="Back to You"]'));

  act(() => { root.unmount(); });
  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
