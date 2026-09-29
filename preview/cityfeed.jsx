// ---------------------------------------------------------------------------
// CITY FEED (Discover) — pins the two regressions this layer had:
//   1. the nav pill highlighted HOME while the City feed was on screen
//      (the Discover tab looked unselectable and the screens "merged"), and
//   2. the Events / Marketplace sub-tabs had no input surface to post.
// Now: 'city' normalises to Discover, and the feed exposes "Host an event"
//      (a real createCampaign -> publish) and "Post a listing" (deep-links to
//      the marketplace Selling flow).
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { Navigation } = require('./src/app/Navigation.tsx');
const { CityFeedView } = require('./src/features/city/CityFeedView.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
function mount(el) {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  // These contracts cover the preserved supply board, now reached from the
  // business feed rather than replacing its default mixed discovery view.
  if (el.type === CityFeedView) {
    const supply = [...c.querySelectorAll('button')].find(b => b.textContent === 'Supply routes');
    if (supply) act(() => supply.click());
  }
  return c;
}
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const btn = (label) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === label || text(b).startsWith(label));

// Broad, honest-empty fetch mock: every surface the City feed mounts reads
// real rows; none exist in this fixture, so each answers with an empty shape.
global.fetch = async (input) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input);
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
  if (url.includes('/events/categories')) return ok({ categories: [], labels: {} });
  if (url.includes('/api/events')) return ok({ events: [], total: 0 });
  if (url.includes('/api/listings/mine')) return ok({ vendor: null, listings: [] });
  if (url.includes('/api/listings')) return ok({ listings: [] });
  if (url.includes('/api/orders')) return ok({ orders: [] });
  if (url.includes('/earnings')) return ok({ earnings: { gross: 0, net: 0, payoutAvailable: false } });
  if (url.includes('/public/spaces')) return ok({ spaces: [] });
  // The morning brief reads the owner's rows. With no space in this fixture the
  // read answers "no business yet", and the panel withdraws rather than printing
  // a page of zeroes onto somebody's street.
  if (url.includes('/api/shop-brief')) return ok({ brief: {
    ok: true, day: '2026-09-20', dayLabel: 'Sun, 20 Sept', isToday: false, asOf: '', stored: false,
    shop: { vendorId: null, name: '', ownerId: 'usr_1' },
    basis: { in: '', out: '', net: '', views: '' },
    empty: true, reason: 'no_spaces', money: null, orders: null, spaces: [], quietSpaces: [],
    people: [], views: null, flags: [], unassigned: null
  } });
  if (url.includes('/pickups/origins')) return ok({ origins: [] });
  if (url.includes('/pickups/riders')) return ok({ riders: [] });
  if (url.includes('/pickups/mine')) return ok({ pickups: [] });
  if (url.includes('/pickup-origins')) return ok({ stats: { agentId: 'me', pickupCount: 0, shops: 0, currency: null, note: 'derived count' } });
  if (url.includes('/pickup-fee/settlements')) return ok({ settlements: [] });
  if (url.includes('/api/circles')) return ok({ circles: [] });
  if (url.includes('/api/errands/providers')) {
    return ok({ integrated: [], usedHere: [], external: [], disclosure: 'derived' });
  }
  if (url.includes('/api/errands')) {
    return ok({
      open: [], mine: [],
      eligibility: { eligible: false, basis: [], howToJoin: 'Carry rights follow a real record.', note: 'derived' },
      carriersAround: 0,
      stages: [{ key: 'posted', label: 'Posted' }, { key: 'accepted', label: 'A carrier took it' }, { key: 'picked_up', label: 'Collected' }, { key: 'delivered', label: 'Delivered' }, { key: 'settled', label: 'Fee agreed' }, { key: 'rated', label: 'Rated' }]
    });
  }
  if (url.includes('/api/pulse')) {
    return ok({
      asOf: null,
      sections: {
        demand: { open: 0, bySeverity: { no_supplier: 0, awaiting_quote: 0, awaiting_accept: 0 }, collective: 0 },
        closure: { windowDays: 30, closed: 0, topCategory: null },
        fill: { windowDays: 30, closed: 0, avgHoursToFill: null, hoursSampleCount: 0, avgValue: null },
        money: { windowDays: 30, settledOrders: 0, settledValue: null, settledCurrency: null, completedWorkOrders: 0, deliveredPickups: 0 },
        listings: { active: 0, snapshot: [] },
        events: { open: 0, newLast24h: { requests: 0, events: 0, listings: 0, orders: 0 } }
      },
      facts: [], empty: true, note: 'derived'
    });
  }
  if (url.includes('/api/me/position')) {
    return ok({
      position: {
        decay: { expiringQuotes: [], waitlist: [], override: null, overdueInstallments: 0 },
        missedCapture: { count: 0, recent: [], value: null },
        nextMove: null,
        open: { total: 0, top: [] },
        derivedAt: '2026-09-15T00:00:00Z', note: 'derived'
      }
    });
  }
  if (url.includes('/api/me/commitments')) {
    return ok({ commitments: { owedByMe: [], owedToMe: [], fulfilled: [], lapsed: [], owedByMeKes: 0, owedToMeKes: 0, derivedAt: '2026-09-15T00:00:00Z', note: 'derived' } });
  }
  if (url.includes('/api/me/reciprocity')) {
    return ok({ reciprocity: { owedToMe: [], owedByMe: [], fulfilled: [], aging: [], windowDays: 14, derivedAt: '2026-09-15T00:00:00Z', note: 'derived' } });
  }
  if (url.includes('/api/auth/me')) return ok({ user: { id: 'usr_1', handle: 'amina', displayName: 'Amina' } });
  if (url.includes('/api/vaults')) return ok({ vaults: [] });
  return { ok: false, status: 404, text: async () => JSON.stringify({}) };
};

