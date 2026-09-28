// Compact Home regression suite: bounded rows, honest failures, real navigation.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { HomeSurface } = require('./src/features/home/HomeSurface.tsx');
let failNetwork = false, projections = 0, openedWork = 0, destination;
const feed = Array.from({ length: 8 }, (_, i) => ({ id: `row${i}`, kind: i === 7 ? 'event' : 'listing', title: `Real row ${i}`, priceLabel: 'KES 100', mediaUrl: null, contact: null, description: 'Real description', location: 'Nairobi', dateLabel: null, seller: 'Supplier', interest: null }));
// One projection, plus the reel's own look at the caller's personal state. The
// personal read is a DIFFERENT endpoint and is not a second copy of the shelf —
// so it is counted separately, and a signed-out answer is the real signed-out
// answer rather than a feed payload wearing a personal state's name.
global.fetch = async (url) => {
  if (String(url).includes('/api/me')) return { ok: false, status: 401, text: async () => JSON.stringify({ error: 'Sign in first' }) };
  projections++;
  return { ok: !failNetwork, status: failNetwork ? 503 : 200, text: async () => JSON.stringify(failNetwork ? { error: 'Service unavailable' } : { feed, tiles: [] }) };
};
let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };
const click = async (el) => { assert.ok(el); await act(async () => { el.click(); }); };
let root;
async function mount() {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(HomeSurface, { onOpenSpace: () => {}, onOpenWork: () => openedWork++, onExploreDiscover: (room) => { destination = room; } })); });
}
(async () => {
  await mount();
  assert.equal(document.querySelectorAll('.reel-segments li').length, 5, 'the reel is the first five rows and no more');
  assert.equal(projections, 1, 'one projection, no duplicated shelves');
  assert.equal(document.querySelector('details').open, false);
  pass('Home is bounded to five real activities and secondary discovery is collapsed');
  await click(document.querySelector('[data-testid="home-work"]'));
  assert.equal(openedWork, 1);
  const buttons = () => [...document.querySelectorAll('button')];
  await click(buttons().find((b) => b.textContent.trim() === 'Events' && b.closest('.compact-tabs')));
  assert.equal(document.querySelectorAll('.reel-segments li').length, 1);
  assert.ok(document.querySelector('[data-testid="reel-card"]').textContent.includes('Real row 7'));
  await click(document.querySelector('[data-testid="reel-card"] .reel-details-btn'));
  assert.equal(document.querySelector('[data-testid="reel-detail"]').hidden, false, 'the card opens its own detail');
  await click(buttons().find((b) => b.textContent.trim() === 'Open event'));
  assert.equal(window.location.hash, '#wanderly/experience/row7');
  assert.equal(document.querySelector('[data-testid="sheet"]'), null, 'no duplicate event preview');
  await click(buttons().find(b => b.textContent.trim() === 'Offers' && b.closest('.compact-tabs')));
  await click(document.querySelector('[data-testid="reel-card"] .reel-details-btn'));
  await click(buttons().find((b) => b.textContent.trim() === 'Open offer'));
  assert.ok(document.querySelector('[data-testid="sheet"]'), 'offers retain their existing detail');
  await click(document.querySelector('[data-testid="sheet-scrim"]'));
  pass('Work navigates, events reach Wanderly, and offer details still work');
  await click(document.querySelector('summary'));
  assert.equal(document.querySelector('details').open, true);
  await click(buttons().find((b) => b.textContent.trim() === 'Groups'));
  assert.equal(destination, 'circles');
  pass('Collapsed discovery retains working group navigation');
  failNetwork = true;
  await mount();
  assert.ok(document.querySelector('[role="alert"]'));
  assert.equal(document.querySelectorAll('.reel-segments li').length, 0);
  failNetwork = false;
  await click(buttons().find((b) => b.textContent.trim() === 'Retry'));
  assert.equal(document.querySelectorAll('.reel-segments li').length, 5);
  pass('Network failures are not empty successes and retry restores activity');
  act(() => root.unmount());
  console.log(`PASSED ${count} FAILED 0`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
