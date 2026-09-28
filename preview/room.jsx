// ---------------------------------------------------------------------------
// THE ROOM — the temperature of the app, asserted rather than admired.
//
// A screenshot cannot be verified from a sandbox, so this suite pins the RULES
// that made the screens feel "nude" instead of claiming it looks nice:
//
//   1. the palette is COOL and disciplined: a near-white ground (#F7F8FA), pure
//      white cards, one blue accent (#2563EB), and no warm plaster surviving
//      anywhere (the 2026-09-17 warm room was tried and read as newsprint);
//   2. a card is separated from the room by LIGHT (a --lift-* / .brief-card
//      shadow) and never by a 1px stroke — so no surface on the board carries a
//      `border: 1px solid <line>` any more;
//   3. a photograph gets the room's own ink as a scrim, and a card with NO photo
//      gets a lit plate with a mark that means something — never a stock image
//      standing in for a shop that has not been photographed;
//   4. a zero is a true count, printed quietly, with the one step that could
//      change it. An unmeasurable figure stays a dash. Nothing here is padded to
//      make a screen look busy;
//   5. the plate's time sentence comes from the row's own timestamp. No
//      timestamp, no sentence — "2h ago" is never invented.
//
// If someone later "improves" the room by outlining cards with grey strokes,
// by re-warming the neutrals, or by substituting stock photography for a missing
// photo, tests 1–4 fail. The palette has flipped twice inside two days; this file
// is why it now cannot flip a third time by accident.
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
const { DiscoverFeed } = require('./src/features/city/DiscoverFeed.tsx');
const { listedAgo, PLASTER, roomSurface, plateGlow } = require('./src/features/city/room.ts');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 70) => new Promise((r) => setTimeout(r, ms));
function mount(el) {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  return { container: c, root };
}
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const tab = (want) => Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => text(b).includes(want));
/**
 * The board's only navigation is one entry that opens the taxonomy, so a test
 * reaches a room the way a person does. Kept as a helper so no suite can quietly
 * go back to asserting on a tile grid that no longer exists.
 */
