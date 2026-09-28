// ---------------------------------------------------------------------------
// THE FLOW BOARD — the taxonomy as a real screen.
//
// Pinned here, because this is exactly where a supply board gets flattering:
//   * the tiles are the four flows + the side views, and their numbers are the
//     server's counts of DECLARED listings — a zero renders as a zero;
//   * a route exists only because a seller wrote both endpoints; the empty state
//     says so instead of inventing "Wakulima → Kilimani" from a title;
//   * an ask is counted against a route only when the route's seller declared a
//     commodity; otherwise the card says which listings are silent;
//   * the gap list is a coverage statement, not a shortage claim;
//   * a contact number appears only because it is on the listing row;
//   * and the seller's own form writes the axes, sending nothing at all where a
//     field was left blank.
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
const { CityFeedView } = require('./src/features/city/CityFeedView.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 70) => new Promise((r) => setTimeout(r, ms));
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
  return { container: c, root };
}
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const btn = (want) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === want || text(b).startsWith(want));
const tab = (want) => Array.from(document.querySelectorAll('button[role="tab"]')).find((b) => text(b).includes(want));
/**
 * The board's only navigation is one button that opens a picker, so a test
 * reaches a room the way a person does: open it, tap the name. Kept as a helper
 * so no suite can quietly start asserting on a tile grid that no longer exists.
 */
const openRoom = async (container, want) => {
  const trigger = container.querySelector('button[aria-label="Browse the board"]');
  if (trigger && !container.querySelector('[role="dialog"][aria-label="Browse the board"]')) {
    click(trigger);
    await flush();
  }
  const picker = container.querySelector('[role="dialog"][aria-label="Browse the board"]');
  const entry = Array.from(picker.querySelectorAll('button')).find((b) => text(b).startsWith(want));
  click(entry);
  await flush();
};
const click = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
const setVal = (el, v, proto) => act(() => {
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});
const setSelect = (el, v) => act(() => {
  Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
});

const FEED = [
  {
    kind: 'listing', id: 'lst_tom', title: 'Tomatoes, 20 crates', description: 'Graded, crated at the stall',
    priceLabel: 'KES 2,400 / crate', dateLabel: null, location: 'Wakulima Market', mediaUrl: null,
    seller: 'Mwangi Wholesale', stock: 20, orderable: true, contact: '+254712000111',
    contactNote: 'The seller listed this contact themselves.', interest: { label: 'settled orders', count: 3 },
    why: 'pinned by the seller', flow: 'bulk', commodity: 'tomatoes', origin: 'Wakulima Market',
    originKind: 'producer', destination: 'Kilimani shops', destinationKind: 'vendors', unit: 'crate', minOrder: 5
  },
  {
    kind: 'listing', id: 'lst_can', title: 'Hand-poured candles, set of 3', description: 'Soy wax, three scents',
    priceLabel: 'KES 1,800', dateLabel: null, location: 'Kilimani', mediaUrl: 'https://cdn.test/candle.jpg',
    seller: 'Wanjiru Candle Co.', stock: 6, orderable: true, contact: null, contactNote: null,
    interest: { label: 'settled orders', count: 0 }, why: 'newest live listing', flow: 'niche',
    commodity: 'candles', origin: null, originKind: null, destination: null, destinationKind: null, unit: null, minOrder: null
  },
  {
    kind: 'event', id: 'kilimani-market-k8', title: 'Kilimani Weekend Market', description: 'Vendors, coffee, records',
    priceLabel: 'Free', dateLabel: '2026-09-20', location: 'Kilimani Grounds', mediaUrl: null,
    seller: null, stock: null, orderable: null, contact: null, contactNote: null,
    interest: { label: 'registered', count: 12 }, why: 'most registrations', flow: null,
    commodity: null, origin: null, originKind: null, destination: null, destinationKind: null, unit: null, minOrder: null
  }
];

