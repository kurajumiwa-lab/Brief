// ---------------------------------------------------------------------------
// THE BELT AND THE SHEET — a location, a search that resolves, a hamburger
// that owns the long list. None of the psychology, and (after the nav reorg)
// none of the rail either.
//
// The instruction was to renovate the shell using a mature commerce header as
// the reference, keeping the parts that reduce crowding. The nav reorg then
// applied the same rule to the rail itself: a departments chip row under the
// band was the THIRD navigation for the rooms (Home's mode tiles, the board's
// own picker), so it is deleted — which is exactly what this file now pins.
// Four rules are held here, and each is one that a future "improvement"
// would break:
//
//   1. GEOMETRY. A band with an "All" affordance, a search box that resolves,
//      an area chip, and a message slot above the content — and NO rail, no
//      chip row, no second category list.
//   2. THE PSYCHOLOGY IS REFUSED. No countdown, no "X people viewed", no
//      "Sponsored", no cart badge, no invented deal, and a search box that goes
//      nowhere counts as a bug rather than a mockup. Each of those has an explicit
//      negative assertion below, because "we would never" is only true for as
//      long as a test says so.
//   3. THE DRAWER IS SECONDARY. Its eight existing rooms are asserted as data
//      (SHEET_GROUPS): Pulse leads Explore, no primary door is repeated, and
//      the account/settings surfaces stay under You.
//   4. THE DEDUPE. A personal destination does not also get a shelf on Home.
//      The seller dashboard reads operational rows; personal standing stays in
//      You, with the same data kept out of duplicate cards.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
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
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { AppBelt } = require('./src/app/AppBelt.tsx');
const { NavSheet, SHEET_GROUPS } = require('./src/app/NavSheet.tsx');
const { BOTTOM_BAR_ITEMS } = require('./src/app/Navigation.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 40) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const inEl = (host, sel) => Array.from(host.querySelectorAll(sel));
const byAria = (host, label) => inEl(host, 'button, a').find((b) => b.getAttribute('aria-label') === label);
const click = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
const src = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');

let fetchHandler = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ banners: [] }) });
global.fetch = async (input, init) => fetchHandler(input, init);

async function mount(el) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await flush();
  return { host, root, t: text(host) };
}

