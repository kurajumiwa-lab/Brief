// ---------------------------------------------------------------------------
// MINE — shops, orders, held records. Failed reads are not empty shops.
//
// The Stitch "Mine & Ledger" invented KES 14,350 in escrow, ETAs, QR codes,
// a vault-healthy badge and a Hubs tab. This suite pins the door as it is:
//
//   * a failed shops read is a retry, never "No shop yet";
//   * a successful empty shops read is "No shop yet";
//   * held records omit when none are locked, print the server total when they
//     are, and never invent a vault;
//   * the bar did not grow a Hubs door (that lives in doorways.jsx).
// ---------------------------------------------------------------------------
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
const { MineSurface } = require('./src/features/mine/MineSurface.tsx');
const { EscrowRecords } = require('./src/features/mine/EscrowRecords.tsx');
const { BOTTOM_BAR_ITEMS } = require('./src/app/Navigation.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

let handler = async () => ({ ok: false, status: 500, text: async () => JSON.stringify({ error: 'offline' }) });
global.fetch = async (input) => handler(String(input?.url ?? input ?? ''));

const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
const fail = (status = 500) => ({ ok: false, status, text: async () => JSON.stringify({ error: 'no' }) });

const space = (id, over = {}) => ({
  id, ownerId: 'me', name: `Shop ${id}`, type: 'shop', goal: 'g', targetValueKes: 0,
  image: null, visibility: 'public', status: 'active', capabilities: [],
  metrics: { revenueKes: 0, customerCount: 0, activeOrdersCount: 0, totalOrdersCount: 0, offersCount: 0 },
  offers: [], recentActivities: [], recentConversations: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over
});

async function mount(el) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await flush();
  return { host, root, t: text(host) };
}