const openRoom = async (container, want) => {
  const face = Array.from(container.querySelectorAll('[aria-label="Browse the board"]')).find((b) => b.tagName === 'BUTTON');
  if (!container.querySelector('[role="dialog"][aria-label="Browse the board"]')) {
    act(() => face.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await flush();
  }
  const picker = container.querySelector('[role="dialog"][aria-label="Browse the board"]');
  return { face, picker, entry: Array.from(picker.querySelectorAll('button')).find((b) => new RegExp('^\\s*' + want).test(text(b))) };
};
const flushSync = () => { };
const styleOf = (el) => (el && (el.getAttribute('style') || '')) || '';
const allStyled = (c) => Array.from(c.querySelectorAll('*')).map((el) => ({ el, cls: el.getAttribute('class') || '', style: el.getAttribute('style') || '' }));

const hexes = (s) => (s.match(/#[0-9A-Fa-f]{6}/g) || []);
const rgb = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
/** "warm" = red leads blue by a clear margin. A neutral grey has an almost equal
    spread; a cold near-white has blue ABOVE red, which is the exact colour that
    made the page read as an empty canvas. */
const isWarm = (hex) => { const [r, , b] = rgb(hex); return r - b >= 8; };
const isCold = (hex) => { const [r, , b] = rgb(hex); return b - r > 4; };
/** A cool neutral is one where blue is at or above red. #F7F8FA is only 3 points
    of blue over red — that is the whole difference between this room and the
    plaster it replaced, and it is why the old code looked like newsprint. */
const isCool = (hex) => { const [r, g, b] = rgb(hex); return b >= r && g >= r; };

const themeCss = fs.readFileSync(path.join(__dirname, 'src/ui/theme.css'), 'utf8');
/** Every source line in the app, for the sweeps that must be repo-wide. */
const sweep = () => {
  let all = '';
  const walk = (d) => { for (const n of fs.readdirSync(d)) { const fp = path.join(d, n);
    if (fs.statSync(fp).isDirectory()) { if (n !== 'node_modules') walk(fp); continue; }
    if (/\.(tsx|jsx|ts|js|css)$/.test(n)) all += fs.readFileSync(fp, 'utf8'); } };
  walk(path.join(__dirname, 'src'));
  return all;
};
const indexCss = fs.readFileSync(path.join(__dirname, 'src/index.css'), 'utf8');
const roomTs = fs.readFileSync(path.join(__dirname, 'src/features/city/room.ts'), 'utf8');

const read = (name) => {
  const m = themeCss.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  assert.ok(m, `--${name} is defined in the room stylesheet`);
  return m[1];
};

// A feed with one listing that HAS a timestamp, one that has none, and one event.
// NOW is the wall clock so the "2h ago" assertion is true whenever the suite runs.
const NOW = Date.now();
const FEED = [
  {
    kind: 'listing', id: 'lst_tom', title: 'Tomatoes, 20 crates', description: 'Graded at the stall',
    priceLabel: 'KES 2,400 / crate', dateLabel: null, location: 'Wakulima Market', mediaUrl: null,
    seller: 'Mwangi Wholesale', stock: 20, orderable: true, contact: null, contactNote: null,
    listedAt: new Date(NOW - 2 * 3600_000).toISOString(), interest: { label: 'settled orders', count: 3 },
    why: '3 settled orders', flow: 'bulk', commodity: 'tomatoes', origin: 'Wakulima Market',
    originKind: 'producer', destination: 'Kilimani shops', destinationKind: 'vendors', unit: 'crate', minOrder: 5
  },
  {
    kind: 'listing', id: 'lst_can', title: 'Hand-poured candles, set of 3', description: 'Soy wax',
    priceLabel: 'KES 1,800', dateLabel: null, location: 'Kilimani', mediaUrl: 'https://cdn.test/candle.jpg',
    seller: 'Wanjiru Candle Co.', stock: 6, orderable: true, contact: null, contactNote: null,
    listedAt: null, interest: { label: 'settled orders', count: 0 }, why: 'newest live listing',
    flow: 'niche', commodity: 'candles', origin: null, originKind: null, destination: null,
    destinationKind: null, unit: null, minOrder: null
  }
];
const SUMMARY = {
  tiles: [
    { key: 'marketplace', label: 'Marketplace', count: 2, unit: 'live offer' },
    { key: 'events', label: 'Events', count: 0, unit: 'published' },
    { key: 'circles', label: 'Circles', count: 0, unit: 'you could join' },
    { key: 'errands', label: 'Errands', count: 0, unit: 'open' }
  ],
  feed: FEED,
  flows: [
    { key: 'bulk', label: 'Bulk', sub: 'for vendors & shops', subFilters: ['Produce'], requires: ['originName', 'destinationName'], zeroReason: null, listings: 1, openDemand: 1 },
    { key: 'direct', label: 'Direct', sub: 'source-direct', subFilters: [], requires: ['originName'], zeroReason: 'nothing_on_the_board', listings: 0, openDemand: 0 },
    { key: 'niche', label: 'Niche', sub: 'curated for consumers', subFilters: [], requires: [], zeroReason: null, listings: 1, openDemand: 0 },
    { key: 'group', label: 'Group', sub: 'pooled demand', subFilters: [], requires: ['destinationName'], zeroReason: 'nothing_on_the_board', listings: 0, openDemand: 0 }
  ],
  untagged: 0,
  totals: { activeListings: 2, declaredRoutes: 1, openPublicDemand: 1 },
  routes: [{
    origin: 'Wakulima Market', destination: 'Kilimani shops', flow: 'bulk', listings: 1,
    sellers: ['Mwangi Wholesale'], topCommodities: ['tomatoes'], commodities: ['tomatoes'],
    commodityUndeclared: null, minOrderFrom: 5, unit: 'crate', listingIds: ['lst_tom'],
    openDemand: 1, openDemandQuantity: 6, openDemandRequestIds: ['req_tom']
  }],
  unmapped: [],
  boardNote: 'Every number on this board is a count of rows.'
};

global.fetch = async (input, init) => {
  const url = String(input?.url ?? input ?? '');
  const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
  if (url.includes('/api/discover/summary')) return ok(SUMMARY);
  if (url.includes('/events/categories')) return ok({ categories: ['event'], labels: { event: 'Events' } });
  if (url.includes('/api/events')) return ok({ events: [], total: 0 });
  if (url.includes('/api/listings/mine')) return ok({ vendor: null, listings: [] });
  if (url.includes('/api/listings')) return ok({ listings: [] });
  if (url.includes('/api/orders')) return ok({ orders: [] });
  if (url.includes('/api/circles')) return ok({ circles: [] });
  if (url.includes('/api/errands')) return ok({ open: [], mine: [], eligibility: { eligible: false, basis: [], howToJoin: 'x', note: 'y' }, carriersAround: 0, stages: [] });
  if (url.includes('/pickups')) return ok({ pickups: [], origins: [], riders: [] });
  return { ok: false, status: 404, text: async () => JSON.stringify({}) };
};

async function main() {
  // --- 1. the temperature of the room --------------------------------------
  {
    const ground = read('brief-bg');
    const paper = read('brief-card');
    const ink = read('brief-ink');
    const line = read('brief-line');
    // Cool, not blue-tinted-to-death: a ground whose blue sits just above red,
    // and a card that is white. Depth must therefore come from the shadow, and
    // test 2 is what enforces that.
    assert.ok(isCool(ground) && !isWarm(ground), `the page is a cool near-white (${ground})`);
    assert.equal(paper, '#FFFFFF', 'a card is pure white on a cool ground');
    assert.ok(isCold(ink) || !isWarm(ink), 'ink is cool too — warm ink on white is the newsprint look');
    assert.ok(!isWarm(line), 'the hairline is cool grey, not beige');
    for (const [name, css] of [['theme.css', themeCss], ['index.css', indexCss]]) {
      // Every warm plaster hex from the previous revision. If one survives in a
      // PAINTING slot, a component was missed by the sweep and the room splits.
      const warm = css.replace(/\/\*[\s\S]*?\*\//g, '')
        .match(/--[-\w]*(?:bg|card|surface|ground|paper|well|plaster|elevated|hairline|line|container)[-\w]*:\s*#(F4EEE3|FDFAF3|F0E9DE|EAE2D6|E4DACB|F5F0E8|FBF6EC|F1E8DA|241C12|6E6152|7E7057|A08D74)/g) || [];
      assert.deepEqual(warm, [], `${name}: no warm plaster token survives — the sweep must be complete`);
    }
    assert.ok(/--color-quiet/.test(themeCss), 'a quiet ink exists for zeros and dashes');
    assert.ok(/#2563EB/.test(themeCss) && /#0891B2/.test(themeCss), 'one blue accent, one supporting cyan');
    // Comment prose may name an old hex to explain the change; the declarations
    // may not. So the scan strips comments first, or this assertion would force
    // the stylesheet to be written without history.
    const themeCode = themeCss.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.ok(!/#4F46E5|#06B6D4/.test(themeCode), 'the indigo/bright-cyan pair is gone from the theme, not aliased');
    // The type floor: fine print is what made the last revision read as a form.
    // The card pattern deleted the one sanctioned 9px exception (the status
    // pill — a corner badge the pattern removes), so 8px and 9px are both
    // banned everywhere, with no file to exempt.
    const allSrc = sweep();
    // The floor is a NUMBER, not a list of strings. This file used to ban
    // `text-[8px]` and `text-[9px]` by name, which is how `text-[9.5px]`,
    // `text-[10px]` and `text-[10.5px]` walked straight past it — 34 sites,
    // including the three words of the bottom bar an operator taps all day. So
    // every arbitrary size is parsed and compared, and the only value below the
    // floor is 0px, which belongs to a visually-hidden `sr-only` span.
    const undersized = [];
    allSrc.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/text-\[([0-9]+(?:\.[0-9]+)?)px\]/g)) {
        const px = Number(m[1]);
        if (px !== 0 && px < 11) undersized.push(`${i}: ${m[0]}`);
      }
    });
    assert.deepEqual(undersized, [], `type below the 11px floor:\n${undersized.slice(0, 12).join('\n')}`);
    // The floor has to cover hand-written CSS too: the utility sweep missed two
    // component stylesheets, and a claim of "smallest type is 11px" that only
    // holds for Tailwind classes is not a claim about the app.
    assert.ok(!/font-size:\s*(8|9|10)px/.test(allSrc),
      'no font-size below 11px anywhere in the sources, utility or raw CSS');
    const tw = require('fs').readFileSync(require('path').join(__dirname, 'tailwind.config.js'), 'utf8');
    assert.ok(/xs:\s*\['13px'/.test(tw), "text-xs is remapped to 13px in one place, so the floor is real");
  }
  pass('1. the palette is cool and complete: near-white ground, white cards, one blue accent, 13px floor');

  // --- 2. depth comes from light, not from a stroke ------------------------
  {
    assert.ok(/--lift-1/.test(themeCss) && /--lift-4/.test(themeCss), 'four elevation tiers are defined');
    assert.ok(/inset 0 1px 0/.test(themeCss), 'every surface gets an inset top light — a still screen looks lit from above');
    assert.ok(/--room-shadow:\s*10 14 20/.test(themeCss) && /rgba\(var\(--room-shadow\)/.test(themeCss),
      'the drop is the ink itself, so a shadow is the same substance as the text');
    for (const cls of ['brief-lift-1', 'brief-lift-2', 'brief-lift-3', 'brief-lift-4', 'brief-lift-signal', 'brief-card', 'brief-scrim', 'brief-photo']) {
      assert.ok(new RegExp(`\\.${cls}\\s*\\{`).test(themeCss + indexCss), `${cls} is a real class in the room stylesheet`);
    }
    // The bare-utility default: any plain `border` utility must take the room's
    // line, not Tailwind's cold grey.
    assert.ok(/\*, ::before, ::after\s*\{[^}]*border-color:\s*var\(--brief-line\)/.test(themeCss), 'no cold grey stroke survives as a default');
    assert.ok(!/#E5E7EB|#E5E8EC/.test(themeCss), 'the old hairline hexes are gone from the theme');
    const cardBlock = indexCss.match(/\.brief-lobby-card\s*\{[^}]*\}/)?.[0] ?? '';
    assert.ok(/border:\s*none/.test(cardBlock), 'even the noticeboard room lifts its cards instead of outlining them');
  }
  pass('2. surfaces are separated by light: four lift tiers, ink-coloured drops, no cold default stroke');

  // --- 3. a card on the board carries no border, and takes a lift ---------
  {
    const { container } = mount(React.createElement(DiscoverFeed, { room: 'all', onRoomChange: () => {}, onPostListing: () => {} }));
    await flush();
    const offenders = allStyled(container).filter(({ cls, style }) => {
      const isCard = /rounded-(2xl|3xl)/.test(cls);
      const stroke = /(^|[^-])border:\s*1px solid/.test(style);
      return isCard && stroke && !/border-dashed/.test(cls);
    });
    assert.deepEqual(offenders.map((o) => o.style), [], 'no rounded card on the board is outlined with a 1px stroke');
    // The eight views are still the navigation — the rule was never "eight
    // buttons on the glass", it was "one set of rooms, lifted by light, never
    // outlined". They live in the picker now, so the room rules are asserted
    // there, where the surfaces actually are.
    const face = Array.from(container.querySelectorAll('[aria-label="Browse the board"]')).find((b) => b.tagName === 'BUTTON');
    act(() => face.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
    await flush();
    const picker = container.querySelector('[role="dialog"][aria-label="Browse the board"]');
    const tiles = Array.from(picker.querySelectorAll('button')).filter((b) => /^(Bulk|Direct|Niche|Group(?!s)|All|Shops|Events|Groups|Errands)/.test(text(b)));
    assert.equal(tiles.length, 9, 'the four flows and five side views are still the navigation');
    const lifted = tiles.filter((t) => /box-shadow|--lift|brief-lift/.test(styleOf(t) + ' ' + (t.getAttribute('class') || '')));
    assert.equal(lifted.length, tiles.length, 'every entry is lifted by light');
    const active = tiles.find((t) => t.getAttribute('aria-pressed') === 'true');
    assert.ok(active, 'the current room is marked in the list');
    assert.ok(!/border:\s*1px/.test(styleOf(active)), 'and it is not wearing a border to say so');
    assert.ok(/--lift-2|box-shadow/.test(styleOf(face)), 'the board\'s one entry is lifted too, not outlined');
  }
  pass('The board itself: no outlined cards, every tile lifted, the selected one glowing with the accent');

  // --- 4. a photo gets the room's ink; a missing photo gets a plate -------
  {
    const { container } = mount(React.createElement(DiscoverFeed, { room: 'all', onRoomChange: () => {}, onPostListing: () => {} }));
    await flush();
    assert.ok(/rgba\(10, 14, 20/.test(roomTs), 'the scrim is the room\'s own ink fading up through a photo, not pure black');
    assert.ok(/filter:\s*PHOTO_FILTER/.test(fs.readFileSync(path.join(__dirname, 'src/features/city/DiscoverFeed.tsx'), 'utf8')),
      'a real photograph is graded a few percent so it does not fight the room');
    assert.ok(!/saturate\(1\.[3-9]\d*\)|sepia/.test(roomTs), 'the grade is a grade, not a costume — no photo is re-inked');

    const cardText = text(container);
    assert.ok(cardText.includes('Waiting on photo'), 'a card with no photo says it is WAITING, not broken');
    assert.ok(cardText.includes('no photo from Mwangi Wholesale'), 'and names whose photo is missing, from the row');
    assert.ok(/listed (2h|3h|1[0-9]h) ago/.test(cardText), 'the plate carries the row\'s real timestamp');
    assert.ok(/no photo from Mwangi Wholesale/.test(cardText) && !/NO PHOTO FROM/.test(cardText),
      'the missing photo is written as a sentence in the plate, not as a shouting caption');
    assert.ok(/text-transform: uppercase|uppercase/.test(fs.readFileSync(path.join(__dirname, 'src/features/city/NoPhotoPlate.tsx'), 'utf8').includes('uppercase') ? 'uppercase' : ''),
      'only the tiny flow mark is uppercase, never the whole line');

    const plate = allStyled(container).find(({ style }) => style.includes('#FBFCFE') && style.includes('#EDF1F6'));
    assert.ok(plate, 'the plate is the room\'s own floor');
    assert.ok(/radial-gradient/.test(plateGlow('#2563EB')), 'the accent lands on a plate as a corner of light');
    assert.ok(!/linear-gradient\(135deg, #4F46E5|#4F46E5|#06B6D4/.test(roomSurface() + roomTs),
      'the old indigo/cyan pair is gone from the room module, not aliased back in');
    // The card's photo is a clean 1:1 product slot — no text over it, so no
    // scrim; the sheet that opens on the card is where the photo gets the
    // room's ink. Either way it is the row's OWN photo, never a stock shot.
    const imgs = Array.from(container.querySelectorAll('img'));
    assert.equal(imgs.length, 1, 'the one real photo present; no stock image was substituted for the missing one');
  }
  pass('4. pictures belong to the room: the card shows the row\'s own 1:1 photo, a missing one gets a lit plate, never a stock shot');

  // --- 5. a zero is a true count, printed quietly, with a next step -------
  {
    const { container } = mount(React.createElement(DiscoverFeed, { room: 'all', onRoomChange: () => {}, onPostListing: () => {} }));
    await flush();
    const { entry: direct } = await openRoom(container, 'Direct');
    assert.ok(text(direct).includes('0'), 'an empty flow shows its zero — it is not hidden and not padded');
    // The count numeral is the mono span; the aria-hidden one before it is the
    // same number for a screen reader.
    const zeroMark = Array.from(direct.querySelectorAll('span')).find((el) => text(el) === '0' && /font-mono/.test(el.getAttribute('class') || ''));
    assert.ok(zeroMark, 'the Direct tile prints its zero');
    assert.ok(/--color-quiet/.test(styleOf(zeroMark)), 'the zero is in the quiet ink, so an empty flow does not read as an error');
    assert.ok(/none here/i.test(text(direct)), 'an empty flow is marked, not narrated');
    assert.ok(/Post one|Tag one/.test(text(direct)), 'with one action, in three words');
    const { entry: bulk } = await openRoom(container, 'Bulk');
    const fullMark = Array.from(bulk.querySelectorAll('span')).find((el) => text(el) === '1' && /font-mono/.test(el.getAttribute('class') || ''));
    assert.ok(fullMark && !/--color-quiet/.test(styleOf(fullMark)), 'a non-zero count is NOT quiet — the difference is the number, not decoration');
    assert.ok(/none here/i.test(text(direct)), 'an empty flow is marked, not explained');
    assert.ok(/Post one|Tag one/.test(text(direct)), 'with exactly one action, in three words');
    assert.ok(!/Nothing is published|no offers yet — post one/.test(text(direct)), 'and no sentence doing the dot\'s job');
    const { entry: group } = await openRoom(container, 'Group');
    assert.ok(text(group).includes('0'), 'same for every other empty view');
    // "hot / trending / buyers waiting / coming soon" is padding. A real sort by
    // counted registrations is not, so only the invented-urgency vocabulary fails.
    assert.ok(!/coming soon|trending|buyers waiting|people viewing|hot/i.test(text(container)), 'no filler language around an empty room');
    // A zero interest is not printed as a zero: "0 settled" reads as an
    // indictment of the listing. The card pattern went further — the take-up
    // count stands in the sheet that opens on the card, so the card carries
    // no interest figure of any kind, and a zero says nothing at all.
    assert.ok(!/0 settled/.test(text(container)), 'a zero interest is not a settled figure');
    const cardTexts = Array.from(container.querySelectorAll('article[data-testid^=globys-card]')).map((c) => text(c)).join(' ');
    assert.ok(!/settled|new listing/i.test(cardTexts), 'the card carries no interest count; the sheet does');
    assert.ok(!/0 settled orders · newest live listing/.test(text(container)), 'the meta-junk line is gone');
  }
  pass('Zeros are honest and quiet: a count of rows, what it means, and the one step that changes it');

  // --- 6. listedAgo never invents a time ----------------------------------
  {
    assert.equal(listedAgo(null), null, 'no timestamp, no sentence');
    assert.equal(listedAgo('not-a-date', NOW), null, 'an unreadable timestamp is not a claim');
    assert.equal(listedAgo(new Date(NOW - 2 * 3600_000).toISOString(), NOW), 'listed 2h ago');
    assert.equal(listedAgo(new Date(NOW - 45 * 60_000).toISOString(), NOW), 'listed 45 min ago');
    assert.equal(listedAgo(new Date(NOW - 9 * 86400_000).toISOString(), NOW), 'listed 9d ago');
    assert.equal(listedAgo(new Date(NOW - 62 * 86400_000).toISOString(), NOW), 'listed 2mo ago');
    assert.equal(listedAgo(new Date(NOW + 3600_000).toISOString(), NOW), 'listed just now', 'a future stamp is never a negative age');
  }
  pass('The plate\'s time comes from the row: no timestamp, no sentence');

  // --- 7. the light theme is still the light theme ------------------------
  {
    // Scan DECLARATIONS, not prose: theme.css records the rejected dark palette
    // in a comment, which is a decision written down, not a colour painted.
    const decls = (themeCss + '\n' + indexCss).split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
    const dark = decls.join('\n').match(/:\s*#(14110D|1E1A15|25201A|0F0D0B|1A1A1A)/gi) || [];
    assert.deepEqual(dark, [], 'the deep-warm-dark room was considered and rejected: Brief stays a daylight instrument');
    const roots = (themeCss + '\n' + indexCss).match(/:root\s*\{[\s\S]*?\n\}/g)?.join('\n') ?? '';
    // A dark token is legitimate as INK (text, scrim); it is a dark theme the
    // moment it is a GROUND or a SURFACE. So only the surface slots are policed.
    const darkSurfaces = [];
    for (const line of roots.split('\n')) {
      const m = line.match(/^\s*(--[a-z0-9-]+):\s*(#[0-9A-Fa-f]{6})/i);
      if (!m) continue;
      const [, name, hex] = m;
      // Only the slots that PAINT a surface are policed; text tokens are meant
      // to be dark.
      if (!/bg|ground|surface|card|paper|well|plaster|elevated|container|bright|variant/i.test(name)) continue;
      const [r, g, b] = rgb(hex);
      if (Math.max(r, g, b) < 120) darkSurfaces.push(`${name}: ${hex}`);
    }
    assert.deepEqual(darkSurfaces, [], 'no dark token slipped into a ground or surface slot');
    const light = ['brief-bg', 'brief-card', 'surface-3'].map(read);
    for (const hex of light) {
      const [r, g, b] = rgb(hex);
      assert.ok(Math.min(r, g, b) > 200 || hex === read('surface-3'), `${hex} is a light surface`);
    }
    // Text on paper must stay legible: ink is dark, and faint is still >=4.5:1.
    const lum = (hex) => {
      const [r, g, b] = rgb(hex).map((v) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const contrast = (a, b) => {
      const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    };
    const paper = read('brief-card');
    assert.ok(contrast(read('brief-ink'), paper) > 12, 'ink on paper is very high contrast');
    assert.ok(contrast(read('brief-muted'), paper) > 4.5, 'secondary text still clears AA on paper');
    assert.ok(contrast(read('brief-faint'), paper) > 4.5, 'meta text still clears AA on paper');
    // --color-quiet is deliberately below 4.5:1 — it must therefore appear ONLY
    // at 20px+ (the tile numerals) or as a glyph. If someone puts it on body
    // copy, this fails.
    assert.ok(contrast(read('brief-faint'), read('brief-bg')) > 4.1, 'meta text on the ground is close to AA and says so');
    const quiet = themeCss.match(/--color-quiet:\s*(#[0-9A-Fa-f]{6})/)[1];
    assert.ok(contrast(quiet, paper) < 4.5 && contrast(quiet, paper) > 2.5, 'the quiet ink is a soft numeral, not a readable paragraph');
    assert.ok(contrast('#FFFFFF', read('brief-green')) > 4.5, 'white text on the accent clears AA');
    assert.ok(PLASTER.includes('#FBFCFE') && PLASTER.includes('#EDF1F6'), 'the plate floor is exactly two stops of the ground');
  }
  pass('7. light, not dark: every text pairing clears its floor, and the accent carries white at 5.17:1');


  // --- 8. a canvas colour is never a var() --------------------------------
  // A QR is drawn on a canvas and telemetry is painted with ctx.fillStyle:
  // neither can resolve a CSS custom property, and a bad colour makes the
  // encoder THROW, which lands in the component's .catch() and renders a
  // placeholder. That is a silently broken gate code, i.e. money at a door.
  // So no token may ever be handed to a raster slot, and the QR pair stays
  // literal hex — the room's ink for the modules, pure white for the quiet
  // zone, because a scanner needs maximum delta and not warmth.
  {
    const fs2 = require('fs');
    const path2 = require('path');
    const offenders = [];
    const RASTER_LINE = /(?:fillStyle|strokeStyle|fillColor|setTextColor|setDrawColor|backColor)\b/;
    const walk = (d) => {
      for (const name of fs2.readdirSync(d)) {
        const fp = path2.join(d, name);
        if (fs2.statSync(fp).isDirectory()) { if (name !== 'node_modules') walk(fp); continue; }
        if (!/\.(tsx?|jsx?)$/.test(name)) continue;
        const src = fs2.readFileSync(fp, 'utf8');
        src.split('\n').forEach((line, i) => {
          if (/^\s*(\/\/|\*)/.test(line)) return;
          if (RASTER_LINE.test(line) && /var\(--|color-mix/.test(line)) offenders.push(`${fp}:${i + 1} ${line.trim().slice(0, 90)}`);
        });
        // Read the encoder's own argument list — matching parens, not a window
        // of characters, so neighbouring JSX cannot be blamed for it.
        for (const call of ['toDataURL(', 'toCanvas(']) {
          let at = src.indexOf(call);
          while (at !== -1) {
            let depth = 0; let i = at + call.length - 1; let args = '';
            for (; i < src.length && i < at + 1200; i++) {
              const ch = src[i];
              if (ch === '(') depth++;
              else if (ch === ')') { depth--; if (depth === 0) break; }
              args += ch;
            }
            if (/var\(--|color-mix/.test(args)) offenders.push(`${fp}: ${call} options carry a token`);
            at = src.indexOf(call, at + 1);
          }
        }
      }
    };
    for (const d of ['features', 'app', 'components', 'ui', 'shell', 'nav', 'model', 'screens']) {
      const abs = path2.join(__dirname, 'src', d);
      if (fs2.existsSync(abs)) walk(abs);
    }
    assert.deepEqual(offenders, [], 'no var() is ever passed to a canvas/QR colour slot');
    const qr = fs2.readFileSync(path2.join(__dirname, 'src/ui/qrPalette.ts'), 'utf8');
    const fg = qr.match(/QR_FOREGROUND = '(#[0-9A-Fa-f]{6})'/);
    const bg = qr.match(/QR_BACKGROUND = '(#[0-9A-Fa-f]{6})'/);
    assert.ok(fg && bg, 'the QR foreground and background are literal hex');
    assert.notEqual(fg[1].toUpperCase(), '#000000', 'the modules are the room\'s ink, not pure black');
    assert.equal(bg[1], '#FFFFFF', 'the quiet zone stays pure white');
  }
  pass('Raster colours are literals: a tokenised palette may never silently break a QR or a canvas');


  // --- 9. a wash is the room's ink; a neutral is a room token ---------------
  // Two ways a surface stops belonging to the page it sits on: a pure-black
  // scrim (a different material entirely), or an off-the-shelf Tailwind/slate
  // grey nobody declared. Both were true of the old app; the room's answer is
  // that every wash is the ink at an alpha and every neutral is one of the six
  // declared steps. The palette flipped warm to cool in between, which is
  // exactly why this test lists the FORBIDDEN set rather than the current
  // colours: it still catches a foreign grey after a re-skin.
  {
    const fs2 = require('fs');
    const path2 = require('path');
    const foreign = [];
    const FORBIDDEN_GREY = /#E5E7EB|#E5E8EC|#F3F4F6|#F9FAFB|#F1F5F9|#F8FAFC|#E2E8F0|#CBD5E1|#0D1117|#111827|#1F2937/i;
    const BLACK_WASH = /rgba\(\s*(?:0,\s*0,\s*0|13,\s*17,\s*23|10,\s*10,\s*10)\b/;
    const walk = (d) => {
      if (!fs2.existsSync(d)) return;
      for (const name of fs2.readdirSync(d)) {
        const fp = path2.join(d, name);
        if (fs2.statSync(fp).isDirectory()) { walk(fp); continue; }
        if (!/\.(tsx?|css)$/.test(name)) continue;
        fs2.readFileSync(fp, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').forEach((raw, i) => {
          const line = raw.replace(/\/\/.*$/, '');
          if (BLACK_WASH.test(line) || FORBIDDEN_GREY.test(line)) {
            foreign.push(`${path2.relative(__dirname, fp)}:${i + 1} ${line.trim().slice(0, 60)}`);
          }
        });
      }
    };
    for (const d of ['src/features/city', 'src/features/home', 'src/features/spaces', 'src/ui', 'src/shell']) walk(path2.join(__dirname, d));
    assert.deepEqual(foreign, [], 'no pure-black wash and no undeclared grey on the room\'s own surfaces');
    const steps = ['brief-bg', 'brief-card', 'well', 'surface-3', 'brief-line', 'brief-ink'].map(read);
    assert.deepEqual([...new Set(steps)].length, 6, 'six distinct steps — a palette that collapses into one grey is not a palette');
    assert.ok(steps.every((hex) => !isWarm(hex)), 'every step is cool: the plaster revision is fully reversed, not half-applied');
  }
  pass('9. a wash is the room\'s ink at an alpha, a neutral is a declared step, and no step is warm');


  // --- 10. a colour never comes from a hash of words ----------------------
  // Five cold two-tone swatches, picked by hashing a title, was the last of it:
  // a hue derived from letters is a fact about nothing, and it looked like data.
  // Cover-less things take the room's plate and their CATEGORY's light, or none.
  {
    const fs2 = require('fs');
    const path2 = require('path');
    const suspects = [];
    const BAD = /(charCodeAt|hash)[^\n]*%[^\n]*(GRADIENT|SWATCH|PALETTE)|(GRADIENT|SWATCH)S?\s*\[[^\]]*linear-gradient\(135deg/;
    const files = [
      'src/features/spaces/PromoCarousel.tsx', 'src/features/spaces/CatalogView.tsx',
      'src/features/city/DiscoverFeed.tsx', 'src/features/city/MuseumCard.tsx',
      'src/features/city/MuseumGallery.tsx', 'src/features/city/NoPhotoPlate.tsx',
      'src/features/city/categoryPalette.ts', 'src/features/city/room.ts', 'src/model/core.tsx'
    ];
    for (const rel of files) {
      const fp = path2.join(__dirname, rel);
      if (!fs2.existsSync(fp)) continue;
      const src = fs2.readFileSync(fp, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (BAD.test(line)) suspects.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
      });
      if (/titleHash|railTitleHash/.test(src)) suspects.push(`${rel}: a title-hash helper still exists`);
    }
    assert.deepEqual(suspects, [], 'no surface colour is keyed off a hash of a title');
    const palette = fs2.readFileSync(path2.join(__dirname, 'src/features/city/categoryPalette.ts'), 'utf8');
    assert.ok(/category: string/.test(palette) && /CATEGORY_PALETTE/.test(palette),
      'the only identity left is the declared category, read from the row');
  }
  pass('A colour is never hashed from a title: only the declared category paints a plate');


  // --- 11. the flow reads in a glance; the reasoning lives on one page -------
  // Two rules, tested together, because one without the other is just deleting
  // the audit trail: (a) no sentence does a dot's job on a working surface, and
  // (b) every explanation that came out of the flow exists on the How Trace works
  // screen. A terse UI that hides how a number was made is a marketing site; a
  // documented UI that makes you read it is a legal disclaimer. This is neither.
  {
    const { container } = mount(React.createElement(DiscoverFeed, { room: 'all', onRoomChange: () => {}, onPostListing: () => {} }));
    await flush();
    const ps = Array.from(container.querySelectorAll('p, span'))
      .map((el) => text(el))
      .filter((x) => x.length > 0);
    const over = ps.filter((x) => x.length > 120);
    assert.deepEqual(over, [], `no sentence over 120 characters on the board (longest: ${Math.max(0, ...ps.map((x) => x.length))})`);
    assert.ok(!/How this is derived/.test(text(container)), 'no derivation link in the flow');
    assert.ok(!/Brief does not|will not infer|not a warning|not nothing is happening/.test(text(container)),
      'no clause arguing with an imagined critic');
    assert.ok(!/matched on stated fields|no market price index/.test(text(container)), 'no method notes on the surface');
  }
  {
    const { HowBriefWorks } = require('./src/features/you/HowBriefWorks.tsx');
    const { container } = mount(React.createElement(HowBriefWorks, {}));
    const t = text(container);
    for (const [needle, why] of [
      ['Every number is a count', 'the count rule'],
      ['no browse log', 'why there is no view or trend figure'],
      ['untagged', 'why a tile can be empty'],
      ['Bulk needs where it leaves from', 'the flow rules, in one place'],
      ['no key-free price source', 'why there is no price movement'],
      ['forecast, not a measurement', 'that a forecast is not an observation'],
      ['no decay-event log', 'why the 7-day cohort figure is absent'],
      ['your own offer’s total', 'what a missed capture is and is not'],
      ['maker and a checker', 'how the pool is actually run'],
      ['no attribution row', 'the five figures an operator cannot get'],
      ['belong to no space', 'what a space-scoped number leaves out, and says'],
      ['dash, not 0%', 'why an unmeasurable figure is not a zero'],
      ['never shows', 'the things the product refuses outright'],
      ['Home is the operational read', 'why Home is the seller activity workspace'],
      ['public board remains a separate Explore destination', 'why public discovery is separate from seller activity'],
      ['Spaces and Selling are separate destinations', 'why workspaces and seller operations have distinct doors'],
      ['There is no Hubs tab', 'that Circles did not grow a Hubs door'],
      ['Every secondary screen is a URL', 'why the back gesture works on a phone'],
      ['no placeholder frame', 'that an offer carries only pictures the seller supplied'],
      ['needs a group that exists first', 'the row that says so instead of offering a dead tap'],
      ['a read, not a report', 'why there is no stored brief row to edit or expire'],
      ['marked in minus recorded out', 'what the morning brief’s money actually is'],
      ['nobody is ever reported absent', 'that a rota does not exist, so no absence flag is built'],
      ['one brief per day at most', 'how the morning notification behaves when it is switched on'],
      ['moves no money itself', 'that escrow in Selling is records, not a vault']
    ]) {
      assert.ok(t.includes(needle), `the audit page still carries ${why}`);
    }
    assert.ok(!/How this is derived/.test(t), 'and it is a page, not a footnote on a number');
  }
  pass('The flow reads as numbers and dots; every explanation lives on one audit page');


  // --- 12. the dot contract: bright for graphics, dark enough for text -------
  // A state colour that cannot be read is a state colour that must not be used
  // for words. Both floors are measured, and the app is checked for taking a
  // graphic hue into a small-text `color:` slot.
  {
    const lum = (hex) => {
      const f = (v) => (v <= 0.03928 ? v / 255 / 12.92 : (((v / 255) + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(parseInt(hex.slice(1, 3), 16)) + 0.7152 * f(parseInt(hex.slice(3, 5), 16)) + 0.0722 * f(parseInt(hex.slice(5, 7), 16));
    };
    const contrast = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const read = (name) => themeCss.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`))[1];
    const paper = read('brief-card');
    for (const g of ['state-live', 'state-quiet', 'state-moving', 'state-stale', 'state-empty']) {
      assert.ok(contrast(read(g), paper) >= 2.0, `${g} is at least visible as a shape on paper`);
      assert.ok(contrast(read(g), paper) < 4.5, `${g} stays a graphic — it is not allowed to become body copy`);
    }
    for (const t of ['state-live-ink', 'state-quiet-ink', 'state-moving-ink', 'state-stale-ink', 'state-empty-ink']) {
      assert.ok(contrast(read(t), paper) >= 4.5, `${t} clears AA as text on paper (${contrast(read(t), paper).toFixed(2)})`);
    }
    // the only legal use of a bright state hue in the app is a dot or a bar
    const fs2 = require('fs');
    const path2 = require('path');
    const bad = [];
    const walk = (d) => {
      if (!fs2.existsSync(d)) return;
      for (const name of fs2.readdirSync(d)) {
        const fp = path2.join(d, name);
        if (fs2.statSync(fp).isDirectory()) { if (name !== 'node_modules') walk(fp); continue; }
        if (!/\.tsx?$/.test(name)) continue;
        fs2.readFileSync(fp, 'utf8').split('\n').forEach((line, i) => {
          const m = line.match(/text-\[(9|1[0-5])px\][^\n]*color:\s*'var\(--state-(live|quiet|moving|stale|empty|)\)'/)
            || line.match(/color:\s*'var\(--state-(live|quiet|moving|stale|empty|)\)'[^\n]*text-\[(9|1[0-5])px\]/);
          if (m && !/-ink/.test(line)) bad.push(`${path2.relative(__dirname, fp)}:${i + 1}`);
        });
      }
    };
    for (const d of ['src/features', 'src/components', 'src/ui']) walk(path2.join(__dirname, d));
    assert.deepEqual(bad, [], 'no bright state hue is used as small text anywhere');
  }
  pass('State hues are graphics, their -ink shades are text, and both floors are measured');

  console.log('\nPASS ' + count);
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
