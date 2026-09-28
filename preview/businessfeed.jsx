// The mixed feed replaces only the default discovery view, not Home or supply routes.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><div id="root"></div>', {
  url: 'https://wairo.test/#city',
  pretendToBeVisual: true
});
global.window = dom.window;
global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
});
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute('open', '');
};
dom.window.HTMLDialogElement.prototype.close = function () {
  this.removeAttribute('open');
};
const React = require('react'),
  { act } = React,
  { createRoot } = require('react-dom/client');
const { BusinessFeed } = require('./src/features/discovery/BusinessFeed');
const { CityFeedView } = require('./src/features/city/CityFeedView');
let count = 0,
  fail = false,
  destination = '',
  posted = false,
  root;
const fixture = {
  key: 'listing:actual',
  kind: 'tool',
  title: 'A real software listing',
  summary: 'A description from the provider.',
  scope: 'public',
  source: 'Actual provider',
  vendorId: 'v_1',
  location: 'Nairobi',
  image: null,
  topics: ['software'],
  stages: [],
  createdAt: null,
  price: 'KES 500',
  priceNote: 'listed price',
  spend: 500,
  href: '/#offer/actual',
  cta: 'View offer',
  reviews: { count: 0, average: null, href: '/reviews/actual' },
  steps: null,
  action: null,
  blockers: [],
  saved: false,
  hidden: false,
  following: false,
  score: 5,
  reasons: [{ points: 5, label: 'Matches your software interest by keywords' }]
};
const page = {
  items: [fixture],
  total: 1,
  page: 1,
  pages: 1,
  focus: null,
  focusUnavailable: false,
  preferences: {
    topic: '',
    location: '',
    stage: '',
    budget: null,
    rememberActivity: false,
    hiddenCount: 0,
    followingCount: 0,
    activityCount: 0
  },
  applied: {
    topic: '',
    location: '',
    stage: '',
    budget: null,
    rememberActivity: false
  },
  authenticated: false,
  topics: [{ id: 'software', label: 'Software' }],
  availability: { commerce: true, workforce: true, matching: true },
  rankingVersion: 1
};
global.fetch = async () => ({
  ok: !fail,
  status: fail ? 503 : 200,
  text: async () =>
    JSON.stringify(fail ? { error: 'Discovery unavailable' } : page)
});
const wait = () => new Promise((r) => setTimeout(r, 20));
const click = async (button) => {
  assert.ok(button);
  await act(async () => {
    button.click();
  });
  await act(wait);
};
const button = (text) =>
  [...document.querySelectorAll('button')].find(
    (b) => b.textContent.trim() === text
  );
const pass = (name) => {
  count++;
  console.log('PASS ' + name);
};
async function mount(element) {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(element);
  });
  await act(wait);
}
(async () => {
  await mount(React.createElement(CityFeedView, {}));
  assert.ok(document.querySelector('[data-testid="business-feed"]'));
  assert.equal(document.querySelector('[aria-label="Browse the board"]'), null);
  pass('default discovery is the mixed feed, not duplicated supply shelves');
  await mount(
    React.createElement(BusinessFeed, {
      onBrowse: (r) => (destination = r),
      onPostListing: () => (posted = true)
    })
  );
  assert.ok(document.body.textContent.includes('No customer reviews yet'));
  assert.ok(!document.body.textContent.includes('Verified provider'));
  assert.equal(document.querySelectorAll('.bf-card').length, 1);
  pass('renders real source facts, zero review state, and no invented badges');
  await click(button('I have something to offer'));
  assert.equal(posted, true);
  await click(button('Supply routes'));
  assert.equal(destination, 'all');
  pass('supply and publishing use the existing navigation callbacks');
  await click(
    document.querySelector('[aria-label="Save A real software listing"]')
  );
  assert.ok(document.querySelector('dialog[open]'));
  assert.ok(document.body.textContent.includes('Sign in to personalize'));
  await click(document.querySelector('[aria-label="Close dialog"]'));
  pass(
    'guest save asks for the existing account rather than pretending to persist'
  );
  await click(button('Tune feed'));
  assert.ok(document.querySelector('input[aria-label="Location"]'));
  assert.equal(document.querySelector('input[type=checkbox]'), null);
  assert.ok(button('Apply for this visit'));
  await click(document.querySelector('[aria-label="Close dialog"]'));
  pass(
    'guest controls are explicitly temporary and do not silently track activity'
  );
  fail = true;
  await mount(
    React.createElement(BusinessFeed, {
      onBrowse: () => {},
      onPostListing: () => {}
    })
  );
  assert.ok(document.querySelector('[role=alert]'));
  assert.equal(document.querySelectorAll('.bf-card').length, 0);
  fail = false;
  await click(button('Retry feed'));
  assert.equal(document.querySelectorAll('.bf-card').length, 1);
  pass('failed loads are errors with retry, not fake empty successes');
  await act(async () => root.unmount());
  dom.window.close();
  console.log(`PASSED ${count} FAILED 0`);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
