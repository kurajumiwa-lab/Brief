// ---------------------------------------------------------------------------
// ACTIVITY REEL SUITE — the interaction grammar, pinned.
//
// What this suite refuses to let slide:
//   * the grammar's thresholds and its axis bias (a diagonal is not a coin toss);
//   * every gesture having a labelled twin, so nothing is swipe-only;
//   * a hold being a peek and NOT a tap, and a tap inside a control not being a
//     gesture at all;
//   * an action offered only where it can land — no dead Save button on a row
//     with no object to save, no phone number that Brief looked up for you;
//   * a "not for me" recorded on the server (and honoured on the next load)
//     versus a hide that only this device remembers, each described in its own
//     words rather than dressed as the other;
//   * a failed write saying so instead of flipping an icon and hoping.
// ---------------------------------------------------------------------------
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://brief.test/', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.localStorage = dom.window.localStorage;
Object.defineProperty(globalThis, 'navigator', { value: dom.window.navigator, configurable: true });
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
global.Element = dom.window.Element;
global.IS_REACT_ACT_ENVIRONMENT = true;

const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { ActivityReel, reelSelection } = require('./src/features/home/ActivityReel.tsx');
const grammar = require('./src/ui/gestures/grammar.ts');

let passed = 0;
const pass = (label) => { passed++; console.log(`PASS ${label}`); };
const flush = async (ms = 30) => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };

// --- fetch stub ------------------------------------------------------------
let calls = [];
let personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } };
let personalOk = true;
let saveOk = true;
let saveError = 'Service unavailable';
let relevanceOk = true;
global.fetch = async (url, init) => {
  const u = String(url);
  const method = (init && init.method) || 'GET';
  calls.push({ url: u, method, body: init && init.body ? JSON.parse(init.body) : null });
  const ok = (b) => ({ ok: true, status: 200, text: async () => JSON.stringify(b) });
  const bad = (status, error) => ({ ok: false, status, text: async () => JSON.stringify({ error }) });
  if (u.includes('/api/me/saved/')) {
    if (!saveOk) return bad(503, saveError);
    const id = decodeURIComponent(u.split('/api/me/saved/')[1]);
    personal.saved = method === 'DELETE' ? personal.saved.filter((x) => x !== id) : [...new Set([...personal.saved, id])];
    return ok({ ok: true, saved: personal.saved });
  }
  if (u.includes('/api/me/relevance')) {
    if (!relevanceOk) return bad(503, 'Service unavailable');
    const { kind, objectId } = (init && init.body ? JSON.parse(init.body) : {}) || {};
    if (kind === 'not_interested') {
      personal.relevance.notInterested = method === 'DELETE'
        ? personal.relevance.notInterested.filter((x) => x !== objectId)
        : [...new Set([...personal.relevance.notInterested, objectId])];
    }
    return ok({ ok: true, relevance: personal.relevance });
  }
  if (u.includes('/api/me')) {
    return personalOk ? ok({ interests: {}, saved: personal.saved, relevance: personal.relevance, topics: [] }) : bad(401, 'Sign in first');
  }
  return bad(404, 'not found');
};

// --- fixtures --------------------------------------------------------------
const event = (over = {}) => ({
  kind: 'event', id: 'fest-1', objectId: 'obj_fest', title: 'E2E Fest', description: 'A real description',
  priceLabel: 'KES 500', dateLabel: 'Sat 20 Sep', location: 'Ruai', mediaUrl: null, seller: 'A host',
  stock: null, orderable: null, contact: null, contactNote: null, interest: null, why: 'soonest date', ...over
});
const listing = (over = {}) => ({
  kind: 'listing', id: 'list-1', objectId: null, title: 'Sukuma wiki, 200kg lots', description: null,
  priceLabel: 'KES 150', dateLabel: null, location: 'Wakulima Market', mediaUrl: null, seller: 'A seller',
  stock: 12, orderable: true, contact: null, contactNote: null, interest: null, why: 'newest live listing', ...over
});
const items = [event(), listing(), listing({ id: 'list-2', title: 'Cow peas', why: '3 settled orders' })];