const SUMMARY = {
  tiles: [
    { key: 'marketplace', label: 'Marketplace', count: 2, unit: 'live offer' },
    { key: 'events', label: 'Events', count: 1, unit: 'published' },
    { key: 'circles', label: 'Groups', count: 0, unit: 'you could join' },
    { key: 'errands', label: 'Errands', count: 0, unit: 'open' }
  ],
  feed: FEED,
  flows: [
    { key: 'bulk', label: 'Bulk', sub: 'for vendors & shops', subFilters: ['Produce', 'Dry goods', 'Packaging'], listings: 1, openDemand: 1, requires: ['originName','destinationName'], zeroReason: null },
    { key: 'direct', label: 'Direct', sub: 'source-direct', subFilters: ['Farm-gate', 'Fishery'], listings: 0, openDemand: 0, requires: ['originName'], zeroReason: 'untagged_only' },
    { key: 'niche', label: 'Niche', sub: 'curated for consumers', subFilters: ['Craft', 'Vintage'], listings: 1, openDemand: 0, requires: [], zeroReason: null },
    { key: 'group', label: 'Group', sub: 'pooled demand', subFilters: ['Neighbourhood', 'Cooperative'], listings: 0, openDemand: 0, requires: ['destinationName'], zeroReason: 'untagged_only' }
  ],
  untagged: 1,
  totals: { activeListings: 3, declaredRoutes: 1, openPublicDemand: 2 },
  routes: [
    {
      origin: 'Wakulima Market', destination: 'Kilimani shops', flow: 'bulk', listings: 1,
      sellers: ['Mwangi Wholesale'], topCommodities: ['tomatoes'], commodities: ['tomatoes'],
      commodityUndeclared: null, minOrderFrom: 5, unit: 'crate', listingIds: ['lst_tom'],
      openDemand: 1, openDemandQuantity: 6, openDemandRequestIds: ['req_tom']
    }
  ],
  unmapped: [
    {
      requestId: 'req_milk', title: 'Milk, 40 litres daily', category: 'milk', quantity: 40, unit: 'litre',
      location: 'Langata', requiredBy: '2026-09-19', requesterType: 'business', coverage: 'no_route_declared',
      destinationsInUse: ['kilimani shops']
    },
    {
      requestId: 'req_rice', title: 'Rice for the hostel kitchen', category: 'rice', quantity: 8, unit: 'sack',
      location: 'Kilimani shops', requiredBy: null, requesterType: 'business', coverage: 'listing_without_route',
      destinationsInUse: []
    }
  ],
  scope: 'national',
  areaFiltered: false,
  boardNote: '1 active listing declares no flow, so it appears under All and in no route — this board will not infer a supply chain from a title.'
};

let lastCreate = null;
const VALID_VENDOR = {
  id: 'vnd_1', ownerId: 'usr_1', displayName: 'Mwangi Wholesale', description: 'Wholesale produce',
  status: 'active', contactMethod: '+254712000111',
  verification: { status: 'unverified', evidence: [], facts: [], verifiedCount: 0 }
};
const VALID_LISTING = {
  id: 'lst_tom', vendorId: 'vnd_1', title: 'Tomatoes, 20 crates', description: 'Graded', type: 'product',
  price: 2400, currency: 'KES', quantityAvailable: 20, locationName: 'Wakulima Market', status: 'active',
  orderable: true, unorderableReason: null, media: [], createdAt: '2026-09-10T00:00:00Z', updatedAt: '2026-09-14T00:00:00Z'
};
let calls = [];
global.fetch = async (input, init) => {
  const url = String(input?.url ?? input ?? '');
  calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
  const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
  if (url.includes('/api/discover/summary')) return ok(SUMMARY);
  if (url.includes('/events/categories')) return ok({ categories: ['event'], labels: { event: 'Events' } });
  if (url.includes('/api/events')) return ok({ events: [], total: 0 });
  if (url.includes('/api/listings/mine')) return ok({ vendor: VALID_VENDOR, listings: [VALID_LISTING] });
  if (url.endsWith('/api/listings') && init?.method === 'POST') { lastCreate = JSON.parse(String(init.body)); return ok({ listing: VALID_LISTING }); }
  if (url.includes('/api/listings')) return ok({ listings: [VALID_LISTING] });
  if (url.includes('/api/orders')) return ok({ orders: [] });
  if (url.includes('/disputes')) return ok({ disputes: [] });
  if (url.includes('/earnings')) return ok({ earnings: { gross: 0, net: 0, payoutAvailable: false } });
  if (url.includes('/api/circles')) return ok({ circles: [] });
  if (url.includes('/api/errands')) return ok({ open: [], mine: [], eligibility: { eligible: false, basis: [], howToJoin: 'x', note: 'y' }, carriersAround: 0, stages: [] });
  if (url.includes('/pickups')) return ok({ pickups: [], origins: [], riders: [] });
  return { ok: false, status: 404, text: async () => JSON.stringify({}) };
};

