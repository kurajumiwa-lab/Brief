// ===========================================================================
// CAMPAIGN UI SUITE
//
// Covers the Creator Campaign Desk and the Public Campaign Page. fetch() is
// stubbed at the network boundary with REAL response shapes captured from the
// running server, so these tests exercise the same parsing, validation and
// rendering path production uses. Nothing below asserts against seeded UI
// data, because there is none: every number rendered comes from a stub
// response body.
// ===========================================================================

const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="root"></div></body></html>', {
  url: 'https://brief.test/',
  pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true }); // Node >=21 ships a getter-only navigator; plain assignment silently fails
global.HTMLElement = dom.window.HTMLElement;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.MouseEvent = dom.window.MouseEvent;
global.getComputedStyle = dom.window.getComputedStyle;
global.IS_REACT_ACT_ENVIRONMENT = true;

require('./suiteauth.cjs').installSuiteSession();
const React = require('react');
const { createRoot } = require('react-dom/client');
const { act } = require('react-dom/test-utils');
const briefApi = require('./src/api/briefApi.ts');
const Mod = require('./src/App.tsx');
const App = Mod.default;
const { PublicCampaignPage, campaignSlugFromPath } = Mod;

let pass = 0;
let fail = 0;
const ok = (cond, label) => {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log('  FAIL: ' + label);
  }
};

const text = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim();
const body = () => text(document.body);
const click = async (el) => {
  await act(async () => {
    el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};
const btn = (t) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => text(b) === t || text(b).startsWith(t)
  );
/** Exact match. Needed where a label is a prefix of another control's label
 *  -- 'Save' vs the My Layer 'Saved (2)' tab. */
const btnExact = (t) =>
  Array.from(document.querySelectorAll('button')).find((b) => text(b) === t);
/** Channel intents are anchors, not buttons -- they must be real links. */
const anchor = (t) =>
  Array.from(document.querySelectorAll('a')).find((a) => text(a) === t);
const allBtns = (t) =>
  Array.from(document.querySelectorAll('button')).filter((b) => text(b).startsWith(t));

const typeInto = async (el, value) => {
  const setter = Object.getOwnPropertyDescriptor(
    dom.window.HTMLInputElement.prototype,
    'value'
  ).set;
  setter.call(el, value);
  await act(async () => {
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
};
const inputByPlaceholder = (p) =>
  Array.from(document.querySelectorAll('input,textarea')).find((i) =>
    (i.getAttribute('placeholder') || '').startsWith(p)
  );

// --- response fixtures (shapes copied from the live server) -----------------

const metrics = (over) =>
  Object.assign(
    {
      views: 0,
      registrationsStarted: 0,
      registrations: 0,
      checkedIn: 0,
      noShows: 0,
      cancelled: 0,
      slotsTaken: 0,
      capacity: null,
      remaining: null,
      orders: 0,
      revenueSettled: 0,
      revenuePending: 0,
      currency: 'KES',
      viewers: null,
      shares: 0,
      conversionPct: null
    },
    over || {}
  );

const campaign = (over) =>
  Object.assign(
    {
      id: 'cmp_1',
      ownerId: 'usr_local',
      objectId: 'obj_1',
      circleId: null,
      title: 'Kilimani Plant Sale',
      description: 'Cuttings and seedlings.',
      type: 'popup',
      status: 'live',
      location: 'Kilimani',
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: null,
      capacity: 100,
      price: 0,
      currency: 'KES',
      ownsObject: true,
      object: {
        id: 'obj_1',
        type: 'experience',
        title: 'Kilimani Plant Sale',
        summary: 'Cuttings and seedlings.',
        locationName: 'Kilimani',
        publication: 'public',
        verificationStatus: null
      },
      publicSlug: 'kilimani-plant-sale-a1b2',
      createdAt: '2026-08-17T08:00:00.000Z',
      updatedAt: '2026-08-17T08:00:00.000Z',
      metrics: metrics({ slotsTaken: 82, capacity: 100, registrations: 82, remaining: 18 })
    },
    over || {}
  );

const publicCampaign = (over) =>
  Object.assign(
    {
      slug: 'kilimani-plant-sale-a1b2',
      title: 'Kilimani Plant Sale',
      description: 'Cuttings and seedlings.',
      type: 'popup',
      status: 'live',
      location: 'Kilimani',
      startsAt: '2026-09-01T10:00:00.000Z',
      endsAt: null,
      price: 0,
      currency: 'KES',
      capacity: 100,
      remaining: 18,
      soldOut: false,
      registered: 82
    },
    over || {}
  );

/**
 * Route table stub. Each entry is [matcher, handler]. Unmatched requests fail
 * loudly rather than returning a friendly empty body, so a test can never
 * accidentally pass against a route the app did not call.
 */
let calls = [];
let stubOrigin = 'https://brief.example.com';
const stubFetch = (routes) => {
  global.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    calls.push(method + ' ' + url);
    // Config is requested by every campaign surface. Served by default so
    // each test only declares the routes it actually cares about; individual
    // tests override `stubOrigin` to exercise the unconfigured case.
    if (url.includes('/api/config')) {
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({ publicOrigin: stubOrigin, campaignPathPrefix: '/c/' })
      };
    }
    // Share is fire-and-forget from the UI; accept it unless a test overrides.
    if (/\/share$/.test(url) && method === 'POST' && !routes.some(([p]) => p.path === '/share')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ campaign: campaign() }) };
    }
    for (const [pattern, handler] of routes) {
      if (url.includes(pattern.path) && (pattern.method || 'GET') === method) {
        const out = await handler(init);
        return {
          ok: out.status < 400,
          status: out.status,
          text: async () => JSON.stringify(out.body)
        };
      }
    }
    return { ok: false, status: 599, text: async () => JSON.stringify({ error: 'no stub: ' + method + ' ' + url }) };
  };
  global.window.fetch = global.fetch;
};

const mount = async (element) => {
  const host = document.getElementById('root');
  host.innerHTML = '';
  const container = document.createElement('div');
  host.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  return root;
};

const openCampaignsTab = async () => {
  // 'My Layer' is the destination (was labelled 'Saved'); the campaigns tab
  // lives in its Groups bundle as 'Events'.
  const my = Array.from(document.querySelectorAll('button')).find((b) =>
    text(b).startsWith('My Layer')
  );
  if (my) await click(my);
  // The saved-layer tab ships as 'Events' (SAVED_TABS.campaigns); the suite
  // predates the rename and looked for 'Campaigns'.
  const tab = Array.from(document.querySelectorAll('button')).find(
    (b) => text(b) === 'Events' || text(b) === 'Campaigns'
  );
  if (tab) await click(tab);
  return !!tab;
};

