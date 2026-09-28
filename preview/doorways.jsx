// ---------------------------------------------------------------------------
// DOORWAYS — the mall's floor plan, and the one action that is not a door.
//
// The bar is Home · Market · Trade · Shop · You, plus one action ([+]).
//
// What this suite used to pin, and why the pin moved: the bar was
// Home · Selling · Spaces · You, and the assertions below proved that the board
// (`#city`), the demand desk (`#requests`), the supply shelf (`#supply`) and the
// work desks were *not* doors. That was the IA of a seller dashboard with a
// drawer bolted on. The restructure puts the two things people come to the
// avenue for — the market and the deal — on the bar, merges the two doors that
// both resolved to one screen with a different pre-selected section, and keeps
// the drawer as the directory of everything else.
//
// What has NOT moved: the honesty of an unlit door. A screen that is not a
// destination still lights nothing, and a directory row that opens nothing is
// still a hard failure (check 3).
//
//   1. the bar is exactly five destinations + one action, in the mall's order;
//   2. Pulse, Partners, Workforce and Elevate are rooms, not doors; the wings
//      that ARE doors light from every legacy address that resolves into them;
//   3. the directory carries every secondary destination, its rows all resolve,
//      and Pulse is one of them;
//   4. Home is the atrium: the operational read first, then the doors of the
//      building and the board's own rows, with unavailable states said out loud;
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
const { Navigation, BOTTOM_BAR_ITEMS, DOOR_HASH, doorFor } = require('./src/app/Navigation.tsx');
const { NavSheet, SHEET_GROUPS } = require('./src/app/NavSheet.tsx');
const { CreateSheet, CREATE_ACTIONS } = require('./src/app/CreateSheet.tsx');
const { SellerHome } = require('./src/features/home/SellerHome.tsx');
const { TRADE_SECTIONS } = require('./src/features/trade/TradeDesk.tsx');
const { SURFACE_KEYS, TAB_HASH } = require('./src/app/surfaces.ts');

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
  // ── 1. THE BAR: five doors, one action ──────────────────────────────────
  {
    const destinations = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination');
    const actions = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'action');
    check('the bar has exactly five destinations', destinations.length === 5);
    check('and exactly one action', actions.length === 1);
    check('the doors are Home · Market · Trade · Shop · You, in that order',
      destinations.map((d) => d.label).join('·') === 'Home·Market·Trade·Shop·You');
    check('every door writes a hash the shell resolves',
      destinations.every((d) => Boolean(DOOR_HASH[d.id]) && Boolean(TAB_HASH[DOOR_HASH[d.id]])));
    check('the one action is the create', actions[0].id === 'create');

    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'home', onSelectTab: () => {} }));
    const doors = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]'));
    const actionsRendered = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[aria-haspopup="dialog"]'));
    check('the rendered bar has five destination buttons', doors.length === 5);
    check('and one action button, marked as opening a dialog', actionsRendered.length === 1);
    root.unmount(); host.remove();
  }

  // ── 2. ROOMS ARE NOT DOORS; WINGS LIGHT FROM THEIR LEGACY ADDRESSES ─────
  {
    check('no bar item is Pulse', !BOTTOM_BAR_ITEMS.some((i) => /pulse/i.test(i.label)));
    check('the secondary desks are not doors either (they are directory rows)',
      doorFor('partners') === null && doorFor('workforce') === null && doorFor('pulse') === null);
    check('the legacy activity tab is not a door (it is the directory’s check-in)', doorFor('activity') === null);
    check('the board lights the Market door', doorFor('city') === 'market' && doorFor('market') === 'market');
    check('demand and supply light the Trade door', doorFor('requests') === 'trade' && doorFor('supply') === 'trade' && doorFor('trade') === 'trade');
    check('the shop sections light one door, not two',
      doorFor('mine') === 'duka' && doorFor('spaces') === 'duka' && doorFor('ledger') === 'duka' && doorFor('catalog') === 'duka');

    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'pulse', onSelectTab: () => {} }));
    check('and nothing in the rendered bar lights while Pulse is open',
      Array.from(host.querySelectorAll('button[role="tab"]')).every((b) => b.getAttribute('aria-selected') !== 'true'));
    root.unmount(); host.remove();

    const { host: mHost, root: mRoot } = await mount(React.createElement(Navigation, { activeTab: 'requests', onSelectTab: () => {} }));
    const lit = Array.from(mHost.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]')).filter((b) => b.getAttribute('aria-selected') === 'true');
    check('opening demand from a legacy address lights the Trade door', lit.length === 1 && lit[0].getAttribute('data-door') === 'trade');
    mRoot.unmount(); mHost.remove();
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

  // ── 4. HOME: THE ATRIUM ─────────────────────────────────────────────────
  {
    const { host, root } = await mount(React.createElement(SellerHome, {
      onOpenSpace: () => {}, onOpenSelling: () => {}, onOpenSpaces: () => {},
      onCreateSpace: () => {}, onExplore: () => {}, onOpenWorkforce: () => {}
    }));
    check('Home opens on the operational question', text(host).includes('What needs your attention today?'));
    check('the seller workspace is the primary Home surface', Boolean(host.querySelector('[data-testid="seller-home"]')));
    check('an offline read is said out loud', Boolean(host.querySelector('[role="alert"]')));
    check('unavailable activity is a dash, not a sample zero',
      host.querySelector('[data-testid="metric-orders-value"]')?.textContent === '—' &&
      host.querySelector('[data-testid="metric-marked-in-value"]')?.textContent === '—');
    check('the operational page does not mount a discovery promo video', host.querySelector('video') === null);

    const shelves = Array.from(host.querySelectorAll('[data-shelf]'));
    check('the atrium carries the doors shelf and the board’s own shelf',
      shelves.length === 2 && shelves[0].getAttribute('data-shelf') === 'doors' && shelves[1].getAttribute('data-shelf') === 'moving');
    const doorIds = Array.from(host.querySelectorAll('[data-door-id]')).map((d) => d.getAttribute('data-door-id'));
    check('the shelf holds the wings, market and trade first',
      doorIds.length >= 10 && doorIds[0] === 'market' && doorIds[1] === 'trade');
    check('every wing the restructure promised a door to has one',
      ['market', 'trade', 'demand', 'groupbuys', 'events', 'circles', 'errands', 'bulk', 'shops', 'work', 'track', 'food', 'reviews']
        .filter((id) => !doorIds.includes(id)).length === 0);
    check('an unreadable board paints no placeholder cards',
      text(host).includes('could not be read') && host.querySelectorAll('[data-testid="activity-reel-item"]').length === 0);
    check('group buys are reachable from Home, not only from a typed hash',
      doorIds.includes('groupbuys'));
    root.unmount(); host.remove();
  }

  // ── 5. THE FLOOR, THE GAP AND THE VERBS ─────────────────────────────────
  {
    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'home', onSelectTab: () => {} }));
    const bar = host.querySelector('nav[aria-label="Primary"]');
    // jsdom has no layout engine: the geometry is asserted on the classes that
    // produce it (fixed + bottom-0) and the one inline height the bar sets.
    check('the bar is fixed', bar.className.includes('fixed'));
    check('and anchored to the bottom edge', bar.className.includes('bottom-0'));
    check('at 56px, a floor and not a hover', bar.style.height === '56px');
    check('not a floating pill: no rounded-full bar, no lifted shadow class',
      !bar.className.includes('rounded-full') && !/lift-4|shadow-2xl/.test(bar.className));
    check('six slots in a row is still one row of square-enough targets',
      host.querySelectorAll('nav[aria-label="Primary"] > button').length === 6);
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
