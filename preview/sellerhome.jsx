// Operational Home reads server-backed Space, offer and daily-brief data only.
// These checks pin the important contract: exact counts, an actionable inbox,
// visible unavailable states and no metric shaped to look busy.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
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
const { SellerHome } = require('./src/features/home/SellerHome.tsx');
const { BOTTOM_BAR_ITEMS } = require('./src/app/Navigation.tsx');

let passed = 0;
const pass = (label) => { passed++; console.log('PASS ' + label); };
const flush = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const ok = (body) => ({ ok: true, status: 200, text: async () => JSON.stringify(body) });
const fail = (status = 503) => ({ ok: false, status, text: async () => JSON.stringify({ error: 'offline for this suite' }) });

const conversation = (id, status = 'active') => ({
  id, spaceId: 'spc_a', customerName: `Customer ${id}`, status,
  messages: [], createdAt: '2026-09-28T06:00:00Z', updatedAt: '2026-09-28T06:30:00Z'
});
const space = (id = 'spc_a', over = {}) => ({
  id, ownerId: 'me', vendorId: 'vend_a', name: 'Blue Avenue', type: 'business',
  goal: '', targetValueKes: 0, image: null, visibility: 'public', status: 'active', capabilities: [],
  metrics: {
    revenueKes: 12450, customerCount: 7, activeOrdersCount: 3, totalOrdersCount: 4,
    inquiriesAwaitingReply: 12, offersCount: 2
  },
  offers: [], recentActivities: [], recentConversations: Array.from({ length: 10 }, (_, i) => conversation(`preview-${i}`)),
  createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-28T06:30:00Z', ...over
});
const listing = (id, status) => ({
  id, vendorId: 'vend_a', title: id === 'offer-active' ? 'Market tote' : 'New batch',
  description: '', type: 'product', price: 1200, currency: 'KES', quantityAvailable: null,
  locationName: null, objectId: null, media: [], status, vendor: null,
  orderable: status === 'active', unorderableReason: status === 'active' ? null : 'not_active'
});
const brief = (over = {}) => ({
  day: '2026-09-28', dayLabel: 'Mon, 28 Sep', isToday: true, asOf: '2026-09-28T09:00:00Z', stored: false,
  shop: { vendorId: 'vend_a', name: 'Blue Avenue', ownerId: 'me' },
  basis: { in: 'orders marked paid or settled', out: 'expenses recorded', net: 'marked in minus recorded out', views: 'public page opens' },
  empty: false, reason: null,
  money: { inKes: 12450, outKes: 0, netKes: 12450, currency: 'KES', railSettledKes: null },
  orders: { placed: 2, marked: 1, open: 3, cancelled: 0, disputed: 0, unstamped: 0, aged: 1, movedByStatus: {}, statuses: ['paid'] },
  spaces: [], quietSpaces: [], people: [], views: { count: 0, ownOpensExcluded: 0 }, flags: [],
  unassigned: { orders: 0, inKes: 0, evidenceIds: [], note: 'none' },
  ...over
});

let handler = async () => fail();
let requestedDay = '';
global.fetch = async (input) => {
  const url = String(input?.url ?? input ?? '');
  if (url.includes('/api/spaces')) return handler('spaces', url);
  if (url.includes('/api/shop-brief')) {
    requestedDay = new URL(url, 'https://brief.test').searchParams.get('day') || '';
    return handler('brief', url);
  }
  if (url.includes('/api/listings/mine')) return handler('listings', url);
  return fail(404);
};

async function mount(props = {}) {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(React.createElement(SellerHome, {
      onOpenSpace: () => {}, onOpenSelling: () => {}, onOpenSpaces: () => {},
      onCreateSpace: () => {}, onExplore: () => {}, onOpenWorkforce: () => {},
      ...props
    }));
  });
  await act(async () => { await flush(); });
  return { host, root };
}

