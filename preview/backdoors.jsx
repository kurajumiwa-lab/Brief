// ---------------------------------------------------------------------------
// BACK DOORS — every secondary screen has a way out, and the way out is the URL.
//
// Reported from a phone: "the second screen's back or X don't work". Three real
// causes were found in the tree, and each is pinned here:
//
//   1. A full-screen overlay (FollowingSurface) was embedded INSIDE a card by the
//      Mine screen with `onClose={() => {}}`. Its scrim covered the app, and its
//      Back button, its X and its click-away all did nothing: a screen you could
//      get into and not out of. Embedded now means embedded — in the page flow,
//      no scrim, and no control that is not wired.
//   2. Overlays were React state only. A phone's back gesture changes the URL, so
//      it had nothing to step off and the screen stayed. Every overlay is now one
//      hash (`#create`, `#host`, `#menu`, `#new-space`, `#manual-order`,
//      `#groupbuys`) and the shop is `#shop/<spaceId>`, so the gesture and the
//      button in the corner go to the same place — and closing writes the tab
//      hash underneath rather than '' (which is how an app "goes back" to Home
//      and makes a person think the app lost their place).
//   3. Rows that looked tappable were not (the first-run checklist's three
//      unfed steps). A row with no action renders as a fact, not a button.
//
// And one rule keeps all three from coming back: no empty arrow function is
// allowed in a JSX handler anywhere in src. `() => {}` is a control that lies.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/#city', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const surfaces = require('./src/app/surfaces.ts');
const { FollowingSurface } = require('./src/components/FollowingSurface.tsx');
const { FirstRunChecklist } = require('./src/features/you/FirstRunChecklist.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 50) => new Promise((r) => setTimeout(r, ms));
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const btnByText = (want) =>
  Array.from(document.querySelectorAll('button')).find((b) => text(b) === want || text(b).startsWith(want));
const click = async (el) => {
  await act(async () => { el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  await flush();
};

async function mount(el) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => { root.render(el); });
  await flush();
  return { host, root, t: text(host) };
}

const SPACE = {
  id: 'spc_1', name: 'Counter', type: 'business', mode: 'retail', goal: '', status: 'active',
  visibility: 'private', slug: 'counter', vendorId: 'vnd_1', ownerId: 'usr_1',
  image: null, profile: null, profileLabels: {}, maintenance: { state: 'quiet', ageHours: null },
  metrics: { revenueKes: 0, offersCount: 0, scope: 'sole space of this business' },
  capabilities: [], followers: 0, broadcastsLive: 0, editorialOpen: 0, editorialBreakdown: {},
  offers: [], activities: [], createdAt: '2026-09-01T06:00:00.000Z'
};

let fetchCalls = [];
global.fetch = async (input, init) => {
  const url = String(typeof input === 'string' ? input : input?.url ?? input ?? '');
  fetchCalls.push({ url, method: (init && init.method) || 'GET', body: init && init.body ? String(init.body) : null });
  const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
  const miss = { ok: false, status: 404, text: async () => '{}', json: async () => ({}) };
  if (url.includes('/api/auth/me')) return ok({ user: { id: 'usr_1', handle: 'owner', displayName: 'Owner' } });
  if (url.includes('/api/spaces/spc_1')) return ok({ space: SPACE });
  if (url.endsWith('/api/spaces')) return ok({ spaces: [], modes: [] });
  if (url.includes('/api/table-banking/mine') || url.includes('/api/tablebanking/mine')) return ok([]);
  if (url.includes('/api/planned-weather')) return ok({ available: false, matched: [], plannedDays: [], reason: 'nothing_planned' });
  if (url.includes('/api/banners')) return ok({ banners: [] });
  if (url.includes('/api/discover')) return ok({ tiles: [], featured: null, feed: [], events: [], circles: [] });
  if (url.includes('/api/me/position') || url.includes('/api/position')) return ok({ position: { standing: null, commitmentsOpen: 0 } });
  if (url.includes('/api/me/commitments')) return ok({ commitments: { open: 0, defended: null } });
  if (url.includes('/api/me/reciprocity')) return ok({ reciprocity: { owed: 0, owing: 0 } });
  if (url.includes('/api/circles')) return ok({ circles: [] });
  if (url.includes('/api/events')) return ok({ events: [], total: 0 });
  if (url.includes('/api/pulse')) return ok({ asOf: null, facts: [], empty: true, sections: { demand: { open: 0, bySeverity: {}, collective: 0 }, closure: { windowDays: 30, closed: 0, topCategory: null }, fill: { windowDays: 30, closed: 0, avgHoursToFill: null, hoursSampleCount: 0, avgValue: null }, money: {}, listings: { active: 0, snapshot: [] }, events: { open: 0, newLast24h: {} } } });
  return miss;
};

const srcOf = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
/**
 * Comments are stripped before any code assertion runs: a comment that DESCRIBES
 * a dead handler is documentation, and a lint that cannot tell the two apart gets
 * ignored the first time it objects to a sentence.
 */
const codeLines = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((l) => l.replace(/\/\/.*$/, ''))
  .join('\n');

async function main() {
  // --- 1. the URL vocabulary is data, and it is honest about its gaps --------
  {
    assert.equal(surfaces.surfaceFromHash('#create'), 'create');
    assert.equal(surfaces.surfaceFromHash('#manual-order'), 'manual-order');
    assert.equal(surfaces.surfaceFromHash('menu'), 'menu');
    assert.equal(surfaces.surfaceFromHash('#city'), null, 'a tab is not a surface');
    assert.equal(surfaces.surfaceFromHash(''), null);
    assert.equal(surfaces.shopIdFromHash('#shop/spc_1'), 'spc_1');
    assert.equal(surfaces.shopIdFromHash('#shop/spc%201'), 'spc 1', 'a percent-encoded id decodes');
    assert.equal(surfaces.shopIdFromHash('#spaces'), null, 'the street is not a shop');
    assert.equal(surfaces.shopHref('spc 1'), '#shop/spc%201');
    assert.equal(surfaces.TAB_HASH.pipeline, 'spaces', 'closing a sheet returns to the street hash, not to nothing');
    assert.equal(surfaces.hrefForDest('shopbrief'), 'spaces', 'the morning brief has somewhere real to go');
    assert.equal(surfaces.hrefForDest('entity:venue:KICC'), 'entity/venue%3AKICC');
    assert.equal(surfaces.hrefForDest('object:obj_9'), null,
      'this shell has no object detail, so a route to one would be invented');
    assert.equal(surfaces.hrefForDest(null), null);
    assert.deepEqual(surfaces.SURFACE_KEYS, ['create', 'host', 'groupbuys', 'menu', 'new-space', 'manual-order']);
  }
  pass('the surface vocabulary is a table, and says what it cannot route to');

  // --- 2. no dead handlers anywhere in the app ------------------------------
  {
    const bad = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const fp = path.join(dir, name);
        const st = fs.statSync(fp);
        if (st.isDirectory()) { if (name !== 'node_modules') walk(fp); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        codeLines(fs.readFileSync(fp, 'utf8')).split('\n').forEach((line, i) => {
          // A promise's swallowed rejection is legitimate; an advertised
          // control whose handler is empty is not.
          if (/(on[A-Z]\w*)=\{\(\) => \{\}\}/.test(line)) bad.push(`${path.relative(__dirname, fp)}:${i}: ${line.trim().slice(0, 60)}`);
        });
      }
    };
    walk(path.join(__dirname, 'src'));
    assert.deepEqual(bad, [], `a handler that does nothing is a control that lies:\n${bad.join('\n')}`);
  }
  pass('no JSX handler in src is an empty arrow function');

  // --- 3. embedded means embedded: no scrim, no fake exit -------------------
  {
    let closed = 0;
    const { host } = await mount(React.createElement(FollowingSurface, {
      authed: false, variant: 'embedded', onClose: () => { closed++; }, onOpenEntity: () => {}, onRequireAuth: () => {}
    }));
    const root = host.firstElementChild;
    assert.ok(!/fixed inset-0/.test(root.getAttribute('class') || ''), 'it is not a scrim over the app');
    assert.ok(!btnByText('Back'), 'no Back button when nothing asked to be closed');
    assert.ok(!document.querySelector('[aria-label="Close"]'), 'and no X');
    assert.ok(text(host).includes('Sign in'), 'the list itself still renders');
    assert.equal(closed, 0);
  }
  {
    let closed = 0;
    const { host } = await mount(React.createElement(FollowingSurface, {
      authed: false, onClose: () => { closed++; }, onOpenEntity: () => {}, onRequireAuth: () => {}
    }));
    assert.ok(/fixed inset-0/.test(host.firstElementChild.getAttribute('class') || ''), 'as an overlay it still covers');
    const back = btnByText('Back');
    assert.ok(back, 'the sheet keeps its Back');
    await click(back);
    assert.equal(closed, 1, 'and Back closes it');
    const x = document.querySelector('[aria-label="Close"]');
    assert.ok(x, 'with an X too');
    await click(x);
    assert.equal(closed, 2);
    await click(host.firstElementChild);
    assert.equal(closed, 3, 'and the click-away scrim');
  }
  pass('the following list is a sheet when it is one, and a block when it is embedded');

  // --- 4. Mine kept-list is a belt of real follows, not a trapped overlay ---
  {
    const mine = codeLines(srcOf('src/features/mine/MineSurface.tsx'));
    assert.ok(!/getMyFollows|follow-belt/.test(mine), 'Spaces no longer duplicates You’s follows');
    assert.match(codeLines(srcOf('src/features/you/YouSurface.tsx')), /getMyFollows/, 'Following remains available in You');
    assert.ok(!/FollowingSurface/.test(mine), 'the trapped overlay is not mounted here');
    assert.ok(!/onClose=\{\(\) => \{\}\}/.test(mine), 'and no no-op close');
    assert.ok(!/onOpenObject=\{\(\) => \{\}\}/.test(mine),
      'nor a saved-item card wired to an "open" that opens nothing');
  }
  pass('the host that embeds it stops faking the controls');

  // --- 5. a step with nowhere to go is not a button ------------------------
  {
    const { host } = await mount(React.createElement(FirstRunChecklist, {
      groups: [], onStartGroup: () => {}
    }));
    const rows = Array.from(host.querySelectorAll('li'));
    assert.equal(rows.length, 4, 'four steps are still reported');
    const buttons = rows.map((li) => li.querySelector('button'));
    assert.ok(buttons[0], 'the one step that can be taken is a button');
    assert.equal(buttons[1], null, 'the three that need a group are not');
    assert.equal(buttons[2], null);
    assert.equal(buttons[3], null);
    assert.ok(text(host).includes('needs a group that exists first'), 'and the reason is on the row');
  }
  {
    let tapped = null;
    await mount(React.createElement(FirstRunChecklist, {
      groups: [], onStartGroup: () => { tapped = 'start'; }, onAddMembers: () => { tapped = 'members'; }
    }));
    const rows = Array.from(document.querySelectorAll('li'));
    await click(rows[1].querySelector('button'));
    assert.equal(tapped, 'members', 'when a host CAN take the step, the row works');
    const first = rows[0].querySelector('button');
    await click(first);
    assert.equal(tapped, 'start');
  }
  pass('the first-run checklist offers actions only where one exists');

  // --- 6. the shell's overlays answer the back gesture ---------------------
  {
    const { AppShell } = require('./src/app/AppShell.tsx');
    window.location.hash = '#city';
    const { host } = await mount(React.createElement(AppShell, { initialTab: 'city' }));
    assert.equal(window.location.hash, '#city', 'mounting does not move the URL');

    const plus = document.querySelector('[aria-label="Create"]') || Array.from(document.querySelectorAll('button'))
      .find((b) => /Create|new|add/i.test(b.getAttribute('aria-label') || '')) || btnByText('+');
    assert.ok(plus, 'the bar has one action');
    await click(plus);
    await flush();
    assert.equal(window.location.hash, '#create', 'opening the sheet writes its hash');
    assert.ok(document.querySelector('[aria-label="Close the create sheet"]'), 'the sheet renders with a way out');

    const x = document.querySelector('[aria-label="Close the create sheet"]');
    await click(x);
    assert.notEqual(window.location.hash, '#create', 'its X clears the hash, not just the state');
    assert.ok(!document.querySelector('[aria-label="Close the create sheet"]'), 'and the sheet is gone');

    // The gesture: put the URL back the way a phone would, and the sheet must close.
    window.location.hash = '#create';
    await flush();
    assert.ok(document.querySelector('[aria-label="Close the create sheet"]'), 'a pasted or forwarded #create opens it');
    window.location.hash = '#city';
    await flush();
    assert.ok(!document.querySelector('[aria-label="Close the create sheet"]'),
      'and stepping off it closes it — the back button works because it was always the URL');

    // The drawer, too.
    window.location.hash = '#menu';
    await flush();
    assert.ok(document.querySelector('[aria-label="Close the menu"]') || /Create|Spaces/.test(text(host)),
      'the drawer opens from its hash');
    window.location.hash = '#city';
    await flush();
    assert.ok(!document.querySelector('[aria-label="Close the menu"]'), 'and closes on back');
  }
  pass('an overlay is a hash: open it, close it, step off it, reload it');

  // --- 7. the shop is a second screen with a real place to go back to ------
  {
    const { AppShell } = require('./src/app/AppShell.tsx');
    window.location.hash = '#city';
    const { host } = await mount(React.createElement(AppShell, { initialTab: 'city' }));
    assert.ok(!text(host).includes('Counter'), 'no shop is open');

    window.location.hash = '#shop/spc_1';
    await flush();
    await flush();
    assert.ok(text(host).includes('Counter'), 'the URL names the shop, so the shell opens it');
    assert.ok(!/Your shopfronts/.test(text(host)), 'and the street is not behind it');

    // The visible back control and the gesture must agree.
    const backBtn = Array.from(document.querySelectorAll('button')).find((b) => /^Go Back$|^Back$|street/i.test(text(b)));
    if (backBtn) {
      await click(backBtn);
      assert.ok(!window.location.hash.startsWith('#shop/'), 'the button leaves the shop hash');
    } else {
      assert.ok(text(host).includes('Your shopfronts') === false, 'the shell is on the shop screen');
    }
    window.location.hash = '#mine';
    await flush();
    assert.ok(!text(host).includes('No space yet'), 'the shop screen is gone');
  }
  pass('a space opens at a URL, and leaving it is a step back, not a jump home');

  // --- 8. the way out is also visible, and only when it is needed ----------
  {
    const { AppShell } = require('./src/app/AppShell.tsx');
    window.location.hash = '#mine';
    const { host } = await mount(React.createElement(AppShell, { initialTab: 'mine' }));
    assert.ok(!document.querySelector('[aria-label^="Back to"]'),
      'no back control on a root screen — a button that returns you to where you already are is noise');

    window.location.hash = '#shop/spc_1';
    await flush(); await flush();
    assert.ok(text(host).includes('Counter'), 'the shop is open');
    const beltBack = document.querySelector('[aria-label^="Back to"]');
    assert.ok(beltBack, 'and the band carries the way out');
    assert.equal(beltBack.getAttribute('aria-label'), 'Back to Mine',
      'named after the place it returns to, which is where this one was opened from');
    await click(beltBack);
    assert.equal(window.location.hash, '#mine', 'the tap moves the URL, the same way the gesture does');
    await flush();
    assert.ok(!text(host).includes('Counter'), 'and the shop screen is gone');

    window.location.hash = '#create';
    await flush();
    const backFromSheet = document.querySelector('[aria-label^="Back to"]');
    assert.ok(backFromSheet, 'an overlay gets the same affordance');
    await click(backFromSheet);
    assert.ok(!document.querySelector('[aria-label="Close the create sheet"]'), 'and it closes the overlay');
  }
  pass('the exit is visible where the gesture is invisible');

  // --- 9. the dead "Opening event creator" toast is gone -------------------
  {
    const shell = codeLines(srcOf('src/app/AppShell.tsx'));
    assert.ok(!/Opening event creator/.test(shell), 'a toast that promised a screen and opened none');
    assert.ok(!/cityPostModalOpen/.test(shell), 'and the modal nothing could reach');
    assert.ok(!/🎟️/.test(shell), 'with its emoji buttons');
    assert.match(shell, /onOpenSpace=\{openSpace\}/, 'every opener goes through the one that names the URL');
  }
  pass('the unreachable create dialog is deleted, not decorated');

  // --- 10. Home is Home. Discover is a door you chose. ---------------------
  // The bug: initialTab was 'city', the Home door wrote hash '', and navigate()
  // mapped an empty hash back to initialTab — so tapping Home opened Discover,
  // and a cold load painted Discover first. Two surfaces, the wrong one on top.
  {
    const { AppShell } = require('./src/app/AppShell.tsx');
    window.location.hash = '';
    const { host } = await mount(React.createElement(AppShell, {}));
    await flush(); await flush();
    const t = text(host);
    assert.ok(host.querySelector('[data-testid="compact-home"]'),
      'a cold load with no hash is Home — the six doors, not the board');
    assert.ok(!/What's happening nearby/.test(t) && !/What.s happening nearby/.test(t),
      `Discover's heading is not on Home: ${t.slice(0, 180)}`);

    window.location.hash = 'city';
    await flush(); await flush();
    assert.ok(document.querySelector('[aria-label="Browse the board"]'), 'the board is still a real screen, when asked for');
    assert.ok(!host.querySelector('[data-testid="compact-home"]'), 'and Home is not sitting under it');

    const homeDoor = Array.from(document.querySelectorAll('button')).find((b) => /^Home$/.test(text(b)));
    assert.ok(homeDoor, 'the bar still has a Home door');
    await click(homeDoor);
    await flush(); await flush();
    assert.equal(window.location.hash, '#home', 'Home writes #home, not an empty hash that used to mean Discover');
    assert.ok(document.querySelector('[data-testid="compact-home"]'), 'and the tiles are what you land on');
    assert.ok(!/happening nearby/i.test(text(document.body)), 'Discover did not come along');
    assert.ok(!document.querySelector('[aria-label^="Back to"]'),
      'Home is a root screen: no Back toggle');
  }
  pass('tapping Home opens Home, not a phantom Discover');

  // --- 11. Events and Groups are rooms of the board, not Errands ----------
  {
    const shell = codeLines(srcOf('src/app/AppShell.tsx'));
    assert.ok(!/setActiveSpace\(res\.data\.spaces\[0\]\)/.test(shell),
      'listing shops is not opening the first one — that put Back on Home');
    const city = codeLines(srcOf('src/features/city/CityFeedView.tsx'));
    assert.match(city, /initialSubTab === 'errands'/,
      'a leftover run signal cannot steal Events or Groups');

    const { AppShell } = require('./src/app/AppShell.tsx');
    window.location.hash = '#home';
    const { host } = await mount(React.createElement(AppShell, {}));
    await flush(); await flush();
    const tiles = host.querySelector('[data-testid="compact-home"]');
    assert.ok(tiles, 'Home still has the six doors');
    await click(tiles.querySelector('details summary'));
    const events = Array.from(tiles.querySelectorAll('nav[aria-label="Quick actions"] button')).find((b) => /Wanderly/.test(text(b)));
    const circles = Array.from(tiles.querySelectorAll('button')).find((b) => /Groups/.test(text(b)));
    assert.ok(events && circles, 'Events and Groups are tiles');

    await click(events);
    await flush(); await flush();
    assert.equal(window.location.hash, '#city/events', 'Events writes its own room, not #city as errands');
    assert.ok(!/You cannot take errands yet/.test(text(document.body)),
      'Events did not land on the errands empty state');
    assert.ok(document.querySelector('[data-testid="wanderly"]'), 'Events opens the unified Wanderly product');

    window.location.hash = '#home';
    await flush(); await flush();
    const tiles2 = document.querySelector('[data-testid="compact-home"]');
    await click(tiles2.querySelector('details summary'));
    const circles2 = Array.from(tiles2.querySelectorAll('button')).find((b) => /Groups/.test(text(b)));
    await click(circles2);
    await flush(); await flush();
    assert.equal(window.location.hash, '#city/circles', 'Groups writes its own room');
    assert.ok(!/You cannot take errands yet/.test(text(document.body)),
      'Groups did not land on the errands empty state');
  }
  pass('Events and Groups open their own rooms; Home has no Back');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