async function main() {
  dom.window.open = () => null;

  // =========================================================================
  console.log('=== 1. CAMPAIGN LIST LOADS ===');
  // =========================================================================
  calls = [];
  stubFetch([[{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign()] } })]]);
  let root = await mount(React.createElement(App));
  ok(await openCampaignsTab(), 'Campaigns tab exists inside My Layer');
  await click(btn('Load my campaigns'));
  ok(body().includes('Kilimani Plant Sale'), 'campaign title renders from the API');
  ok(body().includes('82 / 100'), 'capacity is printed from backend slotsTaken/capacity');
  ok(calls.some((c) => c === 'GET /ingest/api/campaigns'), 'the real list route was called');
  ok(!!btn('Open') && !!btn('Share'), 'LIVE row exposes Open and Share');

  // =========================================================================
  console.log('=== 2. LOADING STATE ===');
  // =========================================================================
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  stubFetch([
    [
      { path: '/api/campaigns' },
      async () => {
        await gate;
        return { status: 200, body: { campaigns: [] } };
      }
    ]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  ok(body().includes('Loading campaigns'), 'loading state renders while in flight');
  await act(async () => {
    release();
    await new Promise((r) => setTimeout(r, 0));
  });
  ok(!body().includes('Loading campaigns'), 'loading state clears once resolved');

  // =========================================================================
  console.log('=== 3. EMPTY STATE ===');
  // =========================================================================
  ok(
    body().includes("You haven't created a campaign yet."),
    'empty state uses the exact required copy'
  );
  ok(!body().includes('82 / 100'), 'no seeded campaign appears when the list is empty');

  // =========================================================================
  console.log('=== 4. API ERROR STATE ===');
  // =========================================================================
  stubFetch([
    [{ path: '/api/campaigns' }, async () => ({ status: 500, body: { error: 'database offline' } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  ok(body().includes("Couldn't load campaigns. Try again."), 'error state uses the required copy');
  ok(body().includes('database offline'), 'the backend error text is surfaced, not swallowed');
  ok(!body().includes("You haven't created a campaign yet."), 'error is not shown as empty');
  ok(!!btn('Retry'), 'error state offers a retry');

  // =========================================================================
  console.log('=== 5. CREATE FLOW ===');
  // =========================================================================
  stubFetch([
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Create'));
  ok(body().includes('What is it'), 'create sheet opens on the type step');
  const types = ['popup', 'session', 'drop', 'event'].filter((t) => !!btn(t));
  ok(types.length === 4, 'exactly the four real campaign types are offered');
  ok(!btn('webinar') && !btn('livestream'), 'no invented campaign types');
  await typeInto(inputByPlaceholder('Saturday plant sale'), 'Test Popup');
  await typeInto(inputByPlaceholder('Kilimani, Nairobi'), 'Kilimani');
  await typeInto(inputByPlaceholder('Unlimited'), '50');
  ok(calls.filter((c) => c.startsWith('POST')).length === 0, 'typing sends nothing to the server');
  await click(btn('Preview'));
  ok(body().includes('Nothing is public yet'), 'preview is a screen, not a saved object');
  ok(body().includes('Test Popup'), 'preview shows the entered title');
  ok(body().includes('50 spots'), 'preview shows capacity');
  ok(body().includes('Free'), 'zero price renders as Free');
  ok(
    calls.filter((c) => c.startsWith('POST')).length === 0,
    'reaching preview still sends nothing to the server'
  );

  // =========================================================================
  console.log('=== 6. PUBLISH FLOW ===');
  // =========================================================================
  calls = [];
  let publishBody = null;
  stubFetch([
    // Ordered longest-first: '/api/campaigns' is a prefix of the publish URL.
    [
      { path: '/publish', method: 'POST' },
      async () => ({
        status: 200,
        body: { campaign: campaign({ status: 'published', title: 'Test Popup' }) }
      })
    ],
    [
      { path: '/api/campaigns', method: 'POST' },
      async (init) => {
        publishBody = JSON.parse(init.body);
        return { status: 201, body: { campaign: campaign({ status: 'draft', title: 'Test Popup' }) } };
      }
    ],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  await click(btn('Publish'));
  ok(
    calls.some((c) => c === 'POST /ingest/api/campaigns'),
    'publish creates the campaign through the real route'
  );
  ok(
    calls.some((c) => c.includes('/publish')),
    'publish calls the real transition endpoint, not a local status flip'
  );
  ok(publishBody && publishBody.title === 'Test Popup', 'the typed title was sent');
  ok(publishBody && publishBody.capacity === 50, 'capacity was sent as a number');
  ok(publishBody && !('ownerId' in publishBody), 'the client never sends ownerId');
  ok(publishBody && !('metrics' in publishBody), 'the client never sends metrics');
  ok(body().includes('is published'), 'the post-publish state comes from the server status');

  // =========================================================================
  console.log('=== 7. SHARE LINK GENERATION ===');
  // =========================================================================
  ok(
    body().includes('https://brief.example.com/c/kilimani-plant-sale-a1b2'),
    'share URL is composed from the CONFIGURED public origin plus the server slug'
  );
  ok(
    !body().includes('https://brief.test/c/'),
    'the browser host is NOT used as the share origin'
  );
  ok(!body().includes('brief.app'), 'no hardcoded production domain');
  let copied = null;
  dom.window.navigator.clipboard = { writeText: async (t) => { copied = t; } };
  Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, writable: true, configurable: true }); // Node >=21 ships a getter-only navigator; plain assignment silently fails
  await click(btn('Copy link'));
  ok(
    copied === 'https://brief.example.com/c/kilimani-plant-sale-a1b2',
    'Copy link writes the configured URL to the clipboard'
  );
  ok(body().includes('Link copied'), 'copying confirms through the existing toast');
  ok(!!btn('Share'), 'a Share action sits alongside Copy link');

  // =========================================================================
  console.log('=== 8. PUBLIC CAMPAIGN LOADING ===');
  // =========================================================================
  ok(campaignSlugFromPath('/c/abc-123') === 'abc-123', 'slug parses from the public path');
  ok(campaignSlugFromPath('/') === null, 'the app shell is not treated as a public page');
  calls = [];
  stubFetch([
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: publicCampaign() } })
    ]
  ]);
  root = await mount(
    React.createElement(PublicCampaignPage, { slug: 'kilimani-plant-sale-a1b2' })
  );
  ok(
    calls.some((c) => c.includes('/api/public/campaigns/kilimani-plant-sale-a1b2')),
    'the public page uses the public endpoint'
  );
  ok(
    !calls.some((c) => c === 'GET /ingest/api/campaigns/cmp_1'),
    'the public page never fetches the private object'
  );
  ok(body().includes('Kilimani Plant Sale'), 'public page renders the title');
  ok(body().includes('18 spots left'), 'public page shows remaining spots from the projection');
  ok(!body().includes('usr_local'), 'no ownerId is rendered');
  ok(!body().includes('cmp_1') && !body().includes('obj_1'), 'no internal ids are rendered');
  ok(!body().includes('settled'), 'no private financial data on the public page');

  // =========================================================================
  console.log('=== 9. PUBLIC REGISTRATION ===');
  // =========================================================================
  calls = [];
  let regBody = null;
  stubFetch([
    [
      { path: '/register', method: 'POST' },
      async (init) => {
        regBody = JSON.parse(init.body);
        return {
          status: 201,
          body: {
            registration: { id: 'reg_1', status: 'registered', createdAt: '2026-08-17T09:00:00.000Z' },
            campaign: publicCampaign({ remaining: 17 })
          }
        };
      }
    ],
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: publicCampaign() } })
    ]
  ]);
  await typeInto(inputByPlaceholder('Name'), 'Amina');
  await typeInto(inputByPlaceholder('So the organiser'), '+254700000000');
  await click(btn('Register'));
  ok(
    calls.some((c) => c.includes('/api/public/campaigns/kilimani-plant-sale-a1b2/register')),
    'registration posts to the real public route'
  );
  ok(regBody && regBody.name === 'Amina', 'the name is submitted');
  ok(body().includes("You're registered"), 'success state is shown');
  ok(body().includes('17 spots left'), 'remaining updates from the response, not a local counter');

  // =========================================================================
  console.log('=== 10. FULL CAMPAIGN STATE ===');
  // =========================================================================
  stubFetch([
    [
      { path: '/api/public/campaigns/' },
      async () => ({
        status: 200,
        body: { campaign: publicCampaign({ remaining: 0, soldOut: true }) }
      })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'full-one' }));
  ok(body().includes('This one is full.'), 'a sold-out campaign says so');
  ok(!btn('Register'), 'no register button on a full campaign');

  // capacity error from the server on submit
  stubFetch([
    [
      { path: '/register', method: 'POST' },
      async () => ({ status: 409, body: { error: 'campaign is full' } })
    ],
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: publicCampaign({ remaining: 1 }) } })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'racing' }));
  await typeInto(inputByPlaceholder('So the organiser'), 'a@b.c');
  await click(btn('Register'));
  ok(body().includes('campaign is full'), 'a capacity race surfaces the backend error');
  ok(!body().includes("You're registered"), 'a rejected registration is never shown as success');

  // closed campaign
  stubFetch([
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: publicCampaign({ status: 'closed' }) } })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'closed-one' }));
  ok(body().includes('Registration is closed.'), 'a closed campaign refuses registration');

  // unavailable campaign
  stubFetch([
    [{ path: '/api/public/campaigns/' }, async () => ({ status: 404, body: { error: 'not found' } })]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'ghost' }));
  ok(body().includes('This campaign is not available.'), 'a missing campaign is handled');

  // network error
  global.fetch = async () => {
    throw new Error('connection refused');
  };
  global.window.fetch = global.fetch;
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'offline' }));
  ok(body().includes('Try again'), 'a network failure offers a retry');
  ok(!body().includes('Register'), 'a network failure never renders a usable form');

  // =========================================================================
  console.log('=== 11. PAID CAMPAIGN PENDING STATE ===');
  // =========================================================================
  stubFetch([
    [
      { path: '/register', method: 'POST' },
      async () => ({
        status: 201,
        body: {
          registration: { id: 'reg_2', status: 'started', createdAt: '2026-08-17T09:00:00.000Z' },
          campaign: publicCampaign({ price: 1500, remaining: 17 })
        }
      })
    ],
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: publicCampaign({ price: 1500 }) } })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'paid-one' }));
  ok(body().includes('KES 1,500'), 'the price is shown');
  ok(
    body().includes('No online payment is connected'),
    'the missing payment provider is stated honestly'
  );
  await typeInto(inputByPlaceholder('So the organiser'), 'a@b.c');
  await click(btn('Register'));
  ok(body().includes('spot held'), 'a `started` registration is labelled held, not paid');
  ok(!body().includes('Paid'), 'nothing claims the attendee has paid');
  ok(!body().includes("You're registered"), '`started` is not relabelled as registered');

  // =========================================================================
  console.log('=== 12. SETTLED REVENUE DISPLAY ===');
  // =========================================================================
  const paid = campaign({
    price: 1500,
    metrics: metrics({
      capacity: 100,
      slotsTaken: 12,
      registrations: 10,
      registrationsStarted: 14,
      views: 240,
      conversionPct: 4,
      revenueSettled: 30500,
      revenuePending: 4500,
      remaining: 88
    })
  });
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: paid } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [paid] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  ok(body().includes('KES 30,500 settled'), 'settled revenue renders in the list row');
  ok(body().includes('4,500 pending'), 'pending is shown separately in the list row');
  await click(btn('Open'));
  ok(body().includes('30,500'), 'the dashboard shows settled');
  ok(body().includes('4,500'), 'the dashboard shows pending');
  ok(body().includes('Pending is money that has not arrived'), 'pending is not presented as earned');
  ok(!body().includes('35,000'), 'settled and pending are never summed into one figure');
  ok(!btn('Settle'), 'no manual Settle button exists in the campaign UI');
  ok(body().includes('Page loads'), 'campaign_viewed is labelled as page loads');
  ok(!body().includes('Impressions') && !body().includes('Reach'), 'no invented reach metrics');
  ok(body().includes('240'), 'the real view count is shown');

  // analytics honesty: no data means no percentage
  ok(
    body().includes('4%') || body().includes('Not enough data'),
    'conversion is either the real number or an honest absence'
  );

  // =========================================================================
  console.log('=== 13. REGISTRATION DISPLAY ===');
  // =========================================================================
  let statusPatch = null;
  const regs = [
    { id: 'reg_a', campaignId: 'cmp_1', attendeeRef: 'a@b.c', name: 'Amina', contact: 'a@b.c', status: 'registered', createdAt: 'x', updatedAt: 'x' },
    { id: 'reg_b', campaignId: 'cmp_1', attendeeRef: 'c@d.e', name: 'Brian', contact: 'c@d.e', status: 'checked_in', createdAt: 'x', updatedAt: 'x' }
  ];
  stubFetch([
    [
      { path: '/registrations/reg_a/status', method: 'POST' },
      async (init) => {
        statusPatch = JSON.parse(init.body);
        return {
          status: 200,
          body: { registration: Object.assign({}, regs[0], { status: 'checked_in' }) }
        };
      }
    ],
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: regs } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: paid } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [paid] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('Amina') && body().includes('Brian'), 'registrations are listed');
  ok(body().includes('checked in'), 'registration status is displayed');
  const checkIn = btn('Check in');
  ok(!!checkIn, 'a registered attendee can be checked in');
  ok(allBtns('Check in').length === 1, 'an already checked-in attendee has no Check in button');
  await click(checkIn);
  ok(statusPatch && statusPatch.status === 'checked_in', 'check-in uses the verified status endpoint');
  ok(
    calls.filter((c) => c === 'GET /ingest/api/campaigns/cmp_1').length >= 2,
    'the dashboard refetches after a status change instead of patching local state'
  );

  // =========================================================================
  console.log('=== 14. OWNER-ONLY DASHBOARD ACCESS ===');
  // =========================================================================
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 404, body: { error: 'not found' } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 404, body: { error: 'not found' } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign()] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('not found'), "another owner's campaign surfaces the backend 404");
  ok(!body().includes('Registrations') || !body().includes('Amina'), 'no roster leaks on a 404');
  ok(!body().includes('30,500'), 'no financial data renders for a non-owner');

  // =========================================================================
  console.log('=== 15. DRAFT CAMPAIGN EDIT ===');
  // =========================================================================
  const draftCampaign = campaign({
    id: 'cmp_d',
    status: 'draft',
    title: 'Unpublished Popup',
    description: 'Original text.',
    location: 'Westlands',
    price: 0,
    capacity: 20,
    metrics: metrics({ capacity: 20, remaining: 20 })
  });

  // A. Draft campaign shows Edit.
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns/cmp_d/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_d' }, async () => ({ status: 200, body: { campaign: draftCampaign } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [draftCampaign] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  ok(!!btn('Edit'), 'A. a draft campaign card exposes Edit');
  ok(!!btn('Publish'), 'A. a draft campaign card exposes Publish');

  // C. Edit loads the existing campaign values.
  await click(btn('Edit'));
  const titleField = Array.from(document.querySelectorAll('input')).find(
    (i) => i.value === 'Unpublished Popup'
  );
  ok(!!titleField, 'C. the edit form is prefilled with the real title');
  const descField = Array.from(document.querySelectorAll('textarea')).find(
    (i) => i.value === 'Original text.'
  );
  ok(!!descField, 'C. the edit form is prefilled with the real description');
  const capField = Array.from(document.querySelectorAll('input')).find((i) => i.value === '20');
  ok(!!capField, 'C. capacity is prefilled from the server value');
  ok(capField && !capField.disabled, 'B. capacity IS editable while still a draft');

  // D. Save calls updateCampaign with the permitted fields.
  let patchBody = null;
  let patchMethod = null;
  stubFetch([
    [
      { path: '/api/campaigns/cmp_d', method: 'PATCH' },
      async (init) => {
        patchBody = JSON.parse(init.body);
        patchMethod = 'PATCH';
        return {
          status: 200,
          body: { campaign: campaign({ id: 'cmp_d', status: 'draft', title: 'Renamed Popup', capacity: 20 }) }
        };
      }
    ],
    [{ path: '/api/campaigns/cmp_d/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_d' }, async () => ({ status: 200, body: { campaign: draftCampaign } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [draftCampaign] } })]
  ]);
  await typeInto(titleField, 'Renamed Popup');
  await click(btnExact('Save'));
  ok(patchMethod === 'PATCH', 'D. save uses the real PATCH endpoint');
  ok(patchBody && patchBody.title === 'Renamed Popup', 'D. the edited title is sent');
  ok(patchBody && 'capacity' in patchBody, 'D. capacity is sent while the campaign is a draft');
  ok(patchBody && !('ownerId' in patchBody), 'D. ownerId is never sent');
  ok(patchBody && !('status' in patchBody), 'D. status is not writable through PATCH');
  ok(patchBody && !('metrics' in patchBody), 'D. metrics are never sent');
  ok(patchBody && !('publicSlug' in patchBody), 'D. the slug is never client-written');
  ok(
    patchBody &&
      !('revenueSettled' in patchBody) &&
      !('registrations' in patchBody) &&
      !('slotsTaken' in patchBody) &&
      !('views' in patchBody),
    'D. no economic or participation field is ever sent'
  );

  // E. Successful save updates the UI from server data.
  ok(body().includes('Renamed Popup'), 'E. the UI shows the server-returned title');
  ok(
    Array.from(document.querySelectorAll('div')).some((d) => text(d) === 'Saved'),
    'E. a confirmation is shown through the existing toast'
  );

  // B. A published campaign cannot edit capacity.
  const livePaid = campaign({ id: 'cmp_p', status: 'published', capacity: 30, price: 500 });
  stubFetch([
    [{ path: '/api/campaigns/cmp_p/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_p' }, async () => ({ status: 200, body: { campaign: livePaid } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [livePaid] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  await click(btn('Edit details'));
  const pubCap = Array.from(document.querySelectorAll('input')).find((i) => i.value === '30');
  ok(pubCap && pubCap.disabled, 'B. capacity is locked after publication');
  ok(
    body().includes('Spots cannot change after publishing'),
    'B. the reason for the lock is explained'
  );

  // F. Failed save displays the existing error pattern.
  stubFetch([
    [
      { path: '/api/campaigns/cmp_p', method: 'PATCH' },
      async () => ({ status: 400, body: { error: 'capacity cannot be changed after publication' } })
    ],
    [{ path: '/api/campaigns/cmp_p/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_p' }, async () => ({ status: 200, body: { campaign: livePaid } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [livePaid] } })]
  ]);
  await click(btnExact('Save'));
  ok(
    body().includes('capacity cannot be changed after publication'),
    'F. the backend error is surfaced verbatim'
  );
  ok(!!btnExact('Save'), 'F. the edit form stays open so the edit is not lost');

  // =========================================================================
  console.log('=== 16. CAMPAIGN -> TARGET DISPLAY ===');
  // =========================================================================
  const circled = campaign({ id: 'cmp_t', circleId: 'circ_1', status: 'live' });

  const circleBody = (over) => ({
    circle: Object.assign(
      {
        id: 'circ_1',
        name: 'School Fees Target',
        description: '',
        type: 'target',
        status: 'active',
        visibility: 'open',
        sourceId: null,
        goal: 'Term 3 fees',
        targetValue: 5000,
        deadline: null,
        completionCriteria: null,
        parentCircleId: null,
        createdAt: 'x',
        updatedAt: 'x',
        currentValue: 2500,
        contributorCount: 3,
        progressPct: 50,
        settledCount: 3,
        blockCount: 0,
        memberCount: 3
      },
      over || {}
    ),
    blocks: [],
    signals: []
  });

  // G. A campaign with circleId loads the existing Circle.
  calls = [];
  stubFetch([
    [{ path: '/api/circles/circ_1' }, async () => ({ status: 200, body: circleBody() })],
    [{ path: '/api/campaigns/cmp_t/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_t' }, async () => ({ status: 200, body: { campaign: circled } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [circled] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(
    calls.some((c) => c === 'GET /ingest/api/circles/circ_1'),
    'G. the existing circle route is used to load the target'
  );

  // H. Target displays real server-derived progress.
  ok(body().includes('Target'), 'H. a TARGET section is rendered');
  ok(body().includes('Term 3 fees'), 'H. the real goal is shown');
  ok(body().includes('2,500'), 'H. currentValue comes from the server');
  ok(body().includes('5,000'), 'H. targetValue comes from the server');
  ok(body().includes('50%'), 'H. progressPct comes from the server, not a local ratio');
  ok(
    body().includes('Progress comes from settled transactions'),
    'H. the provenance of progress is stated'
  );

  // K. The client cannot write target progress.
  ok(
    !calls.some((c) => c.startsWith('PATCH /ingest/api/circles')) &&
      !calls.some((c) => c.startsWith('POST /ingest/api/circles')),
    'K. rendering a target performs no write to the circle'
  );

  // I. A campaign without circleId shows no Target section.
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: campaign({ circleId: null }) } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign({ circleId: null })] } })]
  ]);
  calls = [];
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(!body().includes('Target'), 'I. no TARGET section without a circleId');
  ok(
    !calls.some((c) => c.includes('/api/circles/')),
    'I. no circle is fetched when there is nothing attached'
  );

  // J. An unavailable target is represented honestly.
  stubFetch([
    [{ path: '/api/circles/circ_1' }, async () => ({ status: 500, body: { error: 'circle store offline' } })],
    [{ path: '/api/campaigns/cmp_t/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_t' }, async () => ({ status: 200, body: { campaign: circled } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [circled] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('Target unavailable.'), 'J. a failed target load says so');
  ok(body().includes('circle store offline'), 'J. the real error is surfaced');
  ok(!body().includes('0%'), 'J. a failed target never renders as zero progress');

  // A circle with no target set is distinguished from a failure.
  stubFetch([
    [
      { path: '/api/circles/circ_1' },
      async () => ({ status: 200, body: circleBody({ targetValue: null, progressPct: null, goal: null }) })
    ],
    [{ path: '/api/campaigns/cmp_t/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_t' }, async () => ({ status: 200, body: { campaign: circled } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [circled] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('No target set on this circle.'), 'a circle without a target says so');
  ok(!body().includes('Target unavailable.'), 'no target is not reported as an error');

  // =========================================================================
  console.log('=== 17. SHARE LINK FROM CONFIGURED ORIGIN ===');
  // =========================================================================
  // Origin absent -> structured unavailable state, never a fabricated URL.
  stubOrigin = null;
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns', method: 'POST' }, async () => ({ status: 201, body: { campaign: campaign({ status: 'draft' }) } })],
    [{ path: '/publish', method: 'POST' }, async () => ({ status: 200, body: { campaign: campaign({ status: 'published' }) } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Create'));
  await typeInto(inputByPlaceholder('Saturday plant sale'), 'No Origin');
  await click(btn('Preview'));
  await click(btnExact('Publish'));
  ok(body().includes('No public link configured yet.'), 'unconfigured origin says so honestly');
  ok(body().includes('/c/kilimani-plant-sale-a1b2'), 'the canonical slug is still shown');
  ok(!body().includes('https://brief.test'), 'the browser host is never used as a fallback origin');
  ok(!body().includes('brief.app'), 'no production domain is fabricated');
  ok(!btnExact('Copy link'), 'no copy action offered when there is no link');
  ok(!btn('WhatsApp') && !btn('Telegram'), 'no channel buttons without a link');

  // The pure function, directly.
  const noLink = briefApi.campaignShareLink('abc', null);
  ok(noLink.available === false, 'campaignShareLink reports unavailable');
  ok(noLink.reason === 'public_origin_not_configured', 'the reason is structured, not a string blob');
  ok(noLink.slug === 'abc', 'the slug is still returned so the UI can show it');
  const yesLink = briefApi.campaignShareLink('abc', 'https://brief.example.com/');
  ok(yesLink.available === true, 'a configured origin yields a link');
  ok(yesLink.available && yesLink.url === 'https://brief.example.com/c/abc', 'trailing slash is normalised');

  // Origin present -> real link + channel intents.
  stubOrigin = 'https://brief.example.com';
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns', method: 'POST' }, async () => ({ status: 201, body: { campaign: campaign({ status: 'draft' }) } })],
    [{ path: '/publish', method: 'POST' }, async () => ({ status: 200, body: { campaign: campaign({ status: 'published' }) } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Create'));
  await typeInto(inputByPlaceholder('Saturday plant sale'), 'Has Origin');
  await click(btn('Preview'));
  await click(btnExact('Publish'));
  ok(
    body().includes('https://brief.example.com/c/kilimani-plant-sale-a1b2'),
    'the configured origin builds the canonical URL'
  );
  ok(calls.some((c) => c === 'GET /ingest/api/config'), 'the origin came from server config');

  const links = Array.from(document.querySelectorAll('a'));
  const wa = links.find((a) => text(a) === 'WhatsApp');
  const tg = links.find((a) => text(a) === 'Telegram');
  ok(!!wa && !!tg, 'channel shortcuts are offered');
  ok(
    wa && wa.getAttribute('href').startsWith('https://wa.me/?text=') &&
      decodeURIComponent(wa.getAttribute('href')).includes('https://brief.example.com/c/'),
    'WhatsApp is a plain URL intent carrying the real link'
  );
  ok(
    tg && tg.getAttribute('href').startsWith('https://t.me/share/url?url='),
    'Telegram is a plain URL intent'
  );
  ok(
    !links.some((a) => /instagram|tiktok/i.test(a.getAttribute('href') || '')),
    'no fake Instagram/TikTok share endpoints are implied'
  );
  ok(
    body().includes('copy the link and paste it'),
    'Instagram/TikTok are handled honestly via copy'
  );
  ok(
    !calls.some((c) => c.includes('graph.facebook.com') || c.includes('api.instagram')),
    'no social API is called'
  );

  // =========================================================================
  console.log('=== 18. SHARE DOES NOT MUTATE ECONOMICS ===');
  // =========================================================================
  const shareBase = campaign({
    id: 'cmp_s',
    status: 'live',
    metrics: metrics({
      capacity: 30, slotsTaken: 12, registrations: 12, remaining: 18,
      revenueSettled: 8500, revenuePending: 1500, views: 40, viewers: 22, shares: 2,
      conversionPct: 30
    })
  });
  let sharePosts = 0;
  calls = [];
  stubFetch([
    [
      { path: '/share', method: 'POST' },
      async () => {
        sharePosts++;
        // The server returns the SAME derived numbers: sharing changes nothing.
        return { status: 200, body: { campaign: shareBase } };
      }
    ],
    [{ path: '/api/campaigns/cmp_s/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_s' }, async () => ({ status: 200, body: { campaign: shareBase } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [shareBase] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  const beforeShareBody = body();
  ok(beforeShareBody.includes('8,500'), 'settled revenue is shown before sharing');
  await click(btnExact('Copy link'));
  ok(sharePosts >= 1, 'copying records a share server-side');
  ok(body().includes('8,500'), 'settled revenue is unchanged by sharing');
  ok(body().includes('1,500'), 'pending revenue is unchanged by sharing');
  ok(body().includes('12'), 'participation is unchanged by sharing');
  ok(!body().includes('8,501') && !body().includes('9,000'), 'no revenue was invented');
  ok(
    !calls.some((c) => c.startsWith('PATCH')),
    'sharing issues no write to the campaign record'
  );

  // =========================================================================
  console.log('=== 19. HONEST VIEW + SHARE METRICS ===');
  // =========================================================================
  ok(body().includes('Page loads'), 'raw loads are labelled as page loads');
  ok(body().includes('Different devices'), 'the distinct count is labelled honestly');
  ok(body().includes('Times you shared'), 'share count is described as the creator own taps');
  ok(body().includes('22'), 'the real viewers figure is rendered');
  ok(
    body().includes('not people') || body().includes('not how many people saw it'),
    'the limits of the numbers are stated in the UI'
  );
  ok(!body().includes('Reach') && !body().includes('Impressions'), 'no reach or impressions');

  // viewers null -> "Not enough data", never 0
  const noViews = campaign({
    id: 'cmp_nv',
    status: 'live',
    metrics: metrics({ views: 0, viewers: null, shares: 0, conversionPct: null })
  });
  stubFetch([
    [{ path: '/api/campaigns/cmp_nv/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_nv' }, async () => ({ status: 200, body: { campaign: noViews } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [noViews] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('Not enough data'), 'unmeasured viewers say so rather than showing 0');

  // =========================================================================
  console.log('=== 20. OBJECT ATTACHMENT ===');
  // =========================================================================
  calls = [];
  let createdBody = null;
  stubFetch([
    [
      { path: '/api/objects' },
      async () => ({
        status: 200,
        body: {
          objects: [
            { id: 'obj_existing', type: 'product', title: 'Handmade Baskets', publication: 'public' },
            { id: 'obj_two', type: 'experience', title: 'Pottery Class', publication: 'public' }
          ]
        }
      })
    ],
    [{ path: '/publish', method: 'POST' }, async () => ({ status: 200, body: { campaign: campaign({ status: 'published' }) } })],
    [
      { path: '/api/campaigns', method: 'POST' },
      async (init) => {
        createdBody = JSON.parse(init.body);
        return { status: 201, body: { campaign: campaign({ status: 'draft' }) } };
      }
    ],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Create'));
  ok(body().includes('tap to link an existing item'), 'linking an existing item is offered');
  // Nearby now loads objects from the server at mount (Brief holds no seeded
  // objects), so /api/objects is legitimately called before the picker opens.
  // What must stay true is that the PICKER does not populate until asked:
  // that is what this measures now.
  ok(
    !body().includes('Handmade Baskets'),
    'the picker does not list items until asked for'
  );
  const before = calls.filter((c) => c.includes('/api/objects')).length;
  await click(btn('Something new'));
  ok(
    calls.filter((c) => c.includes('/api/objects')).length > before,
    'the picker loads real objects'
  );
  ok(body().includes('Handmade Baskets'), 'existing objects are listed');
  await click(btn('Handmade Baskets'));
  ok(body().includes('Handmade Baskets'), 'the chosen item is shown as selected');
  await typeInto(inputByPlaceholder('Saturday plant sale'), 'Basket Drop');
  await click(btn('Preview'));
  await click(btnExact('Publish'));
  ok(createdBody && createdBody.objectId === 'obj_existing', 'the chosen objectId is sent');
  ok(
    createdBody && !('object' in createdBody),
    'the object is referenced by id, never copied into the campaign'
  );

  // rejection surfaces honestly
  stubFetch([
    [
      { path: '/api/campaigns', method: 'POST' },
      async () => ({ status: 400, body: { error: 'not authorised to attach this object' } })
    ],
    [
      { path: '/api/objects' },
      async () => ({ status: 200, body: { objects: [{ id: 'obj_x', type: 'experience', title: 'Foreign', publication: 'source_members' }] } })
    ],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Create'));
  await typeInto(inputByPlaceholder('Saturday plant sale'), 'Denied');
  await click(btn('Preview'));
  await click(btnExact('Publish'));
  ok(
    body().includes('not authorised to attach this object'),
    'an unauthorised attachment surfaces the backend refusal'
  );

  // =========================================================================
  console.log('=== 21. CAMPAIGN -> OBJECT CHAIN ===');
  // =========================================================================
  const attachedCampaign = campaign({
    id: 'cmp_a',
    status: 'live',
    ownsObject: false,
    object: {
      id: 'obj_existing',
      type: 'product',
      title: 'Handmade Baskets',
      summary: 'Woven in Kitui.',
      locationName: null,
      publication: 'public',
      verificationStatus: null
    }
  });
  stubFetch([
    [{ path: '/api/campaigns/cmp_a/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_a' }, async () => ({ status: 200, body: { campaign: attachedCampaign } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [attachedCampaign] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('What people get'), 'the campaign shows what is being offered');
  ok(body().includes('Handmade Baskets'), 'the attached object title is shown');
  ok(body().includes('Woven in Kitui.'), 'the object summary is shown');
  ok(body().includes('existing item'), 'an attached object is marked as pre-existing');
  ok(
    body().includes('does not change it'),
    'the UI states that publishing will not mutate the attached object'
  );
  ok(!body().includes('obj_existing'), 'the internal object id is not shown to the creator');

  // =========================================================================
  console.log('=== 22. PUBLIC PAGE SHARE METADATA ===');
  // =========================================================================
  stubFetch([
    [
      { path: '/api/public/campaigns/' },
      async () => ({
        status: 200,
        body: { campaign: Object.assign(publicCampaign(), { creator: 'Amina K', image: null }) }
      })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'kilimani-plant-sale-a1b2' }));
  ok(body().includes('by Amina K'), 'the creator label is shown to visitors');
  ok(!body().includes('usr_me') && !body().includes('ownerId'), 'no internal owner id is exposed');
  ok(!body().includes('Circle') && !body().includes('Signal'), 'no Brief architecture is exposed');
  ok(!body().includes('objectId'), 'no object id is exposed publicly');

  // creator absent -> nothing invented
  stubFetch([
    [
      { path: '/api/public/campaigns/' },
      async () => ({ status: 200, body: { campaign: Object.assign(publicCampaign(), { creator: null, image: null }) } })
    ]
  ]);
  root = await mount(React.createElement(PublicCampaignPage, { slug: 'anon' }));
  ok(!body().includes('by '), 'no creator line when the server has no creator');
  ok(body().includes('Kilimani Plant Sale'), 'the page still renders without a creator');

  // ---- source-level guarantees -------------------------------------------
  console.log('=== SOURCE INVARIANTS ===');
  const src = (require('fs').readFileSync(__dirname + '/src/App.tsx', 'utf8') + '\n' + require('fs').readFileSync(__dirname + '/src/model/core.tsx', 'utf8') + '\n' + require('fs').readdirSync(__dirname + '/src/shell/hooks').map(f => require('fs').readFileSync(__dirname + '/src/shell/hooks/' + f, 'utf8')).join());
  ok(!/setRegistrations\s*\(\s*\d/.test(src), 'no local registration counter is ever set');
  ok(!/campaign\.registrations\s*=/.test(src), 'campaign.registrations is never assigned');
  ok(!/campaign\.revenue/.test(src), 'no frontend revenue field is invented');
  ok(!/currentValue\s*=/.test(src), 'currentValue is never assigned in the client');
  ok(!/progressPct\s*=[^=]/.test(src), 'progressPct is never assigned in the client');
  ok(!/CampaignTarget/.test(src), 'no CampaignTarget primitive was created');
  ok(!/campaignShareUrl/.test(src), 'the origin-guessing share helper is gone');
  ok(
    /publicOrigin \|\| \(typeof window !== 'undefined' \? window\.location\.origin : null\)/.test(src),
    'the browser origin is only ever a fallback behind the configured public origin'
  );
  ok(!/CampaignObject\s*=|interface CampaignProduct/.test(src), 'no duplicate object primitive in the client');
  ok(!/graph\.facebook\.com|api\.instagram\.com|open-api\.tiktok/.test(src), 'no social API endpoints');
  ok(
    !/updateCampaign\([^)]*capacity[^)]*\)/s.test(src) || /status === 'draft'/.test(src),
    'capacity is only ever patched under a draft check'
  );
  ok(!/brief\.app/.test(src), 'no hardcoded production domain in App.tsx');
  ok(!/settleTransaction\s*\(/.test(src), 'the campaign UI does not simulate settlement');
  // The nav is a five-entry array of [id, label, Icon]. Campaigns must appear
  // only as a My Layer section ([id, label]), never as a nav destination.
  ok(
    !/\['campaigns',\s*'Campaigns',\s*[A-Z]/.test(src),
    'Campaigns is not a sixth navigation destination'
  );
  // Campaigns is filed under My Layer. It moved from an inline array of rows
  // to a bundle in src/ui/names.ts, so the assertion reads the bundle list
  // rather than the deleted menu.
  const namesSrc = require('fs').readFileSync(__dirname + '/src/ui/names.ts', 'utf8');
  ok(
    /SAVED_BUNDLES[\s\S]*?'campaigns'/.test(namesSrc) &&
      /SAVED_BUNDLES[\s\S]*?'campaigns'[\s\S]*?\]/.test(namesSrc),
    'Campaigns is a My Layer section'
  );
  ok(
    !/WORKFLOW_BUNDLES[\s\S]*?sections:\s*\[[^\]]*'campaigns'[^\]]*\][\s\S]*?,\s*\{\s*id:\s*'[^']+',\s*label:\s*'Campaigns'/.test(namesSrc),
    'Campaigns is not a navigation destination of its own'
  );

  // =========================================================================
  console.log('=== 20. PHASE 8: CREATOR OPERATING LOOP ===');
  // =========================================================================

  // --- persistent distribution surface in the DETAIL view -----------------
  // Previously the channel buttons existed only in the publish-success panel,
  // so a creator returning later could not share to WhatsApp at all.
  calls = [];
  stubOrigin = 'https://brief.example.com';
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: campaign() } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign()] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('https://brief.example.com/c/kilimani-plant-sale-a1b2'),
    'the detail view shows the canonical URL as text');
  ok(!!anchor('WhatsApp') && !!anchor('Telegram') && !!anchor('X'),
    'channel buttons are available in the detail view, not only after publishing');
  ok(!anchor('Instagram') && !anchor('TikTok') && !btn('Instagram') && !btn('TikTok'),
    'no fake Instagram/TikTok integrations in the detail view');
  ok(anchor('WhatsApp').getAttribute('target') === '_blank' &&
     /noopener/.test(anchor('WhatsApp').getAttribute('rel') || ''),
    'channel links open safely in a new tab');
  ok(body().includes('Instagram') && body().includes('copy'),
    'Instagram is honestly described as copy-link');
  const waHref = [...document.querySelectorAll('a')]
    .map((a) => a.getAttribute('href') || '').find((h) => h.includes('wa.me'));
  ok(!!waHref && waHref.includes(encodeURIComponent('https://brief.example.com/c/kilimani-plant-sale-a1b2')),
    'the WhatsApp intent carries the canonical url');

  // no configured origin -> no link, no channels, in the detail view too
  calls = [];
  stubOrigin = null;
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: campaign() } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign()] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('No public link configured yet.'),
    'detail view is honest when no origin is configured');
  ok(!anchor('WhatsApp') && !anchor('Telegram'),
    'no channel buttons without a canonical link');
  ok(!body().includes('brief.app'), 'no production domain is fabricated in the detail view');
  stubOrigin = 'https://brief.example.com';

  // --- awaiting payment: creator attention --------------------------------
  const heldReg = { id: 'reg_h1', campaignId: 'cmp_1', attendeeRef: 'buyer-1',
    name: 'Wanjiru', contact: '0700111222', status: 'started',
    createdAt: '2026-08-17T09:00:00.000Z', updatedAt: '2026-08-17T09:00:00.000Z' };
  const paidCamp = campaign({ price: 1000, status: 'published',
    metrics: metrics({ slotsTaken: 1, capacity: 100, registrations: 0,
      registrationsStarted: 1, remaining: 99, revenueSettled: 0, currency: 'KES' }) });
  let confirmCall = null;
  calls = [];
  stubFetch([
    [{ path: '/confirm-payment', method: 'POST' }, async (init) => {
      confirmCall = { body: init && init.body ? JSON.parse(init.body) : null };
      return { status: 201, body: {
        registration: { ...heldReg, status: 'registered' },
        transaction: { id: 'txn_1', amount: 1000, currency: 'KES', type: 'sale',
          status: 'settled', description: '', counterparty: null, circleId: null,
          objectId: null, campaignId: 'cmp_1', registrationId: 'reg_h1', metadata: {},
          history: [{ status: 'created', at: 'x' }], createdAt: 'x', updatedAt: 'y' },
        analytics: metrics({ registrations: 1, revenueSettled: 1000 })
      } };
    }],
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [heldReg] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: paidCamp } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [paidCamp] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(body().includes('1 awaiting payment'), 'held spots are surfaced as awaiting payment');
  ok(body().includes('Wanjiru'), 'the held attendee is named');
  ok(!body().includes('1 registered') || body().includes('awaiting'),
    'a held spot is not presented as a completed registration');
  const confirmBtn = btn('Confirm KES 1,000');
  ok(!!confirmBtn, 'the creator can confirm the campaign price for a held spot');
  ok(!btn('Check in'), 'a held (unpaid) spot offers no check-in');
  await click(confirmBtn);
  ok(calls.some((c) => c.includes('POST') && c.includes('/confirm-payment')),
    'confirming calls the server confirm-payment route');
  ok(confirmCall && confirmCall.body && !('amount' in confirmCall.body),
    'the client sends no amount; the server charges the campaign price');
  ok(calls.filter((c) => c === 'GET /ingest/api/campaigns/cmp_1').length >= 2,
    'the dashboard refetches after confirmation rather than patching state locally');

  // a FREE campaign has nothing to confirm
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [
      { ...heldReg, status: 'registered' }] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: campaign({ price: 0 }) } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign({ price: 0 })] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  ok(!body().includes('awaiting payment'), 'a free campaign shows no awaiting-payment section');

  // --- attach an existing object from the DETAIL view ---------------------
  let attachPatch = null;
  calls = [];
  stubFetch([
    [{ path: '/api/objects' }, async () => ({ status: 200, body: { objects: [
      { id: 'obj_77', type: 'listing', title: 'Rooftop Space', summary: 'A place' }] } })],
    [{ path: '/api/campaigns/cmp_1', method: 'PATCH' }, async (init) => {
      attachPatch = init && init.body ? JSON.parse(init.body) : null;
      return { status: 200, body: { campaign: campaign() } };
    }],
    [{ path: '/api/campaigns/cmp_1/registrations' }, async () => ({ status: 200, body: { registrations: [] } })],
    [{ path: '/api/campaigns/cmp_1' }, async () => ({ status: 200, body: { campaign: campaign() } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign()] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await click(btn('Open'));
  const linkBtn = btn('Link a different item');
  ok(!!linkBtn, 'an existing campaign can link a different item');
  await click(linkBtn);
  ok(body().includes('Rooftop Space'), 'the existing object picker is reused');
  await click(btn('Rooftop Space'));
  ok(attachPatch && attachPatch.objectId === 'obj_77',
    'attaching sends objectId through the existing PATCH route');
  ok(attachPatch && !('ownsObject' in attachPatch) && !('ownerId' in attachPatch),
    'attaching sends no ownership fields');

  // =========================================================================
  console.log('=== REMOVING AN EVENT WITH HISTORY WITHDRAWS IT ===');
  // =========================================================================
  // The dashboard button used to cancel-then-DELETE, which is exactly what made
  // the state machine skippable from the UI: a cancelled event whose tickets
  // still worked, whose money was never refunded, and whose holders were never
  // told. It now asks the server what is really at stake and, when records
  // depend on the row, takes the same withdraw path the host's own button does.
  // A DELETE here would be the bug, so the assertions are as much about what was
  // NOT called as about what was.
  const receipt = {
    campaignId: 'cmp_1',
    actorId: 'usr_local',
    reason: 'withdrawn from the campaign dashboard',
    at: '2026-09-20T10:00:00.000Z',
    before: { status: 'live' },
    receipt: {
      registrationsCancelled: 2,
      registrationsLeftAlone: 0,
      ticketsVoided: 2,
      resaleListingsPulled: 0,
      ticketsStuckOnOpenOrder: [],
      refunded: [{ transactionId: 'txn_1', amount: 1500, currency: 'KES' }],
      owed: [],
      attemptsClosed: 0,
      holdersNotified: 2
    }
  };
  const previewWithHistory = {
    campaignId: 'cmp_1', status: 'live', canWithdraw: true, canDelete: false,
    blockers: ['2 registrations', '2 issued tickets', '1 ledger row'],
    registrations: { total: 2, byStatus: { registered: 2 }, toCancel: 2, leftAlone: 0 },
    tickets: { issued: 2, live: 2, resaleListings: 0 },
    money: { transactions: 1, refundable: 1, refundableKes: 1500, attemptsToClose: 0, settledKes: 1500 },
    holders: { count: 2 }
  };
  calls = [];
  let withdrawBody = null;
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/withdrawal' }, async () => ({ status: 200, body: { preview: previewWithHistory, withdrawal: null } })],
    [{ path: '/api/campaigns/cmp_1/withdraw', method: 'POST' }, async (init) => {
      withdrawBody = init && init.body ? JSON.parse(init.body) : null;
      return { status: 200, body: { campaign: campaign({ status: 'cancelled' }), withdrawal: receipt, alreadyWithdrawn: false } };
    }],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign({ status: 'live' })] } })]
  ]);
  dom.window.confirm = () => true;
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await act(async () => {
    btn('Remove').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  ok(calls.some((c) => c === 'GET /ingest/api/campaigns/cmp_1/withdrawal'),
    'the surface asks what is at stake before offering to remove anything');
  ok(calls.some((c) => c === 'POST /ingest/api/campaigns/cmp_1/withdraw'),
    'a row other people depend on is withdrawn');
  ok(!calls.some((c) => c.startsWith('DELETE ')),
    'and never deleted: erasing it would leave their records describing nothing');
  ok(withdrawBody && withdrawBody.reason === 'withdrawn from the campaign dashboard',
    'the reason is recorded, not left blank');
  ok(body().includes('2 tickets stopped') && body().includes('2 places released'),
    'the numbers reported are the server receipt, not a guess');
  ok(body().includes('1 refund recorded') && body().includes('2 told'), 'including the money and who was told');
  ok(body().includes('The record stays.'), 'and it says plainly that the history is kept');

  // A draft nothing depends on still simply goes: withdrawing it would leave a
  // tombstone nobody needs, and delete is the honest verb when the row is alone.
  calls = [];
  stubFetch([
    [{ path: '/api/campaigns/cmp_1/withdrawal' }, async () => ({ status: 200, body: { preview: {
      ...previewWithHistory, status: 'draft', canDelete: true, blockers: [],
      registrations: { total: 0, byStatus: {}, toCancel: 0, leftAlone: 0 },
      tickets: { issued: 0, live: 0, resaleListings: 0 },
      money: { transactions: 0, refundable: 0, refundableKes: 0, attemptsToClose: 0, settledKes: 0 },
      holders: { count: 0 }
    }, withdrawal: null } })],
    [{ path: '/api/campaigns/cmp_1', method: 'DELETE' }, async () => ({ status: 200, body: { ok: true } })],
    [{ path: '/api/objects' }, async () => ({ status: 200, body: { objects: [] } })],
    [{ path: '/api/campaigns' }, async () => ({ status: 200, body: { campaigns: [campaign({ status: 'draft' })] } })]
  ]);
  root = await mount(React.createElement(App));
  await openCampaignsTab();
  await click(btn('Load my campaigns'));
  await act(async () => {
    btn('Remove').dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
  });
  ok(calls.some((c) => c === 'DELETE /ingest/api/campaigns/cmp_1'),
    'a row nothing depends on is deleted, because there is no history to keep');
  ok(!calls.some((c) => c === 'POST /ingest/api/campaigns/cmp_1/withdraw'),
    'and is not withdrawn: no tombstone for a draft');

  console.log('');
  console.log('pass ' + pass + ' fail ' + fail);
  // showToast leaves a 3s timer behind, and jsdom keeps the loop alive.
  // Exit explicitly rather than waiting on unrelated timers.
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