let opened = null;
let root = null;
async function mount(list = items, onOpenItem = (item) => { opened = item; }) {
  if (root) await act(async () => { root.unmount(); });
  document.body.innerHTML = '<div id="reel-root"></div>';
  root = createRoot(document.getElementById('reel-root'));
  await act(async () => {
    root.render(React.createElement(ActivityReel, { items: list, onOpenItem }));
  });
  await flush(10);
}

// --- pointer helpers -------------------------------------------------------
const stage = () => document.querySelector('.reel-stage');
const at = (el, type, x, y) => {
  const e = new dom.window.Event(type, { bubbles: true, cancelable: true });
  e.clientX = x; e.clientY = y; e.pointerId = 1; e.pointerType = 'touch'; e.button = 0; e.isPrimary = true;
  return act(async () => { el.dispatchEvent(e); });
};
const swipe = async (dx, dy, { steps = 4 } = {}) => {
  const el = stage();
  await at(el, 'pointerdown', 200, 300);
  for (let i = 1; i <= steps; i++) await at(el, 'pointermove', 200 + (dx * i) / steps, 300 + (dy * i) / steps);
  await at(el, 'pointerup', 200 + dx, 300 + dy);
  await flush(10);
};
const hold = async (ms = 400) => {
  const el = stage();
  await at(el, 'pointerdown', 200, 300);
  await flush(ms);
};
const release = async () => { await at(stage(), 'pointerup', 200, 300); await flush(20); };
const click = async (el) => { assert.ok(el, 'the control must exist to be pressed'); await act(async () => { el.click(); }); await flush(20); };
const count = () => document.querySelector('.reel-count').textContent;
const detail = () => document.querySelector('[data-testid="reel-detail"]');
const buttons = () => [...document.querySelectorAll('button')];
const byLabel = (label) => buttons().find((b) => (b.getAttribute('aria-label') || '').trim() === label || b.textContent.trim() === label);