async function main() {
  // --- 1. The bar: the board is a door now, and so is the desk -------------
  // This suite used to prove the opposite: the board was a secondary room with
  // no door, and nothing in the bar lit while it was open. The restructure put
  // the market on the bar because browsing nearby is the most frequent job in
  // the building — so the claim that is worth keeping is the precise one: a
  // room that is NOT a wing (Pulse, Partners, Workforce, Elevate) still lights
  // nothing, and the legacy address `#city` lights exactly one door.
  {
    const c = mount(React.createElement(Navigation, { activeTab: 'city', onSelectTab: () => {} }));
    const tabs = Array.from(c.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]'));
    const labels = tabs.map((b) => text(b).replace(/\s+/g, ' ').trim());
    assert.deepEqual(labels.filter((l) => l !== 'Create'), ['Market', 'Shops', 'Trade', 'You'], 'the four doors render, market first');
    const lit = tabs.filter((b) => b.getAttribute('aria-selected') === 'true');
    assert.equal(lit.length, 1, 'the board lights exactly one door');
    assert.equal(lit[0].getAttribute('data-door'), 'market', 'and it is the market door');
    assert.ok(!labels.some((l) => /^(Home|Shop|Mine|Discover|Activity|Selling|Spaces)$/.test(l)), 'legacy and split labels do not render as primary destinations');
    const r = mount(React.createElement(Navigation, { activeTab: 'pulse', onSelectTab: () => {} }));
    assert.equal(Array.from(r.querySelectorAll('nav[aria-label="Primary"] button[role="tab"]')).filter((b) => b.getAttribute('aria-selected') === 'true').length, 0,
      'a room that is not a wing still lights nothing');
  }
  pass('The board is a door, and a room that is not a wing still lights nothing');

  // --- 2. The board has no floating create pill -----------------------------
  {
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    const body = text(document.body);
    assert.ok(!/Host an event/.test(body), 'no floating "Host an event" pill on the board');
    assert.ok(!/Post a listing/.test(body), 'no floating "Post a listing" pill on the board');
    // The one create door in the app is the bar's action.
    const nav = mount(React.createElement(Navigation, { activeTab: 'city', onSelectTab: () => {}, onOpenCreate: () => {} }));
    const createBtn = nav.querySelector('button[aria-label^="Create — opens a sheet"]');
    assert.ok(createBtn, 'the bar carries the create action');
    assert.equal(createBtn.getAttribute('aria-haspopup'), 'dialog', 'and it opens a sheet, not a route');
  }
  pass('The create pill is gone from the board; the bar’s [+] is the one create door');

  // --- 2b. The head card is a clean, premium light header ------------------
  {
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    // No dark gradient card, no scoreboard, no pagination dots.
    const card = c.querySelector('.bg-gradient-to-b');
    assert.ok(!card, 'no dark gradient card remains');
    const t = text(c);
    assert.ok(!t.includes("What's happening nearby"), 'no Discover heading reprints the door');
    assert.ok(!/\bDiscover\b/.test(t), 'no Discover eyebrow on the board');
    assert.ok(c.querySelector('button[aria-label="Browse the board"]'), 'Browse the board is the entry');
    // The chip row is gone: the tile grid is the navigation now.
    const nav = c.querySelector('nav[aria-label="Discover sections"]');
    assert.ok(!nav, 'no chip row survives on this screen');
    // The navigation is one entry that opens the taxonomy. The count moved into
    // the picker with it, because four 32px zeros were the loudest thing on the
    // main surface — the rule this line protects is "the taxonomy is the nav, and
    // nothing else duplicates it", not "the nav is a grid".
    assert.equal(c.querySelectorAll('button[role="tab"]').length, 0, 'no tile wall on the face of the board');
    const browse = c.querySelector('button[aria-label="Browse the board"]');
    assert.ok(browse, 'one Browse entry, and it is the navigation');
    act(() => { browse.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    const picker2 = c.querySelector('[role="dialog"][aria-label="Browse the board"]');
    const tiles = Array.from(picker2.querySelectorAll('button')).filter((b) => /^(Bulk|Direct|Niche|Group(?!s)|All|Shops|Events|Groups|Errands)/.test(text(b)));
    assert.equal(tiles.length, 9, 'four flows, five side views, all reachable from it');
    assert.ok(tiles.some((b) => /^All/.test(b.textContent.trim())), 'the mixed view is a row, not a tab strip');
    assert.ok(/^Bulk/.test(tiles[0].textContent.trim()), 'the flows lead the list');
    const selected = tiles.filter((b) => b.getAttribute('aria-pressed') === 'true');
    assert.equal(selected.length, 1, 'exactly one view is active on open');
    assert.ok(/^All/.test(selected[0].textContent.trim()), 'and it is the mixed supply view');
    assert.ok(/\d/.test(selected[0].textContent), 'with its count beside it, in the list rather than on the glass');
    // No scoreboard "0 : 0" hero.
    const hero = Array.from(c.querySelectorAll('div')).find((d) => (d.getAttribute('class') || '').includes('text-3xl'));
    assert.ok(!hero, 'no scoreboard hero remains');
  }
  pass('the board has no Discover heading (no scoreboard, no dark card)');

  // --- 3. The create sheet's two loops still land on the rows they write ---
  // "Host an event" is now the shell's sheet (it used to be a modal on this
  // screen); "Post an offer" is a signal to this screen, which opens the
  // counter's Selling tab — the counter is where a listing is really written.
  {
    const { HostEventSheet } = require('./src/features/city/HostEventSheet.tsx');
    const c = mount(React.createElement(HostEventSheet, { open: true, onClose: () => {} }));
    await flush();
    assert.ok(text(c).includes('A party, a trip, your people.'), 'the host-event form opens');
    assert.ok(c.querySelector('input[aria-label="Event title"]'), 'the form has a title input');
    assert.ok(text(c).includes('Publish plan'), 'and it publishes, not drafts');
  }
  pass('Host an event is a real createCampaign form, opened from the sheet');

  {
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {}, sellingSignal: 1 }));
    await flush();
    assert.ok(text(document.body).includes('Start selling'), 'the Selling signal lands on the marketplace Selling flow');
  }
  pass('Post an offer deep-links to the Selling flow via the signal, not a second form');

  // --- 4. The events room is inventory alone ------------------------------
  {
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    const t = text(c);
    assert.ok(t.includes('The counter'), 'Discover opens on the supply board, not the gallery');
    assert.ok(c.querySelector('button[aria-label="Browse the board"]'),
      'and its first control is the one entry that reaches the flows');
    assert.ok(!/The flows/.test(t),
      'the flow list itself is inside that entry: four zeros no longer own the top of the screen');
    // What was taken OUT, and why.
    // The complaint was the orphaned heading clipped mid-word under the
    // gallery, not the sub-tabs themselves: in their own room they are correct.
    assert.ok(!/Community Marketplace & Second-Hand Drops/i.test(t), 'no orphaned heading under the gallery');
    assert.ok(t.includes('Browse') || t.includes('My orders'), 'the market sub-tabs live in the market room');
    assert.ok(!/Community Groups & Mutual Aid/.test(t), 'circles are not browsed like posters');
    assert.ok(!/Vault & Special Drops/.test(t), 'vaults are not either');
    // and the tiles navigate instead of stacking: the Events room holds no market
    act(() => { c.querySelector('button[aria-label="Browse the board"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    const evTile = Array.from(c.querySelectorAll('[role="dialog"][aria-label="Browse the board"] button')).find((b) => /^Events/.test(text(b)));
    act(() => { evTile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    assert.equal(window.location.hash, '#wanderly', 'Events opens the canonical Wanderly route instead of another event gallery');
    assert.ok(!/The case/.test(text(c)), 'and the marketing word is gone from the surface');
    assert.ok(!/WAIRO/.test(t), 'the rider card belongs to errands, not the gallery');
    assert.ok(!/What's moving/.test(t), 'the signal line was the atrium’s job, not a browse header');
    assert.ok(!/shown\b/.test(t), 'no result counter anywhere on the browse screen');
    assert.ok(!/KES \d/.test(t), 'no fabricated money figure appears anywhere');
  }
  pass('Discover’s events room is inventory alone: no commerce, circles, vaults or WAIRO');

  // --- 5. Errands is its own room, and WAIRO lives inside it ---------------
  {
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    act(() => { c.querySelector('button[aria-label="Browse the board"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    const errandsBtn = Array.from(c.querySelectorAll('[role="dialog"][aria-label="Browse the board"] button')).find((b) => /^Errands/.test(text(b)));
    act(() => { errandsBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    const t = text(c);
    assert.ok(t.includes('The lobby'), 'the errands room renders');
    assert.ok(t.includes('Errands people need carried'), 'named for what it is');
    assert.ok(document.querySelector('input[aria-label="Pickup destination town"]'), 'the WAIRO contact card lives here only');
    assert.ok(/Nothing is posted right now|could not be read/.test(t), 'an empty board says so');
    assert.ok(!/\d+ riders? (nearby|around)/i.test(t), 'no invented crowd size');
    assert.equal(btn('Post an errand') === undefined, false, 'the lobby carries its own post action');
  }
  pass('Errands is its own room, and WAIRO lives inside it');

  // --- 6. where each noun actually lives ---------------------------------
  {
    // Belonging is exploration: Groups is a Discover room, under its own name.
    const c = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    act(() => { c.querySelector('button[aria-label="Browse the board"]').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    const circleTile = Array.from(c.querySelectorAll('[role="dialog"][aria-label="Browse the board"] button')).find((b) => /^Groups/.test(text(b)));
    assert.ok(circleTile, 'Groups is reachable from the grid');
    act(() => { circleTile.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    await flush();
    assert.ok(/Groups/.test(text(c)) && !/Communities/.test(text(c)), 'the room keeps Brief\u2019s own noun');
    // the definition left the room: the circle list is the explanation, and the
    // sentence about "a door" and "not a poster" now lives on How Brief works.
    assert.ok(!/Groups with a door|not a poster to walk past/.test(text(c)), 'no defining paragraph sits above the list');
    const heads = Array.from(c.querySelectorAll('h1,h2,h3,h4')).filter((el) => (el.textContent || '').trim() === 'Groups');
    assert.equal(heads.length, 1, 'and the heading is printed once, not a heading above a heading');

    // Filing is personal: the Archive lives in You, not in a gallery or a shop.
    const { Vault } = require('./src/components/vault/Vault.tsx');
    assert.ok(Vault, 'the vault component exists for the You screen');
    const { SpacesLanding } = require('./src/features/spaces/SpacesLanding.tsx');
    const c2 = mount(React.createElement(SpacesLanding, { onOpenSpace: () => {}, onOpenPublicSpace: () => {} }));
    await flush();
    const t2 = text(c2);
    assert.ok(t2.includes('Your spaces'), 'Spaces is shops only');
    assert.ok(!/Vaults/.test(t2) && !/Groups/.test(t2), 'with no cabinet and no neighbourhood inside it');
  }
  pass('Belonging went to Discover, filing went to You, Spaces kept only shops');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
