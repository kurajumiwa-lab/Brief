// Compact Home regression suite: bounded reel, honest failures, real navigation.
//
// "Latest activity" is an Activity Reel, not a list: the same real rows, with
// a consistent gesture grammar (browse / open / peek / save / seen → history).
// This suite pins the grammar from the keyboard and tap side — the physical
// swipes are exercised in the live preview — and keeps the old invariants:
// bounded to five real rows, one projection, tabs work, events open Wanderly
// directly, offers keep their shared detail sheet, failures stay honest.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/' });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.KeyboardEvent = dom.window.KeyboardEvent;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { HomeSurface } = require('./src/features/home/HomeSurface.tsx');
let failNetwork = false, requests = 0, openedWork = 0, destination;
const feed = Array.from({ length: 8 }, (_, i) => ({ id: `row${i}`, kind: i === 7 ? 'event' : 'listing', title: `Real row ${i}`, priceLabel: 'KES 100', mediaUrl: null, contact: null, description: 'Real description', location: 'Nairobi', dateLabel: null, seller: 'Supplier', interest: null }));
global.fetch = async () => { requests++; return { ok: !failNetwork, status: failNetwork ? 503 : 200, text: async () => JSON.stringify(failNetwork ? { error: 'Service unavailable' } : { feed, tiles: [] }) }; };
let count = 0;
const pass = (label) => { count++; console.log(`PASS ${label}`); };
const click = async (el) => { assert.ok(el); await act(async () => { el.click(); }); };
const flush = (ms) => new Promise((r) => setTimeout(r, ms));
const key = async (el, k) => { assert.ok(el); await act(async () => { el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); }); };
let root;
async function mount() {
  if (root) act(() => root.unmount());
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(HomeSurface, { onOpenSpace: () => {}, onOpenWork: () => openedWork++, onExploreDiscover: (room) => { destination = room; } })); });
}
(async () => {
  await mount();
  assert.equal(document.querySelectorAll('.reel-card').length, 5);
  assert.equal(requests, 1, 'one projection, no duplicated shelves');
  assert.equal(document.querySelector('details').open, false);
  assert.equal(document.querySelectorAll('[data-testid="reel-progress"] .reel-seg').length, 5, 'the position bar has one segment per row');
  assert.equal(document.querySelector('[data-testid="reel-count"]').textContent, '1 of 5');
  pass('Home activity is a reel bounded to five real rows, with a position bar and collapsed secondary discovery');

  await click(document.querySelector('[data-testid="home-work"]'));
  assert.equal(openedWork, 1);
  const buttons = () => [...document.querySelectorAll('button')];
  await click(buttons().find((b) => b.textContent.trim() === 'Events' && b.closest('.compact-tabs')));
  assert.equal(document.querySelectorAll('.reel-card').length, 1);
  assert.ok(document.querySelector('[data-testid="activity-reel"]').textContent.includes('Real row 7'));

  // Event card: tap raises the expanded takeover (never inline), whose one
  // action is the Wanderly destination the row always had.
  await click(document.querySelector('.reel-card'));
  await flush(320); // the deliberate tap delay that keeps double-tap save honest
  const expanded = document.querySelector('[data-testid="reel-expanded"]');
  assert.ok(expanded, 'the expanded view is raised');
  assert.ok(!document.querySelector('[data-testid="activity-reel"]').contains(expanded), 'it is a takeover, not an inline expand inside the shelf');
  const cta = document.querySelector('[data-testid="reel-open"]');
  assert.ok(cta.textContent.includes('Get ticket'), 'the event offers its ticket action');
  await click(cta);
  assert.equal(window.location.hash, '#wanderly/experience/row7');
  assert.equal(document.querySelector('[data-testid="reel-expanded"]'), null, 'and it leaves the takeover behind');
  assert.equal(document.querySelector('[data-testid="sheet"]'), null, 'no duplicate event preview');

  // Offer card: the same takeover, and its one action is the shared sheet.
  await click(buttons().find(b => b.textContent.trim() === 'Offers' && b.closest('.compact-tabs')));
  await click(document.querySelector('.reel-card'));
  await flush(320);
  assert.ok(document.querySelector('[data-testid="reel-expanded"]'), 'offers keep the same takeover');
  assert.ok(document.querySelector('[data-testid="reel-open"]').textContent.includes('Open offer'));
  await click(document.querySelector('[data-testid="reel-open"]'));
  assert.ok(document.querySelector('[data-testid="sheet"]'), 'offers retain their existing detail');
  await click(document.querySelector('[data-testid="sheet-scrim"]'));

  // The grammar from the keyboard: browse with arrows, the item you leave
  // forward fades to seen, and when everything is seen the shelf folds into
  // its history — one replay brings the reel back.
  await click(buttons().find(b => b.textContent.trim() === 'All activity' && b.closest('.compact-tabs')));
  const reel = document.querySelector('[data-testid="activity-reel"]');
  for (let i = 0; i < 4; i++) await key(reel, 'ArrowRight');
  assert.ok(document.querySelectorAll('.reel-card.is-seen').length === 4, 'leaving forward marks the row seen');
  assert.equal(document.querySelector('.reel-card[data-active="true"]').getAttribute('data-item-id'), 'row4');
  await click(document.querySelector('.reel-card[data-active="true"]'));
  await flush(320);
  await click(document.querySelector('[data-testid="reel-close"]'));
  await flush(300); // the closing animation
  assert.ok(document.querySelector('[data-testid="reel-history"]'), 'a fully-viewed shelf folds into history');
  assert.equal(document.querySelectorAll('.reel-card').length, 0, '…with no cards left asking for attention');
  await click(document.querySelector('[data-testid="reel-replay"]'));
  assert.equal(document.querySelectorAll('.reel-card').length, 5, 'one replay brings the reel back');
  pass('browse / seen / history / replay follow one grammar, and the item actions keep their real destinations');

  await click(document.querySelector('summary'));
  assert.equal(document.querySelector('details').open, true);
  await click(buttons().find((b) => b.textContent.trim() === 'Groups'));
  assert.equal(destination, 'circles');
  pass('Collapsed discovery retains working group navigation');

  // A fresh session (no seen memory): the failure path stays honest.
  global.localStorage.removeItem('brief_reel_seen_v1');
  global.localStorage.removeItem('brief_reel_saved_v1');
  failNetwork = true;
  await mount();
  assert.ok(document.querySelector('[role="alert"]'));
  assert.equal(document.querySelectorAll('.reel-card').length, 0);
  failNetwork = false;
  await click(buttons().find((b) => b.textContent.trim() === 'Retry'));
  await flush(50);
  assert.equal(document.querySelectorAll('.reel-card').length, 5);
  pass('Network failures are not empty successes and retry restores activity');
  act(() => root.unmount());
  console.log('PASS ' + count);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