(async () => {
  // ── 1. The grammar itself: thresholds, axis bias, the ends ────────────────
  {
    const g = grammar.GestureMetrics;
    assert.deepEqual(grammar.classifyGesture({ dx: 0, dy: 0, ms: 90 }, 'set'), { kind: 'act' }, 'a press that did not move is a tap');
    assert.deepEqual(grammar.classifyGesture({ dx: -70, dy: 6, ms: 400 }, 'set'), { kind: 'browse', direction: 'next' }, 'left browses forward');
    assert.deepEqual(grammar.classifyGesture({ dx: 70, dy: 6, ms: 400 }, 'set'), { kind: 'browse', direction: 'prev' }, 'right browses back');
    assert.equal(grammar.classifyGesture({ dx: -20, dy: 4, ms: 400 }, 'set'), null, `a ${20}px nudge commits to nothing and snaps back`);
    assert.equal(grammar.classifyGesture({ dx: 30, dy: 26, ms: 400 }, 'set'), null, 'a diagonal belongs to neither axis, so nothing happens');
    assert.deepEqual(grammar.classifyGesture({ dx: 0, dy: -70, ms: 400 }, 'set'), { kind: 'open-detail' }, 'up is always deeper');
    assert.deepEqual(grammar.classifyGesture({ dx: 0, dy: 70, ms: 400 }, 'detail'), { kind: 'close-detail' }, 'in the detail, down is the way back');
    assert.equal(grammar.classifyGesture({ dx: 0, dy: 70, ms: 400 }, 'set'), null, 'the same swipe in the set is not yet a decision…');
    assert.deepEqual(grammar.classifyGesture({ dx: 0, dy: 110, ms: 400 }, 'set'), { kind: 'dismiss' }, '…until it travels far enough to mean it');
    assert.deepEqual(grammar.classifyGesture({ dx: -20, dy: 0, ms: 30 }, 'set'), { kind: 'browse', direction: 'next' }, 'a fast flick commits sooner than a slow drag');
    assert.deepEqual(grammar.classifyGesture({ dx: -20, dy: 0, ms: 2000 }, 'set'), null, 'a slow 20px drag is still nothing');
    assert.equal(grammar.shouldPeek({ dx: 3, dy: 2, ms: g.holdMs }), true, 'a still press becomes a peek');
    assert.equal(grammar.shouldPeek({ dx: 40, dy: 0, ms: g.holdMs }), false, 'a moving press never becomes a peek');
    assert.equal(grammar.withResistance(80, true), 80, 'with more to see, the deck follows the finger exactly');
    assert.ok(grammar.withResistance(80, false) < 80, 'at the end of the set the deck resists instead of pretending');
    assert.deepEqual(grammar.axisOf(30, 20), 'horizontal', 'the dominant axis owns the gesture');
    assert.equal(grammar.axisOf(28, 26), null, 'and a tie owns nothing');
    pass(`the grammar is fixed by numbers: tap ${g.tapSlopPx}px, hold ${g.holdMs}ms, browse ${g.browseCommitPx}px, depth ${g.depthCommitPx}px, deal ${g.dismissCommitPx}px`);
  }

  // ── 2. One thing at a time, and where you are in the set ─────────────────
  {
    calls = []; personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } }; personalOk = true;
    localStorage.clear();
    await mount();
    assert.equal(document.querySelector('.reel-card[data-testid="reel-card"]').textContent.includes('E2E Fest'), true, 'the first row is the hero card');
    assert.equal(count().startsWith('1 of 3'), true, `the reel says where you are: "${count()}"`);
    assert.equal(document.querySelectorAll('.reel-segments li').length, 3, 'one segment per activity, so the set has a visible end');
    assert.equal(byLabel('Previous activity').disabled, true, 'there is nothing before the first, and the control says so');
    assert.equal(byLabel('Next activity').disabled, false, 'there is somewhere to go');
    assert.equal(document.querySelector('.reel-card[data-slot="next"]').getAttribute('aria-hidden'), 'true',
      'the neighbours are drawn for the swipe, and hidden from assistive tech');
    assert.equal(document.querySelectorAll('.reel-card[data-slot="prev"]').length, 0, 'nothing is rendered behind the first card');
    pass('the reel is one activity at a time, with a position you can read and an end you can reach');
  }

  // ── 3. Horizontal is browse — and every way of doing it agrees ───────────
  {
    await swipe(-90, 0);
    assert.equal(count().startsWith('2 of 3'), true, `a left swipe moves one on: "${count()}"`);
    await swipe(90, 0);
    assert.equal(count().startsWith('1 of 3'), true, 'and a right swipe comes back');
    await click(byLabel('Next activity'));
    assert.equal(count().startsWith('2 of 3'), true, 'the edge control is the same move, precisely');
    await swipe(90, 0); // back to the first
    await act(async () => { document.querySelector('.reel-stage').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    await flush(10);
    assert.equal(count().startsWith('2 of 3'), true, 'and so is the right arrow key');
    await swipe(-90, 0);
    assert.equal(count().startsWith('3 of 3'), true, 'browsing reaches the last activity');
    await swipe(-90, 0);
    assert.equal(count().startsWith('3 of 3'), true, 'and stops there rather than wrapping to the start');
    assert.equal(byLabel('Next activity').disabled, true, 'at the end, the next control is honest about it');
    await swipe(90, 0);
    pass('browse works by swipe, by edge control and by keyboard, and the ends are ends');
  }

  // ── 4. Vertical is depth: up for the detail, down for the way back ───────
  {
    await mount();
    assert.equal(detail().hidden, true, 'the detail starts closed');
    await swipe(0, -80);
    assert.equal(detail().hidden, false, 'a swipe up opens it — there was more here');
    const text = detail().textContent;
    assert.ok(text.includes('E2E Fest') && text.includes('KES 500') && text.includes('Ruai') && text.includes('Sat 20 Sep'),
      'the detail carries the row\'s own words: title, price, place, date');
    assert.ok(text.includes('soonest date'), 'and the board\'s own reason for showing it, attributed');
    assert.ok(text.includes('A host'), 'and who is hosting it');
    assert.equal(document.querySelector('[data-testid="reel-card"]').textContent.includes('Seen'), true,
      'opening it marks it seen on this device');
    await swipe(0, 80);
    assert.equal(detail().hidden, true, 'a swipe down closes it: back to the reel');
    await swipe(0, -80);
    await act(async () => { document.querySelector('.reel-stage').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    await flush(10);
    assert.equal(detail().hidden, true, 'Escape is the same move for a keyboard');
    assert.equal(byLabel('Close details') !== undefined, true, 'and the close control is a real, labelled button');
    pass('down/up the screen is depth: a swipe, a key and a button all open and close the same panel');
  }

  // ── 5. Tap selects; a tap on a control is not a gesture ──────────────────
  {
    await mount();
    await at(stage(), 'pointerdown', 220, 300);
    await at(stage(), 'pointerup', 224, 302);
    await flush(10);
    assert.equal(detail().hidden, false, 'a tap opens the thing under the finger');
    // A press that lands on a control inside the detail belongs to that control.
    await click(byLabel('Close details'));
    assert.equal(detail().hidden, true, 'the close control does its own job');
    await click(byLabel('Details'));
    assert.equal(detail().hidden, false, 'the labelled Details twin opens it too');
    pass('a tap selects, and a press that starts on a control never becomes a card gesture');
  }

  // ── 6. Hold peeks without leaving, and a peek is not a tap ───────────────
  {
    await mount();
    await hold(420);
    assert.ok(document.querySelector('.reel-peek'), 'a hold opens a peek while the finger is still down');
    assert.ok(document.querySelector('.reel-peek').textContent.includes('E2E Fest'), 'and the peek is the thing you are holding');
    assert.equal(detail().hidden, true, 'a peek does not navigate — you have not left the reel');
    await release();
    assert.equal(document.querySelector('.reel-peek'), null, 'lifting the finger closes it');
    assert.equal(detail().hidden, true, 'and lifting is not also a tap: nothing opened');
    pass('hold peeks and release closes it, without leaving the reel and without a surprise tap');
  }

  // ── 7. Swipe away is dealt with — recorded where it can be, said how it was
  {
    calls = [];
    localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } };
    await mount();
    await swipe(0, 130);
    assert.equal(count().startsWith('1 of 2'), true, `the dealt-with activity leaves the reel: "${count()}"`);
    const notice = document.querySelector('.reel-notice');
    assert.ok(notice && notice.textContent.includes('E2E Fest'), 'and the reel says which one it was');
    assert.ok(notice.textContent.includes('will not come back on this account'), 'a recorded "not for me" is described as one');
    await flush(60);
    const posted = calls.filter((c) => c.url.includes('/api/me/relevance') && c.method === 'POST');
    assert.equal(posted.length, 1, 'exactly one record was written, not one per render');
    assert.equal(posted[0].body.objectId, 'obj_fest', 'keyed by the object the row carries — not by the row\'s own id');
    assert.equal(posted[0].body.kind, 'not_interested', 'and it is the control the board already understands');
    await click(byLabel('Undo'));
    assert.equal(count().startsWith('1 of 3'), true, 'Undo brings it back');
    assert.equal(calls.some((c) => c.url.includes('/api/me/relevance') && c.method === 'DELETE'), true,
      'and it takes the record back out on the server too, rather than only on screen');
    pass('swiping away deals with an activity, records it against a real object, and can be undone');
  }

  // ── 8. An action is offered only where it can land ───────────────────────
  {
    calls = []; localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } };
    await mount();
    await swipe(-90, 0); // the first listing: no object, no contact
    assert.equal(byLabel('Save'), undefined, 'a row with no object offers no Save button, rather than a dead one');
    assert.equal(byLabel('Message the seller'), undefined, 'and with no published contact it invents no phone number');
    await click(byLabel('Details'));
    assert.ok(detail().textContent.includes('12 available'), 'a counted stock is printed as the count it is');
    assert.equal(buttons().some((b) => b.textContent.trim() === 'Save'), false, 'the detail offers the same honest set of actions');

    // "Stock: null" is not zero — it is "nobody counted", and the card says that
    // in words instead of a number it would have had to invent.
    await mount([listing({ id: 'list-uncounted', stock: null })]);
    await click(byLabel('Details'));
    assert.ok(detail().textContent.includes('Not counted for this offer'), 'and an uncounted stock says so rather than printing a zero');

    // A seller who DID publish a contact gets the message action.
    await mount([listing({ id: 'list-contact', contact: '0712 000 111', contactNote: 'The seller listed this contact themselves; Brief did not look it up or fill it in.' })]);
    await click(byLabel('Details'));
    const message = buttons().find((b) => b.textContent.trim() === 'Message the seller');
    assert.ok(message, 'a listing whose seller published a contact offers a way to reach them');
    assert.ok(detail().textContent.includes('did not look it up'), 'and repeats, in the seller\'s own words, where that contact came from');

    // "WhatsApp" is a method, not a number. The offer sheet already refuses to
    // dress one up as the other, and the reel refuses with the same words.
    await mount([listing({ id: 'list-method', contact: 'WhatsApp', contactNote: 'The seller listed this contact themselves.' })]);
    await click(byLabel('Details'));
    assert.equal(buttons().some((b) => b.textContent.trim() === 'Message the seller'), false,
      'a contact method with no number behind it offers no message button');
    assert.ok(detail().textContent.includes('no number to dial'), 'and the card says why, rather than hiding the fact');
    pass('Save needs an object, messaging needs a number the seller wrote, and neither is faked');
  }

  // ── 8b. Which five: a stream with both kinds in it ──────────────────────
  {
    const offers = Array.from({ length: 7 }, (_, i) => listing({ id: `l${i}`, title: `Offer ${i}` }));
    const events = [event({ id: 'e1', title: 'Soon event' }), event({ id: 'e2', title: 'Later event' }), event({ id: 'e3', title: 'Third event' })];
    const picked = reelSelection([...offers, ...events]);
    assert.equal(picked.length, 5, 'the reel stays bounded to five activities');
    assert.deepEqual(picked.filter((i) => i.kind === 'event').map((i) => i.id), ['e1', 'e2'],
      'and the two soonest events are in view, instead of being pushed off the end by offers');
    assert.deepEqual(picked.filter((i) => i.kind !== 'event').map((i) => i.id), ['l0', 'l1', 'l2'],
      'offers fill the rest, in the board\'s own order, untouched');
    assert.deepEqual(reelSelection([...offers]).map((i) => i.id), ['l0', 'l1', 'l2', 'l3', 'l4'],
      'with nothing on, five offers still fill the reel');
    assert.deepEqual(reelSelection([...events]).map((i) => i.id), ['e1', 'e2'],
      'with nothing selling, the reel is what is on');
    // And the same rule through the surface: an event is reachable from Home.
    await mount(reelSelection([...offers, ...events]));
    assert.equal(document.querySelector('[data-testid="reel-card"]').textContent.includes('Offer 0'), true);
    let seenEvent = false;
    for (let i = 0; i < 4; i++) {
      await click(byLabel('Next activity'));
      if (document.querySelector('[data-testid="reel-card"]').textContent.includes('event')) seenEvent = true;
    }
    assert.equal(seenEvent, true, 'and swiping reaches it, so a party is not permanently out of frame');
    pass('the five cards are chosen by a stated, kind-fair rule — not by whatever order the board happened to emit');
  }

  // ── 9. Save is a real row, and a failed save says so ─────────────────────
  {
    calls = []; personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } }; saveOk = true;
    await mount();
    await click(byLabel('Save'));
    assert.equal(calls.some((c) => c.url.includes('/api/me/saved/obj_fest') && c.method === 'POST'), true, 'Save writes to the caller\'s own saved things');
    assert.ok(document.querySelector('.reel-notice').textContent.includes('saved things'), 'and the reel confirms where it went');
    assert.equal(byLabel('Saved') !== undefined, true, 'the control now reads Saved');
    await click(byLabel('Saved'));
    assert.equal(calls.some((c) => c.url.includes('/api/me/saved/obj_fest') && c.method === 'DELETE'), true, 'pressing it again takes the save back');

    saveOk = false; saveError = 'Service unavailable';
    await click(byLabel('Save'));
    const failure = document.querySelector('.reel-notice');
    assert.ok(failure.textContent.includes('Service unavailable'), 'a failed save reports the server\'s own words');
    assert.equal(failure.className.includes('reel-notice--error'), true, 'and is not styled as a success');
    assert.equal(byLabel('Save') !== undefined, true, 'and the control does NOT flip to Saved');
    saveOk = true;
    pass('Save is a server row with an undo, and a write that failed is never shown as one that worked');
  }

  // ── 10. What the server remembers survives a reload; what it cannot is named
  {
    calls = [];
    // A fresh device (empty local memory) with no contact and no object.
    localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } };
    await mount();
    await swipe(-90, 0);
    await swipe(0, 130); // deal with the listing that has no object
    const deviceNotice = document.querySelector('.reel-notice').textContent;
    assert.ok(/hidden on this device/.test(deviceNotice), `a hide with nothing to record it against says so: "${deviceNotice}"`);
    assert.equal(calls.filter((c) => c.url.includes('/api/me/relevance') && c.method === 'POST').length, 0,
      'and nothing is written to the server pretending otherwise');
    assert.equal(JSON.parse(localStorage.getItem('brief.reel.memory.v1')).hidden.length, 1, 'it is remembered where it can be: this device');
    assert.equal(JSON.parse(localStorage.getItem('brief.reel.memory.v1')).seen.length, 0, 'and a hide is not stored as a "seen"');

    // Now a reload on a device with empty memory, but a server that has the row.
    localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: ['obj_fest'], hiddenSources: [] } };
    await mount();
    assert.equal(document.querySelector('[data-testid="reel-card"]').textContent.includes('Sukuma wiki'), true,
      'a "not for me" written last week still keeps the row out of the reel after a reload');
    assert.equal(count().startsWith('1 of 2'), true, 'and the set is the size it really is, not the size the board is');
    pass('a recorded decision survives a reload on any device, and a device-only hide is never called a preference');
  }

  // ── 11. Nothing left, and putting it back ────────────────────────────────
  {
    localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: ['obj_fest'], hiddenSources: [] } };
    const onlyObjectless = [listing({ id: 'solo', title: 'Only row' })];
    localStorage.setItem('brief.reel.memory.v1', JSON.stringify({ seen: [], hidden: ['listing:solo'] }));
    await mount(onlyObjectless);
    const empty = document.querySelector('[data-testid="activity-reel"]');
    assert.ok(empty.textContent.includes('dealt with everything'), 'an emptied reel says it was emptied, not that nothing exists');
    assert.equal(empty.textContent.includes('No recent activity'), false, 'and never confuses the two facts');
    await click(document.querySelector('.reel-restore'));
    assert.equal(document.querySelector('[data-testid="reel-card"]').textContent.includes('Only row'), true, 'Put them back restores what this device hid');
    assert.equal(calls.some((c) => c.url.includes('/api/me/relevance') && c.method === 'DELETE'), true, 'and undoes the recorded ones on the server');
    pass('an empty reel is honest about why it is empty, and everything can be put back');
  }

  // ── 12. The verbs are on the screen, not just in the gestures ────────────
  {
    localStorage.clear();
    personal = { saved: [], relevance: { more: [], less: [], notInterested: [], hiddenSources: [] } };
    await mount();
    const legend = document.querySelector('.reel-legend').textContent;
    for (const word of ['browse', 'details', 'peek', 'deal with it']) {
      assert.ok(legend.includes(word), `the legend names "${word}" — a gesture nobody can find is a secret`);
    }
    const labels = buttons().map((b) => b.getAttribute('aria-label') || b.textContent.trim());
    for (const label of ['Previous activity', 'Next activity', 'Details', 'Save', 'Not for me', 'Close details']) {
      assert.ok(labels.includes(label), `"${label}" is a labelled control, so no verb is finger-only`);
    }
    assert.equal(document.querySelector('.reel-stage').getAttribute('aria-roledescription'), 'activity reel', 'the surface says what it is');
    assert.equal(document.querySelector('.reel-count').getAttribute('aria-live'), 'polite', 'and moving through the set is announced');
    pass('every gesture has a labelled twin on screen, and the set announces where it is');
  }

  await act(async () => { root.unmount(); });
  console.log(`PASSED ${passed} FAILED 0`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