async function main() {
  // --- 1. the band --------------------------------------------------------
  {
    let opened = 0;
    let searched = null;
    global.localStorage.removeItem('brief.world.place');
    const belt = await mount(React.createElement(AppBelt, {
      onOpenSheet: () => { opened++; },
      onHome: () => {},
      onSearch: (q) => { searched = q; }
    }));
    assert.ok(byAria(belt.host, 'Open all sections'), 'the sheet is one tap away, so the band can stay short');
    click(byAria(belt.host, 'Open all sections'));
    assert.equal(opened, 1, 'and that tap opens it');

    // The area chip states what is known. Nothing is inferred from an IP: a
    // confident location on a stranger's phone is a lie with good typography.
    assert.match(belt.t, /Set your area/, 'an unset area is said as unset');
    assert.ok(!/Delivering to|Nairobi County/i.test(belt.t), 'no inherited or guessed location');

    // NO departments rail. The band used to carry a chip row of the taxonomy's
    // rooms, and that was the third navigation for them (Home's mode tiles and
    // the board's picker already are the other two). A chip row up here mirroring
    // a list down there is two ways to do one thing, and on a small screen it
    // reads as noise — so the rail is asserted gone, not merely smaller.
    assert.equal(belt.host.querySelector('[aria-label="Departments"]'), null, 'no departments rail on the band');
    // A room chip would be a bare labelled button ("All", "Events", …). The
    // hamburger also reads "All", but it is the sheet trigger and says so by
    // aria-label — so the exclusion is: no bare room-labelled button.
    const chips = inEl(belt.host, 'button').filter((b) => !b.getAttribute('aria-label'));
    assert.ok(!chips.some((b) => /^(All|Events|Circles|Errands)$/.test(text(b))),
      'no room chip row survives under the brand — the rooms are Home\'s tiles and the board\'s picker');

    // The search box resolves, or it does not exist.
    const input = belt.host.querySelector('#belt-search');
    assert.ok(input, 'the band carries a search field');
    const submit = byAria(belt.host, 'Search');
    assert.ok(submit.disabled, 'an empty query cannot be submitted');
    act(() => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(input, 'sukuma wiki');
      input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
    await flush();
    assert.equal(byAria(belt.host, 'Search').disabled, false, 'a typed query can be');
    click(byAria(belt.host, 'Search'));
    assert.equal(searched, 'sukuma wiki', 'and the term is handed to the shell');

    // The band is not a billboard.
    assert.ok(!/mins? left|hours? left|ends in|offer ends|\d\d:\d\d/.test(belt.t), 'no countdown anywhere in the band');
    assert.ok(!/people (are )?viewing|viewed this|in your cart|Sponsored/i.test(belt.t), 'no crowd pressure, no sponsored framing');
    assert.ok(!/\bPrime\b|Early Deals|cashback|bonus/i.test(belt.t), 'no loyalty theatre');
    belt.root.unmount(); belt.host.remove();
  }
  pass('The band is a header: a stated area, a search that resolves, the sheet — and no rail');

  // --- 2. the search actually lands somewhere -----------------------------
  {
    const shell = src('./src/app/AppShell.tsx');
    assert.match(shell, /hash === 'search' \|\| hash\.startsWith\('search\/'\)/, 'the shell routes #search/<term>');
    assert.match(shell, /<SearchResults/, 'to the real search surface, not an empty state');
    const results = src('./src/components/SearchResults.tsx');
    assert.ok(/searchAll\(/.test(results), 'which performs the /api/search read itself');
  }
  pass('A search box in this app resolves: #search/<term> reaches the real search surface');

  // --- 3. the message slot: nothing when there is nothing ------------------
  {
    fetchHandler = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ banners: [] }) });
    const empty = await mount(React.createElement(AppBelt, { onOpenSheet: () => {}, onHome: () => {}, onSearch: () => {} }));
    assert.ok(!empty.host.querySelector('[aria-label="Announcements"]'),
      'no banners, no frame — an empty promotional slot is still a claim that something is being promoted');
    empty.root.unmount(); empty.host.remove();

    fetchHandler = async () => ({
      ok: true, status: 200, text: async () => JSON.stringify({
        banners: [
          { id: 'b1', campaignId: 'c1', title: 'Kisii market Saturday', body: 'Bring your own baskets', location: 'Kisii', startsAt: '2026-09-20T08:00:00+03:00', imageUrl: null, status: 'active', createdAt: '', share: { available: false, reason: 'public_origin_not_configured' } },
          { id: 'b2', campaignId: 'c2', title: 'Grain drop', body: null, location: null, startsAt: null, imageUrl: null, status: 'active', createdAt: '', share: { available: true, url: 'https://example.test/c/grain-drop', channels: { whatsapp: 'x' } } }
        ]
      })
    });
    const two = await mount(React.createElement(AppBelt, { onOpenSheet: () => {}, onHome: () => {}, onSearch: () => {} }));
    // The date is asserted through the same call the component uses — the app's
    // convention for a day label — so the test cannot be wrong about a locale and
    // cannot drift into pinning a string nobody chose.
    const dayLabel = new Date(Date.parse('2026-09-20T08:00:00+03:00'))
      .toLocaleDateString('en-KE', { weekday: 'short', day: 'numeric', month: 'short' });
    assert.match(two.t, new RegExp(`Kisii market Saturday — Bring your own baskets · ${dayLabel} · Kisii`),
      'a banner is its own words plus the date and place it carries');
    assert.match(two.t, /no public link yet/, 'and says so when there is nowhere to send people');
    assert.ok(!/Register now|Limited|ends soon|\bFree\b/i.test(two.t), 'the host wrote the copy; the app adds no urgency to it');
    const hrefs = inEl(two.host, '[aria-label="Announcements"] a').map((a) => a.getAttribute('href'));
    assert.deepEqual(hrefs, ['https://example.test/c/grain-drop'], 'only a configured link becomes a button');
    assert.ok(!two.host.querySelector('[aria-label="Announcements"] img'),
      'no image, no placeholder art of a market nobody photographed');
    two.root.unmount(); two.host.remove();
  }
  pass('Banners: silence when there is nothing, the host’s own words when there is, no invented CTA');

  // --- 4. secondary destinations stay in the drawer, once -----------------
  {
    const items = SHEET_GROUPS.flatMap((group) => group.items);
    const ids = items.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, 'no destination is listed twice in the sheet');
    assert.ok(ids.length >= 30, 'the directory lists the building, not eight leftovers');
    assert.deepEqual(SHEET_GROUPS.map((group) => group.id), ['market', 'trade', 'duka', 'you', 'services'],
      'the directory is floored by wing, in the order of a walk through it');
    assert.deepEqual(SHEET_GROUPS[0].items.map((item) => item.label).slice(0, 2),
      ['Everything on the board', 'Pulse'], 'the ground floor starts at the board and keeps Pulse, its numbers');
    assert.ok(SHEET_GROUPS.find((group) => group.id === 'trade').items.some((item) => item.id === 'trade-demand'),
      'the loop the product is built around is listed where a person looks for it');
    assert.ok(items.every((item) => item.target || item.href),
      'and no row is a word with nowhere to go');

    const sheetLabels = items.map((item) => item.label);
    const doorLabels = BOTTOM_BAR_ITEMS.filter((item) => item.type === 'destination').map((item) => item.label);
    assert.ok(doorLabels.every((label) => !sheetLabels.includes(label)), 'no primary door is repeated in the sheet');
    assert.ok(!['Mine', 'Discover', 'Activity', 'Selling', 'Spaces', 'You'].some((label) => sheetLabels.includes(label)),
      'legacy and primary navigation labels are not reintroduced in the sheet');
    assert.ok(sheetLabels.every((label) => label.trim().length > 2 && !/\\d/.test(label)),
      'secondary entries are readable and carry no unsupported counts');
    assert.ok(!SHEET_GROUPS.some((group) => ['Settings', 'You'].includes(group.label)),
      'account and settings surfaces stay under You, not in a second menu');

    let went = null;
    let closed = 0;
    const sheet = await mount(React.createElement(NavSheet, {
      open: true,
      onClose: () => { closed++; },
      place: '',
      onSetPlace: () => {},
      onGo: (target) => { went = target; }
    }));
    assert.ok(sheet.host.querySelector('[role="dialog"]'), 'it is a dialog, so the screen behind it is not left half-reachable');
    assert.match(sheet.t, /Your area/, 'the area is set here, once, and read by the band and the forecast');
    assert.ok(sheet.host.querySelector('#belt-place'), 'in a real input, not a display of a city we guessed');
    const rendered = items.filter((item) => sheet.host.querySelector(`[data-testid="menu-tile-${item.id}"]`));
    assert.equal(rendered.length, items.length, 'each directory entry renders once as a reachable row');
    const pulse = sheet.host.querySelector('[data-testid="menu-tile-pulse"]');
    assert.ok(pulse, 'Pulse remains a secondary entry in the drawer');
    click(pulse);
    assert.deepEqual(went, { kind: 'tab', tab: 'pulse' }, 'Pulse opens its existing destination');
    assert.equal(closed, 1, 'and choosing a destination closes the sheet');
    assert.equal(inEl(sheet.host, 'button[aria-label="Close the directory"]').length, 2,
      'the backdrop and one visible control are the same affordance, not two competing buttons');
    sheet.root.unmount(); sheet.host.remove();

    const shut = await mount(React.createElement(NavSheet, { open: false, onClose: () => {}, place: 'Kisii', onSetPlace: () => {}, onGo: () => {} }));
    assert.equal(shut.t, '', 'closed means nothing rendered, not a hidden tree');
    shut.root.unmount(); shut.host.remove();
  }
  pass('The directory stays distinct from the five doors and closes cleanly');

  // --- 5. what the sheet took over leaves the working screens -------------
  {
    const home = src('./src/features/home/SellerHome.tsx');
    for (const gone of ['PositionCard', 'CommitmentsCard', 'ReciprocityCard', 'WorldStrip']) {
      assert.ok(!home.includes(gone), `operational Home does not duplicate the personal ${gone} surface`);
    }
    assert.ok(!fs.existsSync(path.join(__dirname, 'src/features/home/WorldStrip.tsx')),
      'and the component that put a whole week of weather on every visit is deleted, not left as a second answer');
    const you = src('./src/features/you/YouSurface.tsx');
    for (const kept of ['PositionCard', 'CommitmentsCard', 'ReciprocityCard']) {
      assert.ok(you.includes(kept), `${kept} still exists where it was moved to (You → Standing)`);
    }
    const sheetSrc = src('./src/app/NavSheet.tsx');
    assert.ok(!/Earn|Standing/.test(sheetSrc), 'personal titles are not duplicated in the secondary drawer');
    assert.match(you, /earn/, 'Earn remains on the personal You surface, not as a duplicate Home shortcut');
    // The definition that sat in Home's "Tip" box moved to the audit screen,
    // which is where a sentence about what a space IS belongs.
    const audit = src('./src/features/you/HowBriefWorks.tsx');
    assert.match(audit, /A space holds|public/i, 'the audit screen still carries the plain words');
    // And the forecast's provenance sentence survived on the line that replaced it.
    assert.match(src('./src/features/home/PlannedWeather.tsx'), /a model, not a measurement/,
      'the model-not-measurement note is on the line itself');
  }
  pass('A feature given a home in the sheet is denied a duplicate shelf on Home — moved, not deleted');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