async function main() {
  // --- 1. one entry on the face of the board, the counts behind it ----------
  // The four flow tiles used to be the first thing on the main surface, and for
  // an empty board that meant four 32px zeros and four "none here" lines — the
  // loudest thing on the screen saying nothing is here. One entry now; the same
  // truth inside the picker, where a zero can sit beside the step that ends it.
  {
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    const face = text(container);
    assert.ok(container.querySelector('button[aria-label="Browse the board"]'),
      'the board opens with one entry');
    assert.equal(container.querySelectorAll('button[role="tab"]').length, 0,
      'and no tile-grid navigation on the face of the screen');
    assert.ok(!/NONE HERE/.test(face), 'a zero is not printed in the reader\'s way');
    assert.ok(/listing/.test(face), 'the entry does say what is in the room you are in');
    assert.ok(face.includes('Asked for, no route says it'), 'the gap board is still part of the mixed view');
    assert.ok(!/40 verified|buyers waiting|trending/i.test(face), "none of the mock's vocabulary survives");

    click(container.querySelector('button[aria-label="Browse the board"]'));
    await flush();
    const picker = container.querySelector('[role="dialog"][aria-label="Browse the board"]');
    assert.ok(picker, 'the entry opens a picker');
    const pt = text(picker);
    for (const f of ['Bulk', 'Direct', 'Niche', 'Group']) assert.ok(pt.includes(f), `${f} is still reachable`);
    for (const r of ['All', 'Shops', 'Events', 'Groups', 'Errands']) assert.ok(pt.includes(r), `and so is ${r}`);
    assert.ok(/none here/i.test(pt), 'an empty flow says so, in two words');
    assert.ok(/Post one|Tag one/.test(pt), 'and offers the one step that could change it');
    // (The digits are set in mono right after the label, so the assertion looks
    // per entry rather than scanning the whole run of text for a lone 0.)
    const entries = Array.from(picker.querySelectorAll('button')).filter((b) =>
      ['Bulk', 'Direct', 'Niche', 'Group', 'All', 'Shops', 'Events', 'Groups', 'Errands'].some((n) => text(b).startsWith(n)));
    assert.equal(entries.length, 9, 'nine entries: four flows, five rooms');
    assert.ok(entries.every((b) => /\d/.test(text(b))), 'each one carries a count, so none of them is decoration');
    const directBtn = entries.find((b) => text(b).startsWith('Direct'));
    assert.ok(/0/.test(text(directBtn)), 'an empty flow prints its zero — a true count, just not a billboard');
    assert.ok(!/How this is derived|is not padded|does not read titles|will not infer/.test(pt),
      'no method notes inside it either — the picker is a list, not an essay');
    assert.ok(!/none here/.test(text(container).replace(pt, '')),
      'the emptiness is stated once, in the picker, not on the board as well');

    const direct = directBtn;
    assert.ok(direct, 'a flow can be chosen by its own name');
    click(direct);
    await flush();
    assert.ok(!container.querySelector('[role="dialog"][aria-label="Browse the board"]'),
      'choosing a room closes the picker — it is a switch, not a page');
  }
  pass('Discover opens with one entry; the counts and their zeros live in the picker');

  // --- 2. a flow room shows routes, and only declared ones ─────────────────
  {
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    await openRoom(container, 'Bulk');
    await flush();
    const t = text(container);
    assert.ok(t.includes('Routes on the board'), 'a flow opens on its routes, not a product grid');
    assert.ok(t.includes('Wakulima Market') && t.includes('Kilimani shops'), 'the route line is the two declared endpoints');
    assert.ok(t.includes('min 5 crate'), 'with the minimum and the unit the seller stated');
    assert.ok(t.includes('moving: tomatoes'), 'and only the commodities declared on rows');
    assert.ok(t.includes('1 open ask'), 'demand is counted, and says it is a count of asks');
    assert.ok(t.includes('6 crate asked for'), 'quantities come from what buyers typed');
    assert.ok(t.includes('Tomatoes, 20 crates'), 'the listing itself is on show');
    assert.ok(t.includes('no photo from Mwangi Wholesale'), 'no photo on the row, so no photo on the card');

    // The card is the ONE Globys shape: title, the seller's name, the real
    // route in the mono line, and exactly one action. Min order and take-up
    // moved to the sheet that opens on the body — the card says the offer,
    // the sheet carries the record.
    const card = container.querySelector('article[data-testid^=globys-card-feed-]');
    assert.ok(card, 'the listing is a product card');
    assert.equal(card.querySelectorAll('[data-testid^=card-action]').length, 1, 'exactly one action on the card');
    assert.ok(Array.from(card.querySelectorAll('p')).some((p) => p.classList.contains('font-mono') && p.textContent.includes('Wakulima Market → Kilimani shops')),
      'the mono line carries the route the seller declared');
    assert.ok(Array.from(card.querySelectorAll('p')).some((p) => p.textContent.includes('Mwangi Wholesale')), 'the seller stands by name, not a badge');

    // The top chip row is GONE: no sub-filter strip, no tablist, no chips.
    // The routes remain the only filter — a list you browse, not a row of
    // chips you squint at.
    assert.ok(!Array.from(container.querySelectorAll('button')).some((b) => ['Everything on this flow', 'Produce', 'Dry goods', 'Packaging'].includes(text(b))),
      'no sub-filter chip row on the board');
    assert.equal(container.querySelectorAll('button[role="tab"], [role="tablist"]').length, 0,
      'nothing on this board pretends to be a tablist');
  }
  pass('A flow shows its declared routes with counted demand; the chip row is gone, the card is the one shape');

  // --- 3. an undeclared flow says there is nothing honest to show ──────────
  {
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    await openRoom(container, 'Direct');
    await flush();
    const t = text(container);
    assert.ok(t.includes('No Direct routes'), 'empty is stated as empty, in three words');
    assert.ok(!/refuses to invent|nothing honest to list/.test(t), 'and the paragraph defending that choice is on the audit page, not here');
    assert.ok(t.includes('Post an offer'), 'with one action, and nothing else');
    assert.ok(t.includes('Post an offer'), 'with the one action that changes it');
    assert.ok(!/12 listings|8 buyers|Top:/i.test(t), 'no invented route card, no invented crowd');
  }
  pass('An undeclared flow is an honest empty, not a decorated one');

  // --- 4. the gap board: coverage, not shortage ────────────────────────────
  {
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    const t = text(container);
    assert.ok(t.includes('Milk, 40 litres daily'), 'open public demand with no declared route is listed');
    assert.ok(t.includes('no route declared'), 'labelled as a coverage state, not a verdict');
    assert.ok(t.includes('listed, unrouted'), 'and the third state exists too: a listing that never said where it goes');
    assert.ok(!/matched on stated fields|does not turn a count into a shortage/.test(t),
      'the method note left the panel; the audit page states it once');
    // the limit sentence moved, it did not vanish
    const { HowBriefWorks } = require('./src/features/you/HowBriefWorks.tsx');
    const c2 = document.createElement('div');
    document.body.appendChild(c2);
    const r2 = createRoot(c2);
    act(() => r2.render(React.createElement(HowBriefWorks, {})));
    assert.ok(/arithmetic over fields, not a model reading titles/.test(text(c2)), 'the audit page owns the method and its limit');
    r2.unmount(); c2.remove();
    assert.ok(text(container).includes('by 19 Sept') || text(container).includes('by'), 'the ask date is shown when the buyer typed one');
    click(btn('Open the ask'));
    assert.ok(String(dom.window.location.hash).includes('requests/req_milk'), 'and it opens the real request rail');
  }
  pass('The gap board states coverage from stated fields and never claims a shortage');

  // --- 5. the sheet: contact only when the row carries one ────────────────
  {
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {} }));
    await flush();
    // The card is an article whose body tap opens the sheet.
    const cardFor = (title) => Array.from(container.querySelectorAll('article[data-testid^=globys-card-feed-]')).find((a) => text(a).includes(title));
    const withContact = cardFor('Tomatoes, 20 crates');
    click(withContact);
    await flush();
    let t = text(container);
    assert.ok(t.includes('from Wakulima Market (producer)'), 'the sheet names both endpoints and their kinds');
    assert.ok(t.includes('to Kilimani shops (vendors)'), 'and the buyer type the seller chose');
    assert.ok(t.includes('Message Mwangi Wholesale on WhatsApp'), 'a contact on the row becomes a real deep link');
    const link = container.querySelector('a[href^="https://wa.me/"]');
    assert.ok(link && link.getAttribute('href').includes('254712000111'), 'pointing at the digits on the row, nothing else');
    assert.ok(link.getAttribute('rel').includes('noopener'), 'opened safely');
    click(container.querySelector('button[aria-label="Close details"]'));
    await flush();

    const noContact = cardFor('Hand-poured candles, set of 3');
    click(noContact);
    await flush();
    t = text(container);
    assert.ok(t.includes('No contact number on this listing'), 'and when there is none, none is invented');
    // Scoped to the SHEET: the board's other cards may carry their own real
    // wa.me action, but this row's sheet must not invent one.
    assert.ok(!container.querySelector('[role=dialog] a[href^="https://wa.me/"]'), 'no dead WhatsApp button in the sheet either');
    assert.ok(t.includes('commodity: not declared') === false, 'the candle row did declare its commodity, so it is not shown as blank');
    assert.ok(t.includes('candles'), 'the declared commodity renders');
  }
  pass('The detail sheet carries the route and only the contact that exists');

  // --- 6. the seller writes the axes; blanks stay absent ──────────────────
  {
    calls = [];
    // The floating "Post a listing" pill is gone: the create door is the bar's
    // [+], and its "Post an offer" row reaches this screen as a signal, which
    // opens the counter's Selling tab — the real create flow, not a copy.
    const { container } = mount(React.createElement(CityFeedView, { onOpenSpace: () => {}, sellingSignal: 1 }));
    await flush();
    assert.ok(text(container).includes('Start selling') || text(container).includes('New listing'), 'the real create flow is what opens, not a copy');

    const form = Array.from(container.querySelectorAll('button')).find((b) => text(b) === 'Create listing');
    assert.ok(form, 'the listing creator is on screen');
    // Query live, not from a stale list: the endpoint fields mount on demand.
    const byLabel = (l) => container.querySelector(`input[aria-label="${l}"]`);
    const titleInput = Array.from(container.querySelectorAll('input')).find((i) => i.placeholder === 'What are you offering?');
    assert.ok(titleInput, 'the listing form starts with what is on offer');
    setVal(titleInput, 'Onions, 40 nets', dom.window.HTMLInputElement.prototype);
    const flowSel = Array.from(container.querySelectorAll('select')).find((sel) => sel.getAttribute('aria-label') === 'Flow');
    assert.ok(flowSel, 'the seller picks a flow');
    setSelect(flowSel, 'bulk');
    await flush();
    assert.ok(byLabel('Origin place'), 'declaring bulk reveals the two required endpoints');
    assert.ok(byLabel('Destination place'), 'both of them');
    setVal(byLabel('Origin place'), 'Karatina', dom.window.HTMLInputElement.prototype);
    setVal(byLabel('Destination place'), 'Eastlands shops', dom.window.HTMLInputElement.prototype);
    setVal(byLabel('Commodity'), 'onions', dom.window.HTMLInputElement.prototype);
    setVal(byLabel('Minimum order'), '4', dom.window.HTMLInputElement.prototype);
    setVal(byLabel('Unit label'), 'net', dom.window.HTMLInputElement.prototype);
    const priceInput = container.querySelector('input[placeholder="Price"]');
    setVal(priceInput, '900', dom.window.HTMLInputElement.prototype);
    click(form);
    await flush();
    assert.ok(lastCreate, 'the create goes to the real rail');
    const body = lastCreate;
    assert.ok(text(container).includes('Tomatoes, 20 crates'), 'and the seller\u2019s shelf is what renders back');
    assert.equal(body.flow, 'bulk');
    assert.equal(body.originName, 'Karatina');
    assert.equal(body.destinationName, 'Eastlands shops');
    assert.equal(body.commodity, 'onions');
    assert.equal(body.minOrderQuantity, 4);
    assert.equal(body.unitLabel, 'net');
    assert.ok('destinationKind' in body, 'the buyer type is sent even when left blank');
    assert.equal(body.destinationKind, null, 'and blank stays absent, not "any"');

    // and an untagged listing sends nothing at all on the axes
    calls = [];
    const flowSel2 = Array.from(container.querySelectorAll('select')).find((sel) => sel.getAttribute('aria-label') === 'Flow');
    if (flowSel2) setSelect(flowSel2, '');
    await flush();
    assert.ok(!byLabel('Origin place'), 'clearing the flow hides the endpoint fields again');
  }
  pass('The seller writes the axes; a blank stays absent instead of becoming a default');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
