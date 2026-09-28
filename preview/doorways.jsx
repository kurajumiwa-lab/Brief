// ---------------------------------------------------------------------------
// DOORWAYS — the seller-workspace navigation and its global creation action.
//
// The bar is Home · Selling · Spaces · You, plus one action ([+]). The board
// and other rooms remain reachable without being duplicated as primary tabs.
// This suite pins the destinations, the drawer's check-in, and the fixed mobile
// floor so the IA stays legible on a phone.
//
//   1. the bar is exactly four destinations + one action;
//   2. Pulse is NOT a door in the bar;
//   3. Pulse IS reachable from the drawer, and picking it goes to the
//      pulse tab;
//   4. Home is the operational seller dashboard, with its live reads and
//      actionable states ahead of secondary discovery;
//   5. the bar is a solid anchored floor (fixed, bottom-0, 56px, no floating
//      pill), and the drawer stops above it.
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
const { Navigation, BOTTOM_BAR_ITEMS, doorFor } = require('./src/app/Navigation.tsx');
const { NavSheet, SHEET_GROUPS } = require('./src/app/NavSheet.tsx');
const { CreateSheet, CREATE_ACTIONS } = require('./src/app/CreateSheet.tsx');
const { SellerHome } = require('./src/features/home/SellerHome.tsx');

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
  // ── 1. THE BAR: four destinations, one action ───────────────────────────
  {
    const destinations = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'destination');
    const actions = BOTTOM_BAR_ITEMS.filter((i) => i.type === 'action');
    check('the bar has exactly four destinations', destinations.length === 4);
    check('and exactly one action', actions.length === 1);
    check('the doors are Home · Selling · Spaces · You, in that order',
      destinations.map((d) => d.label).join('·') === 'Home·Selling·Spaces·You');
    check('the one action is the create', actions[0].id === 'create');

    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'home', onSelectTab: () => {} }));
    const doors = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]'));
    const actionsRendered = Array.from(host.querySelectorAll('nav[aria-label="Primary"] button[aria-haspopup="dialog"]'));
    check('the rendered bar has four destination buttons', doors.length === 4);
    check('and one action button, marked as opening a dialog', actionsRendered.length === 1);
    root.unmount(); host.remove();
  }

  // ── 2. PULSE IS NOT A DOOR ──────────────────────────────────────────────
  {
    check('no bar item is Pulse', !BOTTOM_BAR_ITEMS.some((i) => /pulse/i.test(i.label)));
    check('a room is not a door either (the board, the supply shelf, the work desks)',
      doorFor('city') === null && doorFor('supply') === null && doorFor('requests') === null && doorFor('partners') === null);
    check('the legacy activity tab is not a door (it is the drawer’s check-in)', doorFor('activity') === null);
    const { host, root } = await mount(React.createElement(Navigation, { activeTab: 'pulse', onSelectTab: () => {} }));
    check('and nothing in the rendered bar lights while Pulse is open',
      Array.from(host.querySelectorAll('button[role="tab"]')).every((b) => b.getAttribute('aria-selected') !== 'true'));
    root.unmount(); host.remove();
  }

  // ── 3. PULSE IS REACHABLE FROM THE DRAWER ───────────────────────────────
  {
    const pulse = SHEET_GROUPS.flatMap((g) => g.items).find((i) => i.label === 'Pulse');
    check('the drawer carries a Pulse entry', Boolean(pulse));
    check('it sits in the first group of the drawer', SHEET_GROUPS[0].items.some((i) => i.label === 'Pulse'));
    check('and it goes to the pulse tab', pulse.target.kind === 'tab' && pulse.target.tab === 'pulse');

    let went = null;
    const { host, root } = await mount(React.createElement(NavSheet, {
      open: true, onClose: () => {}, place: '', onSetPlace: () => {},
      onGo: (t) => { went = t; }
    }));
    const btn = Array.from(host.querySelectorAll('button')).find((b) => text(b).startsWith('Pulse'));
    check('the entry is tappable in the rendered drawer', Boolean(btn));
    await act(async () => { btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true })); });
    check('and tapping it goes to the pulse tab', JSON.stringify(went) === JSON.stringify({ kind: 'tab', tab: 'pulse' }));
    root.unmount(); host.remove();
  }

  // ── 4. HOME: operational first, unavailable rather than fabricated ─────
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
    root.unmount(); host.remove();
  }

  // ── 5. THE FLOOR AND THE GAP ────────────────────────────────────────────
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
    root.unmount(); host.remove();

    const { host: sHost, root: sRoot } = await mount(React.createElement(NavSheet, {
      open: true, onClose: () => {}, place: '', onSetPlace: () => {}, onGo: () => {}
    }));
    const panel = sHost.querySelector('[data-testid="nav-sheet-panel"]');
    check('the drawer is a panel, and it stops above the 56px bar on a phone',
      Boolean(panel) && panel.className.includes('bottom-14') && panel.className.includes('md:bottom-0'));
    sRoot.unmount(); sHost.remove();

    // The create sheet opens real flows, with commerce actions first.
    const { host: cHost, root: cRoot } = await mount(React.createElement(CreateSheet, { open: true, onClose: () => {}, onPick: () => {} }));
    const rows = Array.from(cHost.querySelectorAll('button')).filter((b) => /Create a space|Post an offer|Create work|Host a party or trip|Start a run|Post an errand/.test(text(b)));
    check('the create sheet has six real creation actions', rows.length === 6);
    check('Spaces and offers lead, followed by the existing work and event flows',
      rows[0].textContent.includes('Create a space') && rows[1].textContent.includes('Post an offer') && rows[2].textContent.includes('Create work')
      && rows[3].textContent.includes('Host a party or trip') && rows[4].textContent.includes('Start a run') && rows[5].textContent.includes('Post an errand'));
    cRoot.unmount(); cHost.remove();
  }

  console.log(`\nPASSED ${passed} / FAILED ${failed}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