async function main() {
  // Navigation is the requested IA — market first, the seller's own door
  // second — plus one global action. The atrium this suite pins is no longer
  // a door; it stays in the tree, and its attention read opens Shops.
  {
    const destinations = BOTTOM_BAR_ITEMS.filter((item) => item.type === 'destination').map((item) => item.label);
    assert.deepEqual(destinations, ['Market', 'Shops', 'Trade', 'You']);
    assert.equal(BOTTOM_BAR_ITEMS.filter((item) => item.type === 'action').length, 1);
  }
  pass('primary navigation is Market · Shops · Trade · You, plus Create');

  // The activity comes from the summary reads. The 12 inbox count intentionally
  // exceeds the ten conversation preview rows in this fixture.
  {
    handler = async (kind) => {
      if (kind === 'spaces') return ok({ spaces: [space()] });
      if (kind === 'brief') return ok({ brief: brief() });
      if (kind === 'listings') return ok({ vendor: null, listings: [listing('offer-active', 'active'), listing('offer-draft', 'draft')] });
      return fail();
    };
    let opened = null;
    const { host, root } = await mount({ onOpenSpace: (...args) => { opened = args; } });
    assert.equal(host.querySelector('[data-testid="metric-inquiries-value"]').textContent, '12');
    assert.equal(host.querySelector('[data-testid="metric-orders-value"]').textContent, '3');
    assert.equal(host.querySelector('[data-testid="metric-offers-value"]').textContent, '1');
    assert.equal(host.querySelector('[data-testid="metric-marked-in-value"]').textContent, 'KES 12,450');
    assert.ok(text(host).includes('12 inquiries waiting for a reply'));
    assert.ok(text(host).includes('1 older order still open'));
    assert.ok(text(host).includes('1 offer not published'));
    assert.ok(text(host).includes('not rail settlement'), 'marked status is not presented as payment-rail settlement');
    assert.match(requestedDay, /^\d{4}-\d{2}-\d{2}$/, 'the read asks for the Nairobi calendar day explicitly');
    const reply = host.querySelector('[aria-label^="Reply to 12 open inquiries"]');
    assert.ok(reply, 'the Space inbox has a direct reply action');
    await act(async () => { reply.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.deepEqual(opened, ['spc_a', 'pipeline'], 'the reply action opens the Space pipeline, not a generic home');
    assert.ok(!/KES 14,350|ETA|free delivery|\b8 visitors\b/i.test(text(host)));
    root.unmount(); host.remove();
  }
  pass('Home uses live business reads and opens the exact Space inbox');

  // A true empty account gets an empty-state action. Missing financial data is
  // a dash, not a fake KES zero or the previous seller’s activity.
  {
    handler = async (kind) => {
      if (kind === 'spaces') return ok({ spaces: [] });
      if (kind === 'brief') return ok({ brief: brief({
        shop: { vendorId: null, name: 'Your shop', ownerId: 'me' }, empty: true, reason: 'no_spaces',
        money: null, orders: null, views: null
      }) });
      if (kind === 'listings') return ok({ vendor: null, listings: [] });
      return fail();
    };
    const { host, root } = await mount();
    assert.ok(text(host).includes('No active Spaces yet.'));
    assert.ok(host.querySelector('[data-testid="metric-inquiries-value"]').textContent === '0');
    assert.ok(host.querySelector('[data-testid="metric-orders-value"]').textContent === '—');
    assert.ok(host.querySelector('[data-testid="metric-marked-in-value"]').textContent === '—');
    assert.ok(!/KES 0/.test(text(host)));
    assert.ok(Array.from(host.querySelectorAll('button')).some((button) => text(button).includes('Create a Space')));
    root.unmount(); host.remove();
  }
  pass('empty business reads stay empty and unavailable money stays unavailable');

  // One dead endpoint never turns into a zero-filled dashboard.
  {
    handler = async () => fail(503);
    const { host, root } = await mount();
    assert.ok(host.querySelector('[role="alert"]'));
    assert.ok(text(host).includes('Some activity could not be refreshed'));
    assert.equal(host.querySelector('[data-testid="metric-inquiries-value"]').textContent, '—');
    assert.equal(host.querySelector('[data-testid="metric-orders-value"]').textContent, '—');
    assert.equal(host.querySelector('[data-testid="metric-offers-value"]').textContent, '—');
    assert.equal(host.querySelector('[data-testid="metric-marked-in-value"]').textContent, '—');
    assert.ok(!text(host).includes('Nothing urgent is waiting.'));
    root.unmount(); host.remove();
  }
  pass('offline reads show retry and unavailable values, never a fabricated clear queue');

  // Announcements are a small, dismissible note after the operational work,
  // not a full-width media promo at the top of Home.
  {
    handler = async (kind) => {
      if (kind === 'spaces') return ok({ spaces: [] });
      if (kind === 'brief') return ok({ brief: brief({ empty: true, reason: 'no_spaces', money: null, orders: null, views: null }) });
      if (kind === 'listings') return ok({ vendor: null, listings: [] });
      return fail();
    };
    const { host, root } = await mount({ announcements: [{
      id: 'notice-1', campaignId: 'campaign-1', title: 'Saturday market', body: 'Meet local makers.', location: 'Nairobi',
      startsAt: null, imageUrl: null, status: 'active', createdAt: '2026-09-28T00:00:00Z',
      share: { available: false, reason: 'public_origin_not_configured' }
    }] });
    const note = host.querySelector('[aria-label="Announcement"]');
    assert.ok(note);
    assert.ok(note.compareDocumentPosition(host.querySelector('[data-testid="seller-home"] .seller-home__metrics')) & dom.window.Node.DOCUMENT_POSITION_PRECEDING);
    assert.equal(host.querySelector('video'), null);
    const dismiss = host.querySelector('[aria-label="Dismiss announcement"]');
    await act(async () => { dismiss.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
    assert.equal(host.querySelector('[aria-label="Announcement"]'), null);
    root.unmount(); host.remove();
  }
  pass('Wairo announcements sit below operations and can be dismissed');

  console.log(`\nPASS ${passed}`);
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
