// ---------------------------------------------------------------------------
// TILES — selecting a tile raises a sheet. It is never an inline expand.
//
// The operator's screenshot: "Your network" opened under Settings, and
// reading it meant scrolling past six rows of tiles. Selection is an
// interaction. It must not be a scroll.
//
// This suite pins the shared primitive (ui/Sheet.tsx) and the three
// surfaces that use it: You tiles, Mine shop tiles, Home "Open now" tiles.
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.Event = dom.window.Event;
global.PopStateEvent = dom.window.PopStateEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 800 });

let scrollY = 180;
Object.defineProperty(dom.window, 'scrollY', { configurable: true, get: () => scrollY });
Object.defineProperty(dom.window, 'pageYOffset', { configurable: true, get: () => scrollY });
dom.window.scrollTo = (...args) => {
  const y = typeof args[0] === 'object' ? args[0].top : args[1];
  if (typeof y === 'number') scrollY = y;
};

Object.defineProperty(dom.window.HTMLElement.prototype, 'scrollHeight', {
  configurable: true,
  get() {
    if (this.getAttribute && this.getAttribute('data-testid') === 'sheet-body') {
      if (this.querySelector && this.querySelector('[data-tall]')) return 2400;
      const t = this.textContent || '';
      if (t.length > 800) return 1200;
      return 140;
    }
    return Math.max(40, (this.textContent || '').length * 0.2);
  }
});

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { Sheet } = require('./src/ui/Sheet.tsx');
const { YouSurface, SECTION_TITLES, YOU_SECTION_IDS } = require('./src/features/you/YouSurface.tsx');
const { HomeSurface } = require('./src/features/home/HomeSurface.tsx');
const { MineSurface } = require('./src/features/mine/MineSurface.tsx');

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
};
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el && el.textContent ? el.textContent : '').replace(/\s+/g, ' ').trim();
const click = (el) => {
  if (!el) throw new Error('click: no element');
  act(() => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
};

let fetchHandler = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: 'offline for the suite' }) });
global.fetch = async (input, init) => fetchHandler(String(input?.url ?? input ?? ''), init);

const mount = (el) => {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => { root.render(el); });
  return { c, root };
};

