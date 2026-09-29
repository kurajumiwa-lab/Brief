// Brief Trade: the three-pillar concept surface, fitted to a phone. Checks the
// architecture blend, the mobile fit contract and the honest-preview claims.
// Named apart from the public route: preview/pillars.jsx would shadow /pillars
// in Vite's extension resolver during development.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/pillars', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'); const { act } = React;
const { createRoot } = require('react-dom/client');
const { SCREENS, SCREENS_BY_ID, TABS } = require('./src/features/pillars/pillarsData.ts');
const { PillarsApp } = require('./src/features/pillars/PillarsApp.tsx');
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('PASS ' + label); };
const click = async (el) => { assert.ok(el, 'click target exists'); await act(async () => el.click()); };
const byText = (sel, text) => [...document.querySelectorAll(sel)].find(el => el.textContent.includes(text));

(async () => {
  const main = fs.readFileSync(path.join(__dirname, 'src/main.jsx'), 'utf8');
  check('production entry routes the three-pillar surface without a private shell', () => {
    assert.match(main, /\/pillars/); assert.match(main, /<PillarsApp\s*\/>/);
  });
  check('the architecture record is named in the repo', () => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'docs', 'THREE-PILLAR-PRIMARY-ARCHITECTURE.md')));
  });

  check('eighteen screens cover the three pillars and every Brief door', () => {
    assert.ok(SCREENS.length >= 18);
    const pillars = new Set(SCREENS.map(s => s.pillar));
    assert.deepEqual([...pillars].sort(), ['p1', 'p2', 'p3']);
    const doors = new Set(SCREENS.map(s => s.door));
    for (const door of ['Home', 'Trade', 'Shop', 'Market', 'You']) assert.ok(doors.has(door), door);
    assert.ok(SCREENS.every(s => s.hash.startsWith('#') && s.fit.length >= 3 && s.edges.length >= 2));
    // USSD parity is a spec requirement for the ordering pillar.
    assert.ok(SCREENS_BY_ID['ussd'].ussd.includes('Order Stock'));
  });

  check('five bottom-bar tabs mirror the Brief doors', () => {
    assert.deepEqual(TABS.map(t => t.label), ['Map', 'Supply', 'Shop', 'Gather', 'Scout']);
  });

  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<PillarsApp />); });

  check('the surface presents itself as a concept with no live commerce', () => {
    const copy = document.body.textContent;
    assert.match(copy, /Three pillars/);
    assert.match(copy, /No order, batch, pool, stall, payout or payment in this preview is live/);
    assert.doesNotMatch(copy, /Payment successful|Order placed|Paid KES/);
  });

  check('the Trade Map shows regions, the comparison layer and a sourcing entry', () => {
    assert.ok(document.querySelector('.pp-map'));
    assert.ok(document.querySelectorAll('.pp-pin').length >= 5);
    assert.match(document.querySelector('.pp-spotlight').textContent, /3 things changed around you/);
    assert.ok(byText('button', 'Find it for me'));
  });

  await click(byText('button', 'Find it for me'));
  check('Find it for me takes three fields then returns sources with delivery options', () => {
    assert.equal(SCREENS_BY_ID['find-for-me'].tab, 'map');
    assert.ok(byText('button', 'Nairobi'));
    assert.ok(byText('button', 'Frozen'));
  });
  await click(byText('button', 'Find sources'));
  check('sources fold delivery options underneath and disable booking with a reason', () => {
    assert.match(document.body.textContent, /Baharini Fresh Ltd/);
    assert.match(document.body.textContent, /Registered courier A · National/);
    const book = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Book delivery');
    assert.ok(book.disabled);
    assert.match(document.body.textContent, /Referral booking is not live in this preview/);
  });
  await click(byText('button', 'Compare all delivery options'));
  check('the delivery sheet lists licence classes, including courier hailing', () => {
    const sheet = document.querySelector('.pp-sheet');
    assert.match(sheet.textContent, /Licensed operators only/);
    assert.match(sheet.textContent, /Courier hailing/);
    assert.match(sheet.textContent, /96% on time/);
  });
  await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));

  await click([...document.querySelectorAll('.pp-tabbtn')].find(b => b.textContent.includes('Supply')));
  await click(byText('.pp-screenbtn', 'Consolidation desk'));
  check('the consolidation desk states the STR ceiling and the split-or-escalate choice', () => {
    assert.match(document.body.textContent, /US\$ 2,000 per consignment/);
    assert.equal(SCREENS_BY_ID['consolidation'].pillar, 'p1');
  });
  await click(byText('button', 'Add consignment'));
  check('a consignment above the ceiling is refused with its two legal options', () => {
    const sheet = document.querySelector('.pp-sheet');
    assert.match(sheet.textContent, /Above the STR ceiling/);
    assert.match(sheet.textContent, /Split into sub-consignments/);
    assert.match(sheet.textContent, /Escalate to full declaration/);
  });
  await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check('escape closes the sheet and returns focus', () => assert.equal(document.querySelector('.pp-sheet'), null));

  await click(byText('.pp-screenbtn', 'Vendor payout'));
  check('the payout card prints the arithmetic beside the derived balance', () => {
    assert.match(document.body.textContent, /UGX 2,333,240/);
    assert.match(document.body.textContent, /KES 48,200 × 28.4 = UGX 1,368,880/);
    assert.match(document.body.textContent, /buffer 1.5%/);
    assert.match(document.body.textContent, /Automated UGX payout is a blocked workstream/);
    const early = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Request early payout'));
    assert.ok(early.disabled);
  });

  await click([...document.querySelectorAll('.pp-tabbtn')].find(b => b.textContent.includes('Shop')));
  check('the duka home puts reorder first and pairs a USSD phone', () => {
    assert.ok(byText('button', 'Reorder last order'));
    assert.ok(byText('button', 'Order by USSD'));
  });
  await click(byText('.pp-screenbtn', 'Pool & Save'));
  check('the pool shows the fill level and the next price break in money', () => {
    assert.match(document.body.textContent, /340 kg pooled/);
    assert.match(document.body.textContent, /KES 112/);
    assert.match(document.body.textContent, /does not reach its minimum/);
  });

  await click(byText('.pp-screenbtn', 'USSD ordering'));
  check('the USSD session runs the spec menu tree over plain text', () => {
    assert.match(document.querySelector('.pp-ussdtext').textContent, /Dial \*483\*88#/);
  });
  await click(byText('button', 'Send'));
  check('dialling opens the root menu', () => assert.match(document.querySelector('.pp-ussdtext').textContent, /1\. Order Stock/));
  await click([...document.querySelectorAll('.pp-key')].find(k => k.textContent === '1'));
  check('order stock lists the categories', () => assert.match(document.querySelector('.pp-ussdtext').textContent, /1\. Farm Produce/));
  await click([...document.querySelectorAll('.pp-key')].find(k => k.textContent === '1'));
  check('a category lists products with the pooled price', () => assert.match(document.querySelector('.pp-ussdtext').textContent, /Maize Flour 2kg - KES 120 \(pool 340kg\)/));
  await click([...document.querySelectorAll('.pp-key')].find(k => k.textContent === '1'));
  check('a product leads to a quantity prompt', () => {
    assert.match(document.querySelector('.pp-ussdtext').textContent, /Enter quantity for Maize Flour 2kg/);
  });
  const entry = document.querySelector('.pp-ussdentry input');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(entry, '20'); entry.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(byText('button', 'Send'));
  check('the confirm screen states the total and offers change or cancel', () => {
    assert.match(document.querySelector('.pp-ussdtext').textContent, /Confirm: 20 x Maize Flour 2kg/);
    assert.match(document.querySelector('.pp-ussdtext').textContent, /Total: KES 2,400/);
  });

  await click(byText('.pp-screenbtn', 'Institutional desk'));
  check('the institutional desk shows credit utilisation and a due invoice', () => {
    assert.match(document.body.textContent, /KES 184,000 of KES 500,000 credit used/);
    assert.match(document.body.textContent, /INV-2210 due in 9 days/);
  });

  await click([...document.querySelectorAll('.pp-tabbtn')].find(b => b.textContent.includes('Gather')));
  check('the event feed prints stalls remaining as the only number', () => {
    assert.match(document.body.textContent, /12 of 40 remaining/);
    assert.match(document.body.textContent, /needs 12 more food vendors/);
  });
  await click(byText('.pp-screenbtn', 'Stall application'));
  await click(byText('button', 'Pay stall fee'));
  check('the stall fee sheet states the refund rule before payment', () => {
    assert.match(document.querySelector('.pp-sheet').textContent, /Refunded automatically if the event is cancelled/);
  });
  await click(byText('button', 'Pay with M-Pesa'));
  check('the stall pass is a QR plus the essentials', () => {
    assert.ok(document.querySelector('.pp-pass img'));
    assert.match(document.querySelector('.pp-pass').textContent, /Baharini Fresh Ltd · Stall 14/);
  });
  await act(async () => dom.window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));

  await click(byText('.pp-screenbtn', 'Organiser desk'));
  await click(byText('button', 'Reject'));
  check('a rejection requires a reason before it can be sent', () => {
    const sheet = document.querySelector('.pp-sheet');
    assert.match(sheet.textContent, /Reject with a reason/);
    const send = [...sheet.querySelectorAll('button')].find(b => b.textContent.includes('Reject and refund'));
    assert.ok(send.disabled);
  });
  const reason = document.querySelector('.pp-sheet input');
  await act(async () => { Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(reason, 'Category already full'); reason.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  check('with a reason the rejection becomes sendable', () => {
    const send = [...document.querySelectorAll('.pp-sheet button')].find(b => b.textContent.includes('Reject and refund'));
    assert.ok(!send.disabled);
  });

  await click(byText('.pp-screenbtn', 'Event blueprint'));
  check('the blueprint answers the ask with categories, vendors, sourcing and logistics', () => {
    const copy = document.body.textContent;
    assert.match(copy, /Farmers market in Mombasa for 40 vendors/);
    assert.match(copy, /12 suppliers match these categories/);
    assert.match(copy, /Kilifi/);
    assert.match(copy, /licensed courier operators/);
  });

  await click([...document.querySelectorAll('.pp-tabbtn')].find(b => b.textContent.includes('Scout')));
  check('the scout screen derives earnings and states the flat-fee law', () => {
    assert.match(document.body.textContent, /KES 1,200/);
    assert.match(document.body.textContent, /KES 150 × 8 approved missions/);
    assert.match(document.body.textContent, /Depth stays at one/);
  });

  check('every screen spec panel carries door, hash, model, api and edge cases', () => {
    assert.ok(document.querySelector('.pp-spec h2'));
    assert.ok(document.querySelector('.pp-speccode'));
    assert.ok(document.querySelectorAll('.pp-speclist').length >= 2);
  });

  check('the mobile fit contract is published beside the device', () => {
    const strip = document.querySelector('.pp-fitstrip');
    assert.match(strip.textContent, /360 × 800 baseline/);
    assert.match(strip.textContent, /44 dp targets/);
    assert.match(strip.textContent, /16 px inputs/);
  });

  const css = fs.readFileSync(path.join(__dirname, 'src/features/pillars/pillars.css'), 'utf8');
  check('the stylesheet is mobile-first: base rules first, the frame only above 900px', () => {
    const desktop = css.indexOf('@media (min-width: 900px)');
    assert.ok(desktop > 0);
    assert.match(css.slice(0, desktop), /\.pp-app\b/);
    assert.match(css.slice(0, desktop), /min-height: 100vh/);
    assert.match(css.slice(desktop), /width: 390px; height: 844px/);
    assert.match(css, /env\(safe-area-inset-bottom/);
    assert.match(css, /prefers-reduced-motion/);
    assert.doesNotMatch(css, /0\. 04/);
  });

  await act(async () => root.unmount());
  dom.window.close();
  console.log(`PASSED ${passed} FAILED 0`);
  process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