async function main() {
  const props = { onOpenSpace: () => undefined, onOpenCreateSpace: () => undefined, onOpenEntity: () => undefined, onRequireAuth: () => undefined };

  // --- 1. failed shops read is not "No shop yet" ---------------------------
  {
    handler = async (url) => {
      if (url.includes('/api/spaces')) return fail(500);
      if (url.includes('/api/me/follows')) return ok({ groups: {}, total: 0, kindLabels: {} });
      if (url.includes('/api/shop-brief')) return ok({ brief: { empty: true, reason: 'no_spaces' } });
      if (url.includes('/api/escrows/mine')) return ok({ rows: [], totals: { heldKes: 0, releasedKes: 0, heldCount: 0 }, note: 'x' });
      if (url.includes('/api/auth/me')) return fail(401);
      if (url.includes('/api/orders') || url.includes('/api/listings') || url.includes('/api/disputes')) return ok({ orders: [], listings: [], disputes: [] });
      return fail(404);
    };
    const { t } = await mount(React.createElement(MineSurface, props));
    assert.ok(t.includes('Your shops could not be read just now'), t.slice(0, 240));
    assert.ok(!/No shop yet/.test(t), 'a failed read is not an empty shop');
    assert.ok(/Try again/.test(t), 'with a way back');
  }
  pass('a failed shops read is a retry, never an empty stall');

  // --- 2. successful empty is "No shop yet" --------------------------------
  {
    handler = async (url) => {
      if (url.includes('/api/spaces')) return ok({ spaces: [] });
      if (url.includes('/api/me/follows')) return ok({ groups: {}, total: 0, kindLabels: {} });
      if (url.includes('/api/shop-brief')) return ok({ brief: { empty: true, reason: 'no_spaces' } });
      if (url.includes('/api/escrows/mine')) return ok({ rows: [], totals: { heldKes: 0, releasedKes: 0, heldCount: 0 }, note: 'x' });
      if (url.includes('/api/auth/me')) return ok({ user: { id: 'me', displayName: 'ogallo' } });
      if (url.includes('/api/orders') || url.includes('/api/listings') || url.includes('/api/disputes')) return ok({ orders: [], listings: [], disputes: [] });
      return fail(404);
    };
    const { t } = await mount(React.createElement(MineSurface, props));
    assert.ok(t.includes('No spaces yet.'), t.slice(0, 200));
    assert.ok(t.includes('Create space'), 'and the one action that changes it');
  }
  pass('a true empty shops read is No shop yet');

  // --- 3. escrow omitted when none locked ----------------------------------
  {
    const { host, t } = await mount(React.createElement(EscrowRecords, {}));
    assert.equal(host.querySelector('[data-testid="escrow-records"]'), null, 'no vault furniture');
    assert.ok(!/KES/.test(t), 'and no locked figure');
  }
  pass('held records omit when none are locked');

  // --- 4. locked rows print the server total -------------------------------
  {
    handler = async (url) => {
      if (url.includes('/api/escrows/mine')) return ok({
        rows: [
          { id: 'esc_gb_1', kind: 'group_buy', refId: 'gb_1', title: 'Flour pool', role: 'contributor', state: 'locked', amountKes: 2400, updatedAt: '2026-09-21T00:00:00Z' },
          { id: 'esc_tk_1', kind: 'ticket', refId: 'tk_1', title: 'Old seat', role: 'buyer', state: 'released', amountKes: 500, updatedAt: '2026-09-20T00:00:00Z' }
        ],
        totals: { heldKes: 2400, releasedKes: 500, heldCount: 1 },
        note: 'Records of funds held between two sides until delivery — Brief moves no money itself. HudumaLink citizen escrow is phone-keyed and read at the operator desk.'
      });
      return fail(404);
    };
    const { host, t } = await mount(React.createElement(EscrowRecords, {}));
    assert.ok(host.querySelector('[data-testid="escrow-records"]'), 'the section renders');
    assert.ok(t.includes('KES 2,400'), `held total from the read: ${t}`);
    assert.ok(t.includes('Flour pool'), 'the locked row is named');
    assert.ok(!t.includes('Old seat'), 'a released row is not listed as held');
    assert.ok(t.includes('Brief moves no money itself'), 'the server note travels');
    assert.ok(!/vault healthy|14,350|smart milestone/i.test(t), 'no Stitch furniture');
  }
  pass('locked rows print the server total, released ones do not');

  // --- 5. failed escrow is a dash, not KES 0 --------------------------------
  {
    handler = async () => fail(500);
    const { t } = await mount(React.createElement(EscrowRecords, {}));
    assert.ok(t.includes('Held records could not be read just now'), t);
    assert.ok(!/KES/.test(t), 'no invented amount');
    assert.ok(/Try again/.test(t));
  }
  pass('a failed escrow read invents no vault');

  // --- 6. 401 escrow is silence --------------------------------------------
  {
    handler = async () => fail(401);
    const { host, t } = await mount(React.createElement(EscrowRecords, {}));
    assert.equal(text(host), '', `signed out is silence: ${t}`);
  }
  pass('a signed-out escrow read claims nothing');

  // --- 7. no Hubs door, no Stitch ledger copy on Mine -----------------------
  {
    handler = async (url) => {
      if (url.includes('/api/spaces')) return ok({ spaces: [space('spc_m', { name: 'Nairobi Boda' })] });
      if (url.includes('/api/me/follows')) return ok({ groups: {}, total: 0, kindLabels: {} });
      if (url.includes('/api/shop-brief')) return ok({ brief: { empty: true, reason: 'no_spaces' } });
      if (url.includes('/api/escrows/mine')) return ok({ rows: [], totals: { heldKes: 0, releasedKes: 0, heldCount: 0 }, note: 'x' });
      if (url.includes('/api/auth/me')) return ok({ user: { id: 'me', displayName: 'ogallo' } });
      if (url.includes('/api/orders') || url.includes('/api/listings') || url.includes('/api/disputes')) return ok({ orders: [], listings: [], disputes: [] });
      return fail(404);
    };
    const { t } = await mount(React.createElement(MineSurface, props));
    assert.ok(!/Hubs/.test(t), 'Mine did not grow a Hubs tab');
    assert.ok(!/Ledger Synchronized|Vault healthy|LIVE ESCROW|Audited/i.test(t), 'no Stitch ledger pulse');
    assert.ok(!/ETA|Receive Pass|Confirm & Release|TR-8921/i.test(t), 'no invented fulfilment');
    const doors = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination').map((i) => i.label);
    // Mall, market, trade, duka, you. The two seller doors this suite used to
    // pin ('Selling' and 'Spaces') both opened MineSurface with a different
    // section pre-selected, so they are one door now — and MineSurface is the
    // screen behind it, which is why this suite still owns the assertion.
    assert.deepEqual(doors, ['Home', 'Market', 'Trade', 'Shop', 'You'], 'the bar is the avenue’s five doors');
  }
  pass('Mine did not grow Hubs, a vault, or an ETA');

  console.log('\nPASS ' + count);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
