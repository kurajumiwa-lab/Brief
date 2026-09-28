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
  // What this check is really about: the face of discovery is the mixed feed, not
  // the supply shelves and not the picker wall. It used to pin that by demanding
  // `[aria-label="Browse the board"]` be ABSENT — i.e. it forbade the entry itself,
  // which contradicted errandslobby and townhubs (both require that one entry) and
  // left the rooms reachable only from a link at the end of the feed. Pinned now
  // on the structure, positively: no tile wall, one entry, and the entry opens the
  // picker in place rather than navigating away. (A jsdom element is also the last
  // thing `assert` should be asked to print: formatting it as an error message is
  // what ate the heap and reported this suite as "Killed".)
  assert.equal(document.querySelectorAll('button[role="tab"]').length, 0,
    'no picker wall on the face of the feed');
  assert.equal(document.querySelectorAll('[aria-label="Browse the board"]').length, 1,
    'the feed offers exactly one entry into the board');
  assert.equal(
    document.querySelector('[role="dialog"][aria-label="Browse the board"]'),
    null,
    'the picker is closed until it is asked for'
  );
  await click(document.querySelector('button.bf-browse'));
  assert.ok(
    document.querySelector('[role="dialog"][aria-label="Browse the board"]'),
    'the one entry opens the board directory in place'
  );
  assert.ok(document.body.textContent.includes('The flows'),
    'the picker brings the taxonomy with it');
  await click(document.querySelector('[aria-label="Close the picker"]'));
  assert.equal(document.querySelector('[role="dialog"][aria-label="Browse the board"]'), null,
    'closing the picker returns to the feed');
  pass('default discovery is the mixed feed, one entry, no duplicated shelves');
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
