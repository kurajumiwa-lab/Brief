// ---------------------------------------------------------------------------
// DOORWAYS — the mall's floor plan, and the one action that is not a door.
//
// The bar is Market · Shops · Trade · You, plus one action ([+]).
//
// What this suite used to pin, and why the pin moved (twice): the bar was
// Home · Selling · Spaces · You, then Home · Market · Trade · Shop · You. The
// second map still opened on a Home atrium that mostly pointed at the market,
// and kept a separate Shop door for the same person's business. Now the market
// IS the first page — a cold load lands on the board — and the Home slot became
// the Shops door, which opens on the one thing the atrium held that a seller
// came back for: the read of what needs attention today. Two doors for one
// person's business became one.
//
// What has NOT moved: the honesty of an unlit door. A screen that is not a
// destination still lights nothing, a directory row that opens nothing is
// still a hard failure (check 3), and every legacy address (`#home`, `#duka`,
// `#spaces`, `#mine`) still lights the door that owns it now.
//
//   1. the bar is exactly four destinations + one action, market first;
//   2. Pulse, Partners, Workforce and Elevate are rooms, not doors; the wings
//      that ARE doors light from every legacy address that resolves into them,
//      and `#home` lights the market;
//   3. the directory carries every secondary destination, its rows all resolve,
//      and Pulse is one of them;
//   4. Shops opens on the operational read: the attention question first, the
//      metrics as dashes when the reads fail, the failure said out loud — and
//      the retired atrium still holds its own discipline while it stays in the
//      tree;
//   5. the bar is a solid anchored floor (fixed, bottom-0, 56px, no floating
//      pill), the directory stops above it, and the create sheet holds eight
//      real verbs with demand first.
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
const { Navigation, BOTTOM_BAR_ITEMS, DOOR_HASH, FIRST_DOOR, doorFor } = require('./src/app/Navigation.tsx');
const { NavSheet, SHEET_GROUPS } = require('./src/app/NavSheet.tsx');
const { CreateSheet, CREATE_ACTIONS } = require('./src/app/CreateSheet.tsx');
const { SellerHome } = require('./src/features/home/SellerHome.tsx');
const { MineSurface } = require('./src/features/mine/MineSurface.tsx');
const { AttentionStrip, deriveAttentionItems } = require('./src/features/home/AttentionStrip.tsx');
const { TRADE_SECTIONS } = require('./src/features/trade/TradeDesk.tsx');
const { SURFACE_KEYS, TAB_HASH, HASH_ALIAS, resolveTabHash, backLabel } = require('./src/app/surfaces.ts');

let passed = 0;
let failed = 0;
const check = (name, cond) => {
  if (cond) { passed++; console.log('PASS ' + name); }
  else { failed++; console.log('FAIL ' + name); }
};
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();

// The business APIs are offline for this suite: the dashboard must show an
// unavailable state, not a successful empty shop or a set of made-up numbers.
global.fetch = async () => ({ ok: false, status: 503, text: async () => JSON.stringify({ error: 'offline for the suite' }) });

async function mount(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await flush();
  return { host, root };
}

