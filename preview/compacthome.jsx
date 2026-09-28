// Home: real mixed activity in document flow and every category in plain sight.
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
const { HomeSurface, homeActivity } = require('./src/features/home/HomeSurface.tsx');
let failNetwork = false, projections = 0, openedWork = 0, destination, openedGroupBuys = 0;
const feed = [
  ...Array.from({ length: 18 }, (_, i) => ({ id: `row${i}`, kind: 'listing', title: `Real offer ${i}`, priceLabel: 'KES 100', mediaUrl: null, contact: null, description: 'Real description', location: 'Nairobi', dateLabel: null, seller: 'Supplier', interest: null })),
  { id: 'event1', kind: 'event', title: 'Saturday gathering', dateLabel: 'Sat', mediaUrl: null, seller: 'Host', priceLabel: 'Free' },
  { id: 'event2', kind: 'event', title: 'Sunday gathering', dateLabel: 'Sun', mediaUrl: null, seller: 'Host', priceLabel: 'Free' }
];
global.fetch = async () => {
  projections++;
  return { ok: !failNetwork, status: failNetwork ? 503 : 200, text: async () => JSON.stringify(failNetwork ? { error: 'Service unavailable' } : { feed, tiles: [{ key: 'events', count: 2 }] }) };
};
let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };
const click = async (el) => { assert.ok(el); await act(async () => { el.click(); }); };
let root;
async function mount() {
  if (root) await act(async () => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(HomeSurface, { onOpenSpace: () => {}, onOpenWork: () => openedWork++, onOpenGroupBuys: () => openedGroupBuys++, onExploreDiscover: (room) => { destination = room; } })); });
}
const cards = () => [...document.querySelectorAll('[data-testid="home-feed-card"]')];
const filter = (label) => [...document.querySelectorAll('.home-filters button')].find(b => b.textContent.trim() === label);
(async () => {
  assert.deepEqual(homeActivity(feed, 'all').slice(0, 6).map(i => i.id), ['row0', 'row1', 'event1', 'row2', 'row3', 'event2']);
  pass('Mixed activity interleaves real events without reordering either kind');
  await mount();
  assert.equal(projections, 1, 'one projection supplies categories and feed');
  assert.equal(cards().length, 8, 'multiple cards are visible immediately');
  assert.equal(document.querySelector('#home-activity-title').textContent, 'Offers & events');
  assert.deepEqual([...document.querySelectorAll('.home-filters button')].map(b => b.textContent.trim()), ['All', 'Offers', 'Events']);
  assert.equal(filter('All').getAttribute('aria-pressed'), 'true', 'All is the default segmented option');
  assert.equal(document.querySelector('.home-hero').nextElementSibling.id, 'home-activity', 'the real feed follows the compact banner');
  assert.equal(cards()[0].dataset.kind, 'listing');
  assert.ok(cards()[0].querySelector('.home-feed-title').textContent.includes('Real offer 0'));
  assert.ok(cards()[0].querySelector('.home-feed-meta').textContent.includes('Supplier'));
  assert.equal(cards()[0].querySelector('.home-feed-bottom').textContent.replace(/\s+/g, ' ').trim(), 'KES 100 · Offer', 'price and kind share one clear footer line');
  assert.equal(cards()[2].dataset.kind, 'event');
  assert.equal(cards()[2].querySelector('.home-feed-kind').textContent.replace(/\s+/g, ' ').trim(), '· Event');
  assert.equal(cards()[2].textContent.includes('Saturday gathering'), true);
  assert.equal(document.querySelector('.reel-stage'), null, 'no swipe-only stage that traps vertical scrolling');
  assert.equal(document.querySelector('.home-feed').style.overflow, '', 'the feed is in the normal page flow');
  assert.equal(document.querySelectorAll('.home-categories button').length, 9);
  assert.equal(document.querySelector('.home-category-count').textContent, '2', 'counts come from summary');
  pass('Home shows a scrollable mixed feed and all nine categories without a More disclosure');
  await click(document.querySelector('[data-testid="home-work"]'));
  assert.equal(openedWork, 1);
  await click([...document.querySelectorAll('.home-category')].find(b => b.textContent.includes('Groups')));
  assert.equal(destination, 'circles');
  await click([...document.querySelectorAll('.home-category')].find(b => b.textContent.includes('Runs')));
  assert.equal(destination, 'errands');
  await click([...document.querySelectorAll('.home-category')].find(b => b.textContent.includes('Group buys')));
  assert.equal(openedGroupBuys, 1);
  pass('Work, groups and group buys have direct working doors');
  await click(document.querySelector('.home-load-more'));
  assert.equal(cards().length, 16);
  await click(document.querySelector('.home-load-more'));
  assert.equal(cards().length, 20);
  assert.equal(document.querySelector('.home-load-more'), null);
  pass('Show more reaches the full projection instead of stopping at five');
  await click(filter('Events'));
  assert.equal(cards().length, 2);
  assert.ok(cards()[0].textContent.includes('Saturday gathering'));
  await click(cards()[0]);
  assert.equal(window.location.hash, '#wanderly/experience/event1');
  await click(filter('Offers'));
  assert.equal(cards().length, 8, 'changing filters resets pagination');
  await click(cards()[0]);
  assert.ok(document.querySelector('[data-testid="sheet"]'), 'offers retain their detail sheet');
  await click(document.querySelector('[data-testid="sheet-scrim"]'));
  pass('Events navigate; offers open a sheet; filters reset the visible slice');
  failNetwork = true;
  await mount();
  assert.ok(document.querySelector('[role="alert"]'));
  assert.equal(cards().length, 0);
  assert.equal(document.querySelectorAll('.home-categories button').length, 9, 'navigation survives a feed outage');
  failNetwork = false;
  await click([...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Retry'));
  assert.equal(cards().length, 8);
  pass('Network failures are not empty successes and retry restores activity');
  await act(async () => root.unmount());
  console.log(`PASSED ${count} FAILED 0`); process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
