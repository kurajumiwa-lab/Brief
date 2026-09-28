// THE DUKA BOOK + POOL + THE OFFLINE SHELL — the SME-digitization layer.
// The book holds what the shopkeeper LOGS (Brief never claims to see inside
// WhatsApp), every number is derived, a sale carries a clientKey, a dead
// signal queues the write instead of losing it, and the PWA shell is really
// in the build (manifest + service worker, API never cached).
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement; global.Element = dom.window.Element; global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent; global.getComputedStyle = dom.window.getComputedStyle;
// The offline queue persists through globalThis.localStorage — give the
// suite the same storage a browser would have.
global.localStorage = dom.window.localStorage;
global.IS_REACT_ACT_ENVIRONMENT = true;
require('./suiteauth.cjs').installSuiteSession();
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');

const SHOP_VIEW = {
  shop: {
    id: 'shop_1', ownerId: 'usr_1', name: 'Mama Njeria Fresh', tagline: 'Fresh groceries, Kilimani', orderNumber: '+254 712 345 678',
    items: [
      { id: 'i1', name: 'Sukuma Wiki', priceKes: 50, note: null },
      { id: 'i2', name: 'Tomatoes (kg)', priceKes: 120, note: 'organic' }
    ],
    status: 'published', publishedAt: '2026-08-30T00:00:00Z'
  },
  store: { priceKes: 250, active: true, activeUntil: '2026-09-29T00:00:00Z' },
  share: { text: '*Mama Njeria Fresh*', waMe: 'https://wa.me/254712345678?text=x', shareable: true }
};
const BOOK = {
  shop: { id: 'shop_1', name: 'Mama Njeria Fresh', status: 'published' },
  today: { sales: 3, items: 5, kes: 430 },
  yesterday: { sales: 6, items: 9, kes: 1200 },
  week: { sales: 21, items: 34, kes: 4100 },
  topItems: [{ name: 'Sukuma Wiki', qty: 11 }, { name: 'Tomatoes (kg)', qty: 6 }],
  items: [
    { name: 'Sukuma Wiki', priceKes: 50, stockQty: 12, soldWeek: 11, remaining: 1 },
    { name: 'Tomatoes (kg)', priceKes: 120, stockQty: 40, soldWeek: 6, remaining: 34 }
  ],
  lowStock: [{ name: 'Sukuma Wiki', remaining: 1 }],
  recent: [],
  note: 'The book holds what you log. Sales that happen inside WhatsApp are yours to record — ten seconds keeps the book true.'
};

