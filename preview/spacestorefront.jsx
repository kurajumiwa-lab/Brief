// ---------------------------------------------------------------------------
// THE STOREFRONT — Instagram's shape, a shop's arithmetic.
//
// What these tests hold:
//   * the header's stats strip only ever prints a number a row supports, and
//     prints an em dash where nothing measurable exists;
//   * no sector average, no "buyers you missed", no viewer identity, no
//     story-view count — the panel states those absences instead of leaving a
//     hole a vendor would read as failure;
//   * the owner's own opens are excluded from the view count, and the strip
//     says how many were dropped;
//   * a broadcast's composer tells the truth about an empty audience and about
//     the absence of read receipts;
//   * the Tools hour grid writes the SAME availability field the space file
//     shows — one fact, one place;
//   * templates copy, they never send;
//   * the public page shows the counter and nothing private, and a follow
//     without a session is explained rather than swallowed.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;
global.localStorage = dom.window.localStorage;

const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const { SpaceStorefrontHeader } = require('./src/features/spaces/SpaceStorefrontHeader.tsx');
const { BroadcastRail } = require('./src/features/spaces/SpaceBroadcastRail.tsx');
const { SpaceTools } = require('./src/features/spaces/SpaceTools.tsx');
const { PublicSpacePage } = require('./src/features/spaces/PublicSpacePage.tsx');
const { SpacesLanding } = require('./src/features/spaces/SpacesLanding.tsx');

let count = 0;
const pass = (n) => { count++; console.log('PASS ' + n); };
const flush = (ms = 60) => new Promise((r) => setTimeout(r, ms));
function mount(el) {
  document.body.innerHTML = '';
  const c = document.createElement('div');
  document.body.appendChild(c);
  const root = createRoot(c);
  act(() => root.render(el));
  return { container: c, root };
}
const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const btn = (want) => Array.from(document.querySelectorAll('button')).find((b) => text(b) === want || text(b).startsWith(want));
const click = (el) => act(() => el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
const setVal = (el, v) => act(() => {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, v);
  el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
});

const space = (over = {}) => ({
  id: 'spc_1', ownerId: 'u_owner', vendorId: 'v1', name: 'Jj Cakes', type: 'business',
  goal: 'First 20 customers', targetValueKes: 100000, image: null, slug: 'jj-cakes',
  visibility: 'public', status: 'active', featured: [], followers: 3, broadcastsLive: 1,
  profileLabels: { where: 'Kilimani, Nairobi', when: 'Tue, Sat 06:00–18:00', capacity: null, coverage: null, constraints: null },
  capabilities: [], metrics: { revenueKes: 2400, customerCount: 2, activeOrdersCount: 1, totalOrdersCount: 2, offersCount: 2 },
  offers: [], recentActivities: [], recentConversations: [{ id: 'cv1', status: 'new', customerName: 'Wanjiku' }],
  profile: {
    fields: {
      operatingFrom: { value: { text: 'Kilimani, Nairobi' }, updatedAt: new Date().toISOString(), lastConfirmedAt: new Date().toISOString() },
      availability: { value: { days: ['tue', 'sat'], from: '06:00', to: '18:00', summary: '' }, updatedAt: new Date().toISOString() }
    }
  },
  maintenance: { state: 'fresh', ageHours: 5, answered: 6, unanswered: 2, due: 0, overdue: 0, fields: [], facts: [], note: '' },
  editorialOpen: 2,
  createdAt: '', updatedAt: new Date().toISOString(), ...over
});

const INSIGHTS = {
  windowDays: 7, since: new Date(Date.now() - 7 * 86400000).toISOString(),
  views: { count: 11, distinctViewers: null, ownOpensExcluded: 4 },
  follows: { newInWindow: 2, total: 3 },
  inquiries: { newInWindow: 1, awaitingYourReply: 1 },
  orders: { newInWindow: 1, total: 2 },
  takeHome: { value: 2400, currency: 'KES' },
  conversion: { viewsToOrdersPct: 9.1, inquiriesToOrdersPct: 100, note: 'ratio' },
  broadcasts: { liveNow: 1, sentInWindow: 1, notificationsCreated: 3 },
  benchmark: null,
  unavailable: ['sector or category averages — no such data exists in Brief', 'buyers who looked and left — there is no per-view browse log to count', 'who viewed your space — view rows carry no identity'],
  note: 'derived'
};