async function main() {
  // ── 1. THE BAR: four doors, one action, market first ────────────────────
  {
    const destinations = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination');
    const actions = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'action');
    check('the bar has exactly four destinations', destinations.length === 4);
    check('and exactly one action', actions.length === 1);
    check('the doors are Market · Shops · Trade · You, in that order',
      destinations.map((d) => d.label).join('·') === 'Market·Shops·Trade·You');
    check('the market is the first door, and the first page',
      destinations[0].id === 'market' && FIRST_DOOR === 'market' && resolveTabHash('') === null && HASH_ALIAS.home === 'market');
    check('there is no Home door and no second door for the same business',
      !destinations.some((d) => /^(home|shop)$/i.test(d.label)) && destinations.filter((d) => doorFor(d.id) === 'shops').length === 1);
    check('every door writes a hash the shell resolves',
      destinations.every((d) => Boolean(DOOR_HASH[d.id]) && Boolean(TAB_HASH[DOOR_HASH[d.id]])));
    check('the Shops door keeps the counter\'s own signage', destinations.find((d) => d.id === 'shops').kicker === 'Duka');
    check('the one action is the create', actions[0].id === 'create');

    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'market', onSelectTab: () => {} }));
    const doors = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]'));
    const actionsRendered = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[aria-haspopup="dialog"]'));
    check('the rendered bar has four destination buttons', doors.length === 4);
    check('and one action button, marked as opening a dialog', actionsRendered.length === 1);
    check('the first rendered door is the market', doors[0].getAttribute('data-door') === 'market');
    root.unmount(); host.remove();
  }

  // ── 2. ROOMS ARE NOT DOORS; WINGS LIGHT FROM THEIR LEGACY ADDRESSES ─────
  {
    check('no bar item is Pulse', !BOTTOM_BAR_ITEMS.some((i) => /pulse/i.test(i.label)));
    check('the secondary desks are not doors either (they are directory rows)',
      doorFor('partners') === null && doorFor('workforce') === null && doorFor('pulse') === null);
    check('the legacy activity tab is not a door (it is the directory’s check-in)', doorFor('activity') === null);
    check('the board lights the Market door', doorFor('city') === 'market' && doorFor('market') === 'market');
    check('the atrium\'s old address lights the Market door too — it is the first page now',
      doorFor('home') === 'market' && resolveTabHash('#home') === 'market' && backLabel('home') === 'the market');
    check('demand and supply light the Trade door', doorFor('requests') === 'trade' && doorFor('supply') === 'trade' && doorFor('trade') === 'trade');
    check('the shop sections light one door, not two',
      doorFor('shops') === 'shops' && doorFor('mine') === 'shops' && doorFor('duka') === 'shops' && doorFor('spaces') === 'shops' && doorFor('ledger') === 'shops' && doorFor('catalog') === 'shops');
    check('every legacy shop address resolves to the Shops door',
      ['duka', 'spaces', 'mine', 'selling', 'orders', 'pipeline', 'catalog', 'ledger', 'shopbrief'].every((h) => resolveTabHash(h) === 'shops'));
    check('the market\'s own shops room keeps its address; the bare #shops is the door',
      resolveTabHash('#shops') === 'shops' && resolveTabHash('#market/shops') === 'market');
    check('a step back from a shop section is named for the section',
      backLabel('shops/selling') === 'Selling' && backLabel('spaces/orders') === 'Selling' && backLabel('shops') === 'your shops');

    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'pulse', onSelectTab: () => {} }));
    check('and nothing in the rendered bar lights while Pulse is open',
      Array.from(host.querySelectorAll('button[role="tab"]')).every((b) => b.getAttribute('aria-selected') !== 'true'));
    root.unmount(); host.remove();

    const { host: mHost, root: mRoot } = await mount(React.createElement(Navigation, { activeTab: 'requests', onSelectTab: () => {} }));
    const lit = Array.from(mHost.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]')).filter((b) => b.getAttribute('aria-selected') === 'true');
    check('opening demand from a legacy address lights the Trade door', lit.length === 1 && lit[0].getAttribute('data-door') === 'trade');
    mRoot.unmount(); mHost.remove();

    const { host: sHost, root: sRoot } = await mount(React.createElement(Navigation, { activeTab: 'mine', onSelectTab: () => {} }));
    const litShops = Array.from(sHost.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]')).filter((b) => b.getAttribute('aria-selected') === 'true');
    check('the legacy mine tab lights the Shops door', litShops.length === 1 && litShops[0].getAttribute('data-door') === 'shops');
    sRoot.unmount(); sHost.remove();
  }

  // ── 3. THE DIRECTORY CARRIES EVERY SECONDARY DESTINATION ────────────────
  {
    const items = SHEET_GROUPS.flatMap((g) => g.items);
    const pulse = items.find((i) => i.label === 'Pulse');
    check('the directory carries a Pulse entry', Boolean(pulse));
    check('it sits in the first group of the directory', SHEET_GROUPS[0].items.some((i) => i.label === 'Pulse'));
    check('and it goes to the pulse tab', pulse && pulse.target.kind === 'tab' && pulse.target.tab === 'pulse');

    // The rule the whole file exists for: no row that opens nothing.
    const dead = items.filter((i) => !i.target && !i.href);
    check('no directory row is a dead end', dead.length === 0, dead.map((i) => i.id).join(','));
    const tradeRows = items.filter((i) => i.target && i.target.kind === 'trade');
    check('every trade row names a section the desk has',
      tradeRows.length > 0 && tradeRows.every((i) => TRADE_SECTIONS.some((s) => s.id === i.target.section)));
    const youRows = items.filter((i) => i.target && i.target.kind === 'you');
    check('the directory reaches the You shelves too', youRows.length >= 5);
    check('and the three standalone pages are real links, not fake buttons',
      ['track', 'reviews', 'cloudbites'].every((p) => items.some((i) => (i.href || '').endsWith(p))));
    check('a surface row names a surface the shell opens',
      items.every((i) => !i.target || i.target.kind !== 'surface' || SURFACE_KEYS.includes(i.target.surface)));

    let went = null;
    const { host, root } = await mount(React.createElement(NavSheet, {
      open: true, onClose: () => {}, place: '', onSetPlace: () => {},
      onGo: (t) => { went = t; }
    }));
    const btn = Array.from(host.querySelectorAll('button')).find((b) => text(b).includes('Pulse'));
    check('the entry is tappable in the rendered directory', Boolean(btn));
    await act(async () => { btn && btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    check('and tapping it goes to the pulse tab', JSON.stringify(went) === JSON.stringify({ kind: 'tab', tab: 'pulse' }));
    const links = Array.from(host.querySelectorAll('a.mall-index__row'));
    check('the standalone pages render as links with real hrefs',
      links.length >= 3 && links.every((a) => /^\/[a-z/]+$/.test(a.getAttribute('href'))));
    root.unmount(); host.remove();
  }

  // ── 4. SHOPS OPENS ON THE OPERATIONAL READ ──────────────────────────────
  {
    const { host, root } = await mount(React.createElement(MineSurface, {
      onOpenSpace: () => {}, onOpenCreateSpace: () => {}, onOpenEntity: () => {}, onRequireAuth: () => {}
    }));
    check('Shops opens on the operational question', text(host).includes('What needs your attention today?'));
    const strip = host.querySelector('[data-testid="attention-strip"]');
    check('the attention read is mounted on the Shops door', Boolean(strip));
    check('and it sits above the list of shops',
      Boolean(strip) && Boolean(host.querySelector('[aria-label="Your shops"]'))
      && Boolean(strip.compareDocumentPosition(host.querySelector('[aria-label="Your shops"]')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING));
    check('an offline read is said out loud', Boolean(strip && strip.querySelector('[role="alert"]')));
    check('unavailable activity is a dash, not a sample zero',
      host.querySelector('[data-testid="metric-orders-value"]')?.textContent === '—' &&
      host.querySelector('[data-testid="metric-marked-in-value"]')?.textContent === '—' &&
      host.querySelector('[data-testid="metric-inquiries-value"]')?.textContent === '—');
    check('a failed shops read below it is a retry, never an empty stall',
      text(host).includes('could not be read just now') && !/No spaces yet/.test(text(host)));
    check('the operational page does not mount a discovery promo video', host.querySelector('video') === null);
    check('the doors shelf did not come along — the bar and the directory are the floor plan now',
      host.querySelectorAll('[data-shelf]').length === 0);
    root.unmount(); host.remove();

    // The read's rules, without a DOM: nothing waiting means nothing listed,
    // and each kind of waiting is one row with a real action.
    const noop = { onOpenSpace: () => {}, onOpenSelling: () => {}, onOpenTrade: () => {} };
    const quiet = deriveAttentionItems({ activeSpaces: [], inboxCount: 0, openOrders: 0, agedOrders: 0, draftOffers: 0, flags: [], openGaps: 0 }, noop);
    check('a quiet read lists nothing', quiet.length === 0);
    const unread = deriveAttentionItems({ activeSpaces: [], inboxCount: null, openOrders: null, agedOrders: null, draftOffers: null, flags: [], openGaps: 0 }, noop);
    check('an unreadable read invents nothing either', unread.length === 0);
    let opened = null;
    const busy = deriveAttentionItems({
      activeSpaces: [{ id: 'spc_a', name: 'Counter A', status: 'active', metrics: { inquiriesAwaitingReply: 2 } }],
      inboxCount: 2, openOrders: 3, agedOrders: 1, draftOffers: 1,
      flags: [{ id: 'f1', kind: 'other', message: 'A record to check', detail: 'why', spaceId: 'spc_a', action: { label: 'Open', surface: 'ledger' } }],
      openGaps: 4
    }, { ...noop, onOpenSpace: (id, tab) => { opened = [id, tab]; } });
    check('each kind of waiting is one row', busy.map((i) => i.id).join(',') === 'inquiries,orders,draft-offers,brief-f1,open-demand');
    busy[0].onOpen();
    check('the inbox row opens the exact Space pipeline', JSON.stringify(opened) === JSON.stringify(['spc_a', 'pipeline']));
    busy[3].onOpen();
    check('a brief flag opens the Space at the surface it names', JSON.stringify(opened) === JSON.stringify(['spc_a', 'ledger']));
    check('aged orders are named as older, not as new', /older order/.test(busy[1].title));

    // The strip on its own, wired to a host: the trade row writes the desk's hash
    // when no host handler is given, so it is never a dead button.
    const { host: aHost, root: aRoot } = await mount(React.createElement(AttentionStrip, { onOpenSpace: () => {}, onOpenSelling: () => {} }));
    check('the strip stands alone and still says what it could not read',
      Boolean(aHost.querySelector('[data-testid="attention-strip"] [role="alert"]')) && /Try again/.test(text(aHost)));
    aRoot.unmount(); aHost.remove();

    // The retired atrium stays in the tree (its own suites still pin it) and
    // keeps its discipline; what changed is that no door opens it.
    const { host: hHost, root: hRoot } = await mount(React.createElement(SellerHome, {
      onOpenSpace: () => {}, onOpenSelling: () => {}, onOpenSpaces: () => {},
      onCreateSpace: () => {}, onExplore: () => {}, onOpenWorkforce: () => {}
    }));
    check('the atrium, unmounted from the shell, still reports an offline read', Boolean(hHost.querySelector('[role="alert"]')));
    hRoot.unmount(); hHost.remove();
  }

  // ── 5. THE FLOOR, THE GAP AND THE VERBS ─────────────────────────────────
  {
    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'market', onSelectTab: () => {} }));
    const bar = host.querySelector('nav[aria-label="Primary"]');
    // jsdom has no layout engine: the geometry is asserted on the classes that
    // produce it (fixed + bottom-0) and the one inline height the bar sets.
    check('the bar is fixed', bar.className.includes('fixed'));
    check('and anchored to the bottom edge', bar.className.includes('bottom-0'));
    check('at 56px, a floor and not a hover', bar.style.height === '56px');
    check('not a floating pill: no rounded-full bar, no lifted shadow class',
      !bar.className.includes('rounded-full') && !/lift-4|shadow-2xl/.test(bar.className));
    check('five slots in a row: four doors and the action',
      host.querySelectorAll('nav[aria-label="Primary"] > button').length === 5);
    root.unmount(); host.remove();

    const { host: sHost, root: sRoot } = await mount(React.createElement(NavSheet, {
      open: true, onClose: () => {}, place: '', onSetPlace: () => {}, onGo: () => {}
    }));
    const panel = sHost.querySelector('[data-testid="nav-sheet-panel"]');
    check('the directory is a panel, and it stops above the 56px bar on a phone',
      Boolean(panel) && panel.className.includes('bottom-14') && panel.className.includes('md:bottom-0'));
    sRoot.unmount(); sHost.remove();

    // The create sheet opens real flows, and the loop's own entry point is first.
    const { host: cHost, root: cRoot } = await mount(React.createElement(CreateSheet, { open: true, onClose: () => {}, onPick: () => {} }));
    const rows = Array.from(cHost.querySelectorAll('button')).filter((b) => /Raise a request|Create a space|Post an offer|Create work|Host a party or trip|Start a run|Post an errand|Start a group buy/.test(text(b)));
    check('the create sheet has eight real creation actions', rows.length === 8 && CREATE_ACTIONS.length === 8);
    check('demand leads, then the shop and its offers, then the existing flows',
      rows[0].textContent.includes('Raise a request') && rows[1].textContent.includes('Create a space')
      && rows[2].textContent.includes('Post an offer') && rows[3].textContent.includes('Create work')
      && rows[4].textContent.includes('Host a party or trip') && rows[5].textContent.includes('Start a run')
      && rows[6].textContent.includes('Post an errand') && rows[7].textContent.includes('Start a group buy'));
    check('every verb in the data resolves to a handler id the shell answers',
      CREATE_ACTIONS.every((a) => ['request', 'space', 'offer', 'work', 'event', 'run', 'errand', 'groupbuy'].includes(a.id)));
    cRoot.unmount(); cHost.remove();
  }

  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