let salesLog = [];
let offline = false;
global.fetch = async (url, init = {}) => {
  if (offline) throw new TypeError('Failed to fetch');
  const p = String(url);
  const send = (b, s = 200) => ({ ok: s < 400, status: s, text: async () => JSON.stringify(b), json: async () => b });
  if (p.includes('/api/shop/mine/book')) return send(BOOK);
  if (p.includes('/api/shop/mine/sales')) {
    const body = JSON.parse(init.body);
    salesLog.push(body);
    return send({ sale: { id: 's' + salesLog.length, name: body.name, qty: body.qty, unitKes: body.unitKes, amountKes: body.qty * body.unitKes, channel: 'counter', day: '2026-08-30', createdAt: new Date().toISOString(), clientKey: body.clientKey ?? null }, replayed: false }, 201);
  }
  if (p.includes('/api/shop/mine/pool')) {
    const body = JSON.parse(init.body);
    return send({
      pool: { id: 'gb_1', title: `Restock pool: ${body.itemName}`, targetAmount: body.unitCostKes * body.goalUnits, total: body.unitCostKes * body.myUnits, stage: 'funding' },
      share: { text: `*RESTOCK POOL*\n_${body.itemName} — pooled by Mama Njeria Fresh_`, waMe: `https://wa.me/254712345678?text=pool` }
    }, 201);
  }
  if (p.includes('/api/shop/mine')) return send(SHOP_VIEW);
  return { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
};

let pass = 0, fail = 0;
const check = (n, c, d = '') => { if (c) { pass++; console.log('  PASS  ' + n); } else { fail++; console.log('  FAIL  ' + n + (d ? ' -> ' + d : '')); } };

(async () => {
  const { WhatsAppShopBuilder } = await import('./src/components/WhatsAppShopBuilder.tsx');
  const briefApi = await import('./src/api/briefApi.ts');
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(WhatsAppShopBuilder, { onOpenFees: () => {} })); });
  await act(async () => { await new Promise((r) => setTimeout(r, 20)); });

  const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const body = () => text(document.body);
  const btn = (t) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === t);
  const input = (ph) => Array.from(document.querySelectorAll('input')).find((i) => (i.placeholder ?? '') === ph);
  const click = async (el) => { await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); }); };
  // React tracks input values with its own descriptor; assigning .value
  // directly does not notify it. Drive the NATIVE setter, then the event.
  const setNativeValue = (el, v) => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(el, v);
  };
  const type = async (el, v) => {
    await act(async () => {
      setNativeValue(el, v);
      el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  };

  console.log('=== the book: the paper-ledger replacement ===');
  check('today, yesterday and the week are all derived', body().includes('KES 430') && body().includes('KES 1,200') && body().includes('KES 4,100'));
  check('top items are ranked, with the leader on fire', body().includes('Sukuma Wiki ×11'));
  check('low stock is named with its count', body().includes('Low stock: Sukuma Wiki (1)'));
  check('the book states its own honesty', body().includes('yours to record'));

  console.log('\n=== logging a sale: 3 fields, keyed ===');
  const what = input('What sold?');
  await type(what, 'Sukuma Wiki');
  const qty = document.querySelector('input[aria-label="quantity"]');
  await type(qty, '2');
  await click(btn('Log'));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check('the sale logs with the list price and a clientKey',
    salesLog.length === 1 && salesLog[0].unitKes === 50 && salesLog[0].qty === 2 && /^sale_/.test(salesLog[0].clientKey ?? ''), JSON.stringify(salesLog[0]));
  check('the confirmation says Logged', body().includes('Logged.'));

  console.log('\n=== a dead signal queues the write instead of losing it ===');
  offline = true;
  await type(what, 'Tomatoes (kg)');
  await type(qty, '1');
  await click(btn('Log'));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check('the surface says QUEUED, not done', body().includes('Offline — queued'));
  const stored = JSON.parse(globalThis.localStorage.getItem('brief.offlineQueue.v1') ?? '[]');
  check('the write is parked in localStorage, one row', stored.length === 1 && stored[0].path.includes('/api/shop/mine/sales'), JSON.stringify(stored.map((w) => w.path)));
  check('the parked write keeps the sale (not a blank)', JSON.parse(stored[0].body).name === 'Tomatoes (kg)');

  offline = false;
  let landed = 0;
  await act(async () => { landed = await briefApi.flushOfflineQueue(); });
  check('reconnect drains the queue', landed === 1 && briefApi.offlineQueueDepth() === 0, `landed=${landed} depth=${briefApi.offlineQueueDepth()}`);
  check('the replayed sale reached the server exactly once more', salesLog.length === 2 && salesLog[1].name === 'Tomatoes (kg)');

  console.log('\n=== pooling a restock on the Group Buy engine ===');
  await type(input('Item (from your list)'), 'Sukuma Wiki');
  await type(input('Bulk cost/unit (KES)'), '35');
  await type(input('Goal (units)'), '20');
  await type(input('Your units'), '5');
  await click(btn('Open the pool'));
  await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
  check('the pool opens with target and pledge stated', body().includes('KES 175 of 700 pledged'), body().slice(-200));
  check('the forwardable call to other shops is WhatsApp-formatted', body().includes('*RESTOCK POOL*'));
  check('the wa.me call button exists', Boolean(Array.from(document.querySelectorAll('a')).find((a) => a.href.includes('wa.me/254712345678'))));

  console.log('\n=== the offline shell is really in the build ===');
  const dist = path.join(__dirname, 'dist'); // suites run from preview/; dist is preview/dist
  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  check('index.html links the manifest and registers the worker', /manifest\.webmanifest/.test(html) && /sw\.js/.test(html));
  check('the service worker and manifest shipped', fs.existsSync(path.join(dist, 'sw.js')) && fs.existsSync(path.join(dist, 'manifest.webmanifest')));
  const sw = fs.readFileSync(path.join(dist, 'sw.js'), 'utf8');
  check('the API is never cached', sw.includes("pathname.startsWith('/ingest')") && sw.includes("pathname.startsWith('/api/')"), 'no /ingest early-return');
  check('assets are cache-first, navigations fall back to the shell', sw.includes('wairo-assets-v3') && sw.includes("caches.match('/')"));

  console.log(`\nPASS ${pass} FAIL ${fail}`);
  process.exit(fail ? 1 : 0);
})();