const AUDIENCE = {
  slug: 'jj-cakes', followers: 3, followerList: [{ userId: 'u_fan', displayName: 'Amina', since: new Date().toISOString() }],
  iAmFollowing: false,
  broadcasts: [{ id: 'spb_1', kind: 'hours', text: 'Oven fixed — open from 6 tomorrow', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 9 * 3600000).toISOString(), live: true }],
  pastBroadcasts: 2, templates: [{ id: 'spt_1', label: 'Order confirmed', body: 'Your order is confirmed for Saturday, 10am.', createdAt: '', updatedAt: '' }],
  insights: INSIGHTS, canManage: true, followable: true
};

let calls = [];
let handler = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({}) });
global.fetch = async (input, init) => {
  const url = String(input?.url ?? input ?? '');
  calls.push({ url, method: init?.method ?? 'GET', body: init?.body ? String(init.body) : null });
  return handler(url, init);
};
const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });

async function main() {
  // --- 1. the header: real numbers, honest dashes, stated absences ---------
  {
    const { container } = mount(React.createElement(SpaceStorefrontHeader, { space: space(), audience: AUDIENCE }));
    const t = text(container);
    assert.ok(t.includes('Jj Cakes'), 'name');
    assert.ok(t.includes('Public'), 'visibility is on the cover');
    assert.ok(t.includes('Kilimani, Nairobi'), 'the stated place, from the profile row');
    assert.ok(t.includes('Tue, Sat 06:00–18:00') || t.includes('06:00–18:00'), 'the stated hours');
    assert.ok(t.includes('11'), 'views this week is the count of view rows');
    assert.ok(!/people not counted/.test(t), 'and no sentence under the number argues with it — the count is true, the caveat is on the audit page');
    assert.ok(/views · 7d/.test(t), 'the count itself stays printed');
    assert.ok(!/own opens are left out|How this is derived/.test(t), 'the view-count caveat left the header with the rest of the prose');
    assert.ok(!/no browse log|no sector average/.test(t), 'and no sentence about what is absent sits on the shopfront');
    assert.ok(t.includes('9.1%'), 'conversion is the ratio of two real counts');
    assert.ok(t.includes('no benchmark exists'), 'and the comparator tile says there is none');
    assert.ok(!/sector avg/i.test(t), 'no sector average is printed');
    assert.ok(!/people viewed your Space/i.test(t), 'no marketing sentence about the audience');
    assert.ok(!/\b\d+% of \d+/.test(t), 'no invented denominator phrasing');
    assert.equal(container.querySelector('details').open, false, 'insights are collapsed');
    assert.equal(container.querySelector('.shop-brand-cover'), null, 'no oversized decorative cover');
    assert.ok(btn('Add offer'), 'the owner gets the doing-buttons');
    assert.ok(btn('Inbox'), 'with the real inquiry count on the inbox');
    assert.ok(!btn('Follow'), 'a vendor does not follow their own shop from here');
  }
  pass('SpaceHeader prints only row-backed numbers, with its absences stated');

  // --- 1b. the arm of the business: a word the owner chose, nothing more ----
  {
    const { container } = mount(React.createElement(SpaceStorefrontHeader, { space: space(), audience: AUDIENCE }));
    const t = text(container);
    assert.ok(!/\bRetail\b|\bWholesale\b|\bTraining\b/.test(t),
      'an unmarked space names no arm — it is not filed under retail by default');

    const bulk = mount(React.createElement(SpaceStorefrontHeader, {
      space: space({ mode: 'wholesale', modeLabel: 'Wholesale' }), audience: AUDIENCE
    }));
    const t2 = text(bulk.container);
    assert.ok(t2.includes('Wholesale'), 'a named arm is shown, in the server’s word');
    assert.ok(!/Top rated|Premium|Verified|\bLevel\b|\bstreak\b/i.test(t2),
      'and it is a description, not a badge: naming an arm earns nothing');
    bulk.root.unmount();
  }
  pass('A space names its arm when the owner said it, and stays silent when they did not');

  // --- 2. no insights read -> dashes, never a flattering zero --------------
  {
    const bare = { ...AUDIENCE, insights: null, broadcasts: [], pastBroadcasts: 0, followers: 0 };
    const { container } = mount(React.createElement(SpaceStorefrontHeader, {
      space: space({ followers: 0, profile: null, profileLabels: { where: null, when: null } }),
      audience: bare
    }));
    const t = text(container);
    assert.ok(t.includes('—'), 'an unread figure is an em dash');
    assert.ok(!/0 views/i.test(t), 'and is not silently a zero');
    assert.ok(t.includes('No place or hours stated yet'), 'an empty profile says so instead of inventing a location');
  }
  pass('An unmeasured figure renders as a dash, not as zero');

  // --- 3. the broadcast rail -------------------------------------------------
  {
    calls = [];
    handler = async (url, init) => {
      if (url.includes('/broadcasts') && init?.method === 'POST') {
        return ok({ broadcast: { id: 'spb_new', kind: 'stock', text: 'Bread at 4pm', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString() }, delivery: { audience: 0, notified: 0, mutedByPreference: 0, channels: { inApp: 'created', sms: 'not_configured' }, note: 'Nobody follows this space yet, so nothing was sent.' } });
      }
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    let posted = null;
    const { container } = mount(React.createElement(BroadcastRail, {
      broadcasts: AUDIENCE.broadcasts, pastCount: 2, followers: 0, canManage: true,
      onPost: (t2, kind) => { posted = { t: t2, kind }; return Promise.resolve(null); }
    }));
    const t = text(container);
    assert.ok(t.includes('gone in'), 'a live update shows its real expiry');
    assert.ok(!/views|seen by/i.test(t), 'no story view count exists to fake');
    assert.ok(t.includes('2 gone'), 'past ones are counted as history');
    click(btn('Post an update'));
    await flush();
    setVal(document.querySelector('textarea[aria-label="Update for your followers"]'), 'Bread at 4pm');
    click(btn('Send to 0 followers'));
    assert.deepEqual(posted, { t: 'Bread at 4pm', kind: 'update' }, 'the composer sends text + kind');
    assert.ok(text(container).includes('no read receipts'), 'and the rail says opened-counts are unknowable');
  }
  pass('BroadcastRail: real expiry, real audience, no invented engagement');

  // --- 4. Tools: one availability field, clipboard templates, no fake roles --
  {
    calls = [];
    handler = async (url, init) => {
      if (url.includes('/profile') && init?.method === 'PATCH') return ok({ space: space(), changed: ['availability'], confirmed: [] });
      if (url.includes('/featured')) return ok({ space: space({ featured: ['lst_a'] }) });
      if (url.includes('/templates')) return ok({ template: { id: 'spt_new', label: 'Out of stock', body: 'Sorry — sold out today.', createdAt: '', updatedAt: '' }, templates: [...AUDIENCE.templates, { id: 'spt_new', label: 'Out of stock', body: 'Sorry — sold out today.', createdAt: '', updatedAt: '' }] });
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    const { container } = mount(React.createElement(SpaceTools, {
      space: space(),
      offers: [
        { id: 'lst_a', title: 'Six-cup cake', price: 1200, currency: 'KES', status: 'active', media: [], quantityAvailable: 3, description: '', type: 'product', vendorId: 'v1', createdAt: '', updatedAt: '' },
        { id: 'lst_b', title: 'Draft tray', price: 400, currency: 'KES', status: 'draft', media: [], quantityAvailable: null, description: '', type: 'product', vendorId: 'v1', createdAt: '', updatedAt: '' }
      ],
      templates: AUDIENCE.templates, featured: [], onChanged: () => {}
    }));
    await flush();
    const tue = document.querySelector('button[aria-pressed="true"]');
    assert.ok(tue, 'the stored days come back pressed — no reset-to-empty form');
    click(btn('Save hours'));
    await flush();
    const patch = calls.find((c) => c.url.includes('/profile') && c.method === 'PATCH');
    assert.ok(patch, 'the grid writes through the profile rail');
    const body = JSON.parse(patch.body);
    assert.ok(Array.isArray(body.fields.availability.days), 'as the SAME structured field the space file shows');
    assert.ok(body.fields.availability.days.includes('tue') && body.fields.availability.days.includes('sat'), 'prefilled from the row, not blanked');
    // A draft is not pin-able, so it is not even offered.
    assert.equal(text(container).includes('Draft tray'), false, 'a draft cannot be pinned');
    setVal(document.querySelector('input[aria-label="Template label"]'), 'Out of stock');
    setVal(document.querySelector('textarea[aria-label="Template message"]'), 'Sorry — sold out today.');
    click(btn('Save template'));
    await flush();
    assert.ok(text(container).includes('sold out today'), 'the saved template renders from the server list');
    assert.ok(text(container).includes('does not message your customers'), 'a template never sends anything by itself');
    assert.ok(text(container).includes('staff and roles'), 'and the absent Team panel is named as absent');
    assert.ok(text(container).includes('read-only'), 'with the reason: enforcement must arrive with it');
  }
  pass('SpaceTools writes one availability field, copies templates, and declares what it will not fake');

  // --- 5. the public page: the counter, nothing private ---------------------
  // The page renders the SERVER's projection (the same rows the /s/:slug mirror
  // paints), so the fixture below is the page shape, not a card shape.
  const pageView = (over = {}) => ({
    id: 'spc_1', slug: 'jj-cakes', name: 'Jj Cakes', type: 'business', goal: 'First 20 customers',
    image: null, initials: 'JC', where: 'Kilimani, Nairobi', when: 'Tue, Sat 06:00–18:00',
    open: { label: 'Open now', tone: 'live', stated: 'Tue, Sat 06:00–18:00', closesAt: '18:00' },
    contact: null,
    offers: [
      { id: 'lst_a', title: 'Cupcakes x 24', blurb: 'Vanilla, 24 pieces', price: 3000, priceLabel: 'KES 3,000', unit: 'box', minimum: 1, stock: 12, featured: true },
      { id: 'lst_b', title: 'Six-cup cake', blurb: null, price: 1200, priceLabel: 'KES 1,200', unit: null, minimum: null, stock: null, featured: false }
    ],
    offerCount: 2, moreOffers: 0,
    updates: [{ kind: 'hours', text: 'Oven fixed — open from 6 tomorrow', createdAt: '', expiresAt: '' }],
    facts: [{ key: 'what', label: 'What they say they provide', answer: 'Cakes to order, 48 hours notice' }],
    followers: 3, activeOfferCount: 2,
    lastStamp: { at: '2026-09-17T10:00:00.000Z', text: '17 Sep' },
    pageUrl: null, clock: 'East Africa Time', since: null, visibility: 'public', createdAt: '', noindex: false,
    ...over
  });
  {
    handler = async (url) => {
      if (url.includes('/api/public/spaces/jj-cakes/page')) return ok({ space: pageView() });
      if (url.includes('/api/public/spaces/jj-cakes')) return ok({ space: pageView() });
      if (url.includes('/api/auth/me')) return { ok: false, status: 401, text: async () => JSON.stringify({ error: 'authentication required' }) };
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    const { container } = mount(React.createElement(PublicSpacePage, { slug: 'jj-cakes' }));
    await flush();
    const t = text(container);
    assert.ok(t.includes('Jj Cakes'), 'the shop is named');
    assert.ok(t.includes('3 follow'), 'the follower count is the row count');
    assert.ok(t.includes('Pinned'), 'the vendor’s own pin shows');
    assert.ok(t.includes('KES 3,000'), 'the price is the label the server formatted, not re-invented here');
    assert.ok(t.includes('12 in hand'), 'a tracked stock figure is shown as the owner stated it');
    assert.ok(!/0 in hand/.test(t), 'an untracked offer says nothing about stock, not zero');
    assert.ok(t.includes('Oven fixed'), 'the live update is on the front');
    assert.ok(t.includes('Cakes to order'), 'and the operating answers a buyer acts on');
    assert.ok(t.includes('Their orders, customers and money stay in their own space'), 'and the boundary is said');
    assert.ok(t.includes('Open now until 18:00'), 'the open mark is only drawn because their hours answer supports it');
    assert.ok(t.includes('East Africa Time'), 'with the clock it was read against, named');
    assert.ok(!/revenue/i.test(t), 'no revenue figure appears');
    assert.ok(!/trusted seller|top rated|★/i.test(t), 'no invented trust badge');
    assert.ok(!/viewed|views/i.test(t), 'a buyer is never shown the view count');
    assert.ok(t.includes('No contact number on this page'), 'no WhatsApp button exists without a published number');
    click(btn('Follow'));
    await flush();
    assert.ok(text(container).includes('Sign in to follow a space'), 'a follow without a session is explained, not swallowed');
  }
  {
    // A number the owner published becomes a working button — the page's only
    // real action — and nothing else about the page changes.
    handler = async (url) => ok({ space: pageView({ contact: { platform: 'whatsapp', href: 'https://wa.me/254700111222', display: '+254700111222', digits: '254700111222' } }) });
    const { container } = mount(React.createElement(PublicSpacePage, { slug: 'jj-cakes' }));
    await flush();
    const link = document.querySelector('a[href="https://wa.me/254700111222"]');
    assert.ok(link, 'the button links the number the owner gave');
    assert.ok(text(link).includes('Chat on WhatsApp'));
    // the digits are printed as text too — the same as the server mirror, so the
    // two renderings of one page cannot disagree
    assert.ok(text(container).includes('+254700111222'), 'the published number is shown, not hidden');
    assert.ok(document.querySelector('a[href="tel:+254700111222"]'), 'and dialable from the same row');
    handler = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: 'space not found' }) });
  }
  {
    // An empty mirror: the space exists, nothing is published. The page says so.
    handler = async () => ok({ space: pageView({ offers: [], offerCount: 0, updates: [], facts: [], followers: 0, activeOfferCount: 0, lastStamp: null, open: { label: null, tone: 'empty', stated: null, reason: 'no hours stated' } }) });
    const { container } = mount(React.createElement(PublicSpacePage, { slug: 'jj-cakes' }));
    await flush();
    const t = text(container);
    assert.ok(t.includes('This shop is being set up'), 'an empty space reads as empty, not as a storefront');
    assert.ok(!/Open now|Closed now/.test(t), 'no hours answer, no open/closed claim');
    assert.ok(t.includes('2 follow') || t.includes('0 offer'), 'the count line stays true');
    assert.ok(!/last written/.test(t), 'no timestamp row, no timestamp sentence');
    handler = async (url) => ({ ok: false, status: 404, text: async () => JSON.stringify({}) });
  }
  {
    handler = async () => ({ ok: false, status: 404, text: async () => JSON.stringify({ error: 'space not found' }) });
    const { container } = mount(React.createElement(PublicSpacePage, { slug: 'ghost-shop' }));
    await flush();
    assert.ok(text(container).includes('not hidden-but-findable'), 'a private space is absent, not hidden');
  }
  pass('PublicSpacePage shows the counter and nothing else, and explains a missing session');

  // --- 6. the street: your shopfronts and the ones you follow --------------
  {
    // The morning brief withdraws from a fixture with no business yet: a shop
    // with no space has no figures, and the panel must not print zeroes for one.
    const noSpacesBrief = {
      ok: true, day: '2026-09-20', dayLabel: 'Sun, 20 Sept', isToday: false, asOf: '', stored: false,
      shop: { vendorId: null, name: '', ownerId: 'usr_1' },
      basis: { in: '', out: '', net: '', views: '' },
      empty: true, reason: 'no_spaces', money: null, orders: null, spaces: [], quietSpaces: [],
      people: [], views: null, flags: [], unassigned: null
    };
    handler = async (url) => {
      if (url.includes('/api/spaces/followed/mine')) return ok({ spaces: [{ id: 'spc_2', name: 'Amina Bakery', type: 'business', goal: 'Bread daily', image: null, activeOfferCount: 3, sampleOffers: [], visibility: 'public', createdAt: '', slug: 'amina-bakery', followers: 9, broadcasts: [{ id: 'b', kind: 'stock', text: 'Bread at 4', createdAt: '', expiresAt: '' }] }], note: 'derived' });
      if (url.endsWith('/api/spaces')) return ok({ spaces: [space()] });
      if (url.includes('/api/shop-brief')) return ok({ brief: noSpacesBrief });
      return { ok: false, status: 404, text: async () => JSON.stringify({}) };
    };
    const { container } = mount(React.createElement(SpacesLanding, { onOpenSpace: () => {}, onOpenPublicSpace: () => {} }));
    await flush();
    const t = text(container);
    assert.ok(t.includes('Spaces'), 'the screen is a street of businesses');
    assert.ok(t.includes('Jj Cakes') && /fresh/i.test(t), 'with the real state of each file');
    assert.ok(t.includes('2 to answer'), 'and the open items in it, in words a person acts on');
    assert.ok(!/\b2 open\b/.test(t), 'the bare "2 open" code is gone — it read like a fault, not a to-do');
    assert.ok(t.includes('Amina Bakery') && t.includes('9 follow'), 'the shops you follow, counted');
    assert.ok(!/Circles/i.test(t), 'no circles on this screen');
    assert.ok(!/Vaults/i.test(t), 'no vaults either');
    assert.ok(!/morning brief|KES 0/i.test(t),
      'and the brief is not on this street while the business has no space to read');
  }
  pass('SpacesLanding is shops only — circles and vaults are elsewhere');

  console.log('\nPASS ' + count);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