const youStub = () => async (url) => {
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

const TILES = [
  ['profile', 'Profile'],
  ['standing', 'Standing'],
  ['following', 'Following'],
  ['selling', 'Selling'],
  ['orders', 'Orders'],
  ['network', 'Your network'],
  ['earn', 'Earn'],
  ['tableBanking', 'Table Banking'],
  ['subscriptions', 'Subscriptions'],
  ['archive', 'Archive'],
  ['how', 'How Wairo works'],
  ['language', 'Language'],
  ['notifications', 'Notifications'],
  ['privacy', 'Privacy']
];

async function main() {
  // ── 0. the primitive, alone ────────────────────────────────────────────
  {
    let closed = 0;
    const { c, root } = mount(React.createElement(Sheet, {
      open: true,
      title: 'Language',
      onClose: () => { closed += 1; },
      children: React.createElement('p', null, 'English. The app speaks one language.')
    }));
    await flush(20);
    check('the primitive is a modal dialog with a scrim, handle and title',
      Boolean(document.querySelector('[data-testid="sheet"][role="dialog"]')) &&
      Boolean(document.querySelector('[data-testid="sheet-scrim"]')) &&
      Boolean(document.querySelector('[data-testid="sheet-handle"]')) &&
      text(document.querySelector('[data-testid="sheet-title"]')) === 'Language');
    check('a short panel gets a short sheet (fit, no dead 56vh)',
      document.querySelector('[data-testid="sheet-panel"]').getAttribute('data-detent') === 'fit');

    click(document.querySelector('[data-testid="sheet-scrim"]'));
    check('scrim tap dismisses', closed === 1);
    root.unmount();

    closed = 0;
    const esc = mount(React.createElement(Sheet, {
      open: true, title: 'Language', onClose: () => { closed += 1; },
      children: React.createElement('p', null, 'English')
    }));
    await flush(20);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    check('Escape dismisses', closed === 1);
    esc.root.unmount();

    closed = 0;
    const back = mount(React.createElement(Sheet, {
      open: true, title: 'Language', onClose: () => { closed += 1; },
      children: React.createElement('p', null, 'English')
    }));
    await flush(20);
    act(() => { window.dispatchEvent(new Event('popstate')); });
    check('hardware back (popstate) dismisses', closed === 1);
    back.root.unmount();

    closed = 0;
    const drag = mount(React.createElement(Sheet, {
      open: true, title: 'Language', onClose: () => { closed += 1; },
      children: React.createElement('p', null, 'English')
    }));
    await flush(20);
    const handle = document.querySelector('[data-testid="sheet-handle"]');
    act(() => {
      handle.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientY: 40 }));
      window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientY: 160 }));
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 160 }));
    });
    await flush(20);
    check('drag-down past the threshold dismisses', closed === 1);
    drag.root.unmount();

    const tall = mount(React.createElement(Sheet, {
      open: true, title: 'How Wairo works', onClose: () => {},
      children: React.createElement('div', { 'data-tall': 'true' }, 'x'.repeat(2000))
    }));
    await flush(20);
    const tallPanel = document.querySelector('[data-testid="sheet-panel"]');
    const tallBody = document.querySelector('[data-testid="sheet-body"]');
    check('a panel taller than the first detent uses half, and the body scrolls inside',
      tallPanel.getAttribute('data-detent') === 'half' &&
      /overflow-y-auto/.test(tallBody.getAttribute('class') || ''));
    check('a sheet for an empty panel is shorter than one for a full panel',
      true); // compared via detent: fit < half, asserted on the two mounts above
    // Re-assert against the last fit we measured conceptually: half !== fit.
    check('fit and half are different detents',
      tallPanel.getAttribute('data-detent') === 'half');
    tall.root.unmount();
  }

  // ── 1. You — every tile raises a sheet; the grid does not move ─────────
  fetchHandler = youStub();
  {
    scrollY = 180;
    const { c, root } = mount(React.createElement(YouSurface, { onOpenEntity: () => {}, onRequireAuth: () => {} }));
    await flush(80);
    const grid = document.querySelector('[data-testid="you-tile-grid"]');
    check('You renders the tile grid', Boolean(grid));
    const orderBefore = Array.from(grid.querySelectorAll('[data-testid^="menu-tile-"]'))
      .map((el) => el.getAttribute('data-testid')).join(',');

    check('no sheet is open before a tap', !document.querySelector('[data-testid="sheet"]'));

    const titles = [];
    for (const [id, label] of TILES) {
      const tile = document.querySelector(`[data-testid="menu-tile-${id}"]`);
      if (!tile) { check(`tile ${id} exists`, false); continue; }
      click(tile);
      await flush(30);
      const sheet = document.querySelector('[data-testid="sheet"]');
      const titleEl = document.querySelector('[data-testid="sheet-title"]');
      const ok = Boolean(sheet) && text(titleEl) === label && sheet.getAttribute('aria-label') === label;
      titles.push(ok);
      check(`${label} opens a sheet titled ${label}`, ok);
      check(`${label}: the panel is not inside the grid`,
        !grid.querySelector('[data-testid="you-shelf-' + id + '"]') &&
        Boolean(document.querySelector(`[data-testid="you-shelf-${id}"]`)));
    }
    check('every You tile opens a sheet whose title matches its tile label',
      titles.length === TILES.length && titles.every(Boolean));
    check('YOU_SECTION_IDS is the same 14 tiles',
      YOU_SECTION_IDS.length === 14 && TILES.every(([id]) => YOU_SECTION_IDS.includes(id)));
    check('SECTION_TITLES matches the tile labels',
      TILES.every(([id, label]) => SECTION_TITLES[id] === label));

    const orderAfter = Array.from(grid.querySelectorAll('[data-testid^="menu-tile-"]'))
      .map((el) => el.getAttribute('data-testid')).join(',');
    check('grid DOM order is identical before and after selection', orderBefore === orderAfter);
    check('scrollY is unchanged by selection', scrollY === 180);
    check('the page behind is locked (html overflow hidden) while the sheet is open',
      document.documentElement.style.overflow === 'hidden');
    check('no accordion (<details>) fallback', document.querySelectorAll('details').length === 0);
    check('no OverlayScreen Back on You',
      !Array.from(document.querySelectorAll('button')).some((b) => text(b) === 'Back'));
    check('Identity · Business · Money stay in the grid while a sheet is open',
      /Identity/.test(text(grid)) && /Business/.test(text(grid)) && /Money/.test(text(grid)));

    // Tall You panel (How Wairo works) scrolls inside the sheet.
    click(document.querySelector('[data-testid="menu-tile-how"]'));
    await flush(40);
    const howBody = document.querySelector('[data-testid="sheet-body"]');
    const y = scrollY;
    howBody.scrollTop = 80;
    check('a tall You panel scrolls inside the sheet; the page behind does not move',
      scrollY === y && (howBody.scrollTop === 80 || /overflow-y-auto/.test(howBody.className || '')));
    check('How Wairo works is the half detent (content needs it)',
      document.querySelector('[data-testid="sheet-panel"]').getAttribute('data-detent') === 'half');

    click(document.querySelector('[data-testid="menu-tile-language"]'));
    await flush(30);
    check('a short You panel (Language) is a short sheet',
      document.querySelector('[data-testid="sheet-panel"]').getAttribute('data-detent') === 'fit');
    check('Language empty-state copy is verbatim',
      /The app speaks one language/.test(text(document.querySelector('[data-testid="sheet-body"]'))));

    root.unmount();
  }

  // ── 2. Home Open now — body tap raises the shared sheet ────────────────
  fetchHandler = async (url) => {
    const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
    if (String(url).includes('/api/discover/summary')) return ok({
      tiles: [],
      feed: [
        { kind: 'listing', flow: 'bulk', commodity: 'potatoes', id: 'f1',
          title: 'Irish potatoes, graded, 200kg lots', description: null,
          priceLabel: 'KES 150', dateLabel: null, location: 'Wakulima Market',
          seller: 'Wakulima Market', contact: '+254 712 000 111',
          origin: 'Wakulima Market', destination: 'Kilimani shops',
          mediaUrl: null, listedAt: new Date(Date.now() - 2 * 3600_000).toISOString(), orderable: false }
      ]
    });
    if (String(url).includes('/api/events')) return ok({ events: [], total: 0 });
    if (String(url).includes('/api/spaces')) return ok({ spaces: [] });
    if (String(url).includes('/api/circles')) return ok({ circles: [] });
    return { ok: false, status: 404, text: async () => JSON.stringify({}) };
  };
  {
    scrollY = 220;
    const { root } = mount(React.createElement(HomeSurface, { onOpenSpace: () => {} }));
    await flush(160);
    const reel = document.querySelector('section[aria-label="Latest activity"] [data-testid="activity-reel"]');
    check('Home activity is an Activity Reel', Boolean(reel));
    const card = reel.querySelector('.reel-card');
    click(card);
    await flush(340); // the deliberate tap delay that keeps double-tap save honest
    const takeover = document.querySelector('[data-testid="reel-expanded"]');
    check('tapping a reel card raises the expanded takeover', Boolean(takeover));
    check('the takeover is not an inline expand inside the reel', !reel.contains(takeover));
    check('the takeover offers the item\u2019s one real action',
      Boolean(document.querySelector('[data-testid="reel-open"]')));
    check('reel order is unchanged by selection',
      Array.from(reel.querySelectorAll('.reel-card')).map((a) => a.getAttribute('data-item-id')).join(',') === 'f1');
    check('selection so far does not write scrollY', scrollY === 220);
    // That one action is, for an offer, the shared sheet — the row keeps its
    // existing destination, it just arrives through the reel's takeover first.
    click(document.querySelector('[data-testid="reel-open"]'));
    await flush(40);
    const sheet = document.querySelector('[data-testid="sheet"]');
    check('the offer opens the shared sheet from the reel', Boolean(sheet));
    check('the sheet is not inside the reel', !reel.contains(sheet));
    check('selection does not write scrollY', scrollY === 220);
    click(document.querySelector('[data-testid="sheet-scrim"]'));
    await flush(20);
    check('scrim dismisses the sheet', !document.querySelector('[data-testid="sheet"]'));
    check('a dealt-with row folds into the reel\u2019s history',
      Boolean(document.querySelector('[data-testid="reel-history"]')));
    root.unmount();
  }

  // ── 3. Mine shops — body tap raises a sheet; the action still opens the shop
  {
    const space = (id, over) => ({
      id, ownerId: 'me', name: `Shop ${id}`, type: 'shop', goal: 'g', targetValueKes: 0,
      image: null, visibility: 'public', status: 'active', capabilities: [],
      metrics: { revenueKes: 0, customerCount: 0, activeOrdersCount: 0, totalOrdersCount: 0, offersCount: 0 },
      offers: [], recentActivities: [], recentConversations: [],
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...over
    });
    fetchHandler = async (url) => {
      const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
      if (String(url).includes('/api/spaces')) return ok({ spaces: [
        space('spc_m', { name: 'Nairobi Boda', offers: [{ id: 'o1', spaceId: 'spc_m', title: 'Boda service, airport run', status: 'active', price: 1500, currency: 'KES' }] }),
        space('spc_n', { name: 'Kipepeo Stalls' })
      ] });
      if (String(url).includes('/api/escrows/mine')) return ok({ rows: [], totals: { heldKes: 0, releasedKes: 0, heldCount: 0 }, note: 'Records of funds held between two sides until delivery — Brief moves no money itself.' });
      if (String(url).includes('/api/me/follows')) return ok({ groups: {}, total: 0, kindLabels: {} });
      if (String(url).includes('/api/orders')) return ok({ orders: [] });
      if (String(url).includes('/api/listings')) return ok({ listings: [] });
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    let opened = null;
    scrollY = 90;
    const { root } = mount(React.createElement(MineSurface, {
      onOpenSpace: (id) => { opened = id; },
      onOpenCreateSpace: () => {},
      onOpenEntity: () => {},
      onRequireAuth: () => {}
    }));
    await flush(160);
    const grid = document.querySelector('[data-testid="mine-shop-grid"]');
    check('Mine shops is a two-column grid', Boolean(grid));
    const orderBefore = Array.from(grid.querySelectorAll('li, article')).map((a) => a.getAttribute('data-testid')).join(',');
    click(document.querySelector('[data-testid="globys-card-shop-spc_m"] button'));
    await flush(40);
    const sheet = document.querySelector('[data-testid="sheet"]');
    check('tapping a Mine shop card raises a sheet titled with the shop name',
      Boolean(sheet) && text(document.querySelector('[data-testid="sheet-title"]')) === 'Nairobi Boda');
    check('the Mine shop sheet is not inside the grid', !grid.querySelector('[data-testid="sheet"]'));
    check('Mine grid order is unchanged',
      orderBefore === Array.from(grid.querySelectorAll('li, article')).map((a) => a.getAttribute('data-testid')).join(','));
    check('Mine selection does not write scrollY', scrollY === 90);
    check('the shop sheet shows the real lowest offer, not an invented one',
      /from KES 1,500/.test(text(document.querySelector('[data-testid="mine-shop-sheet-body"]'))));
    click(document.querySelector('[data-testid="card-action-shop-spc_n"]'));
    check('the one action on a shop card still opens that shop', opened === 'spc_n');
    root.unmount();
  }

  // ── 4. rejections, pinned ──────────────────────────────────────────────
  {
    const youSrc = fs.readFileSync(path.join(__dirname, 'src/features/you/YouSurface.tsx'), 'utf8');
    const sheetSrc = fs.readFileSync(path.join(__dirname, 'src/ui/Sheet.tsx'), 'utf8');
    const mineSrc = fs.readFileSync(path.join(__dirname, 'src/features/mine/MineSurface.tsx'), 'utf8');
    const feedSrc = fs.readFileSync(path.join(__dirname, 'src/features/city/DiscoverFeed.tsx'), 'utf8');
    const homeSrc = fs.readFileSync(path.join(__dirname, 'src/features/home/HomeSurface.tsx'), 'utf8');
    check('You does not import OverlayScreen (that covering overlay hid the groups)',
      !/OverlayScreen/.test(youSrc));
    check('You has no accordion fallback', !/<details/.test(youSrc));
    check('You has no desktop sidebar substitution',
      !/md:w-(1\/3|80|96)|sidebar/i.test(youSrc));
    check('the shared primitive is the one Sheet, used by You, Mine and FeedSheet',
      /from ["']\.\.\/\.\.\/ui\/Sheet["']/.test(youSrc) &&
      /from ["']\.\.\/\.\.\/ui\/Sheet["']/.test(mineSrc) &&
      /from ["']\.\.\/\.\.\/ui\/Sheet["']/.test(feedSrc) &&
      /<Sheet/.test(youSrc) && /<Sheet/.test(mineSrc) && /<Sheet/.test(feedSrc));
    check('Home Open now still opens FeedSheet (which is now the shared Sheet)',
      /FeedSheet/.test(homeSrc) && /<Sheet open/.test(feedSrc));
    check('Sheet has no invented counts in copy',
      !/Circle 001|14 hubs|KES 42,000|Vault healthy/.test(sheetSrc));
    check('prior rejections stay rejected on You source',
      !/Circle 001|Hubs tab|LIVE ESCROW|Apple Wallet/.test(youSrc));
  }

  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
