// CloudBites: public route, truthful concept state and functioning local UI.
const assert = require('assert').strict;
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: 'https://brief.test/cloudbites', pretendToBeVisual: true });
global.window = dom.window; global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'); const { act } = React;
const { createRoot } = require('react-dom/client');
const { categories, dishes, checkPlanningZone, zones } = require('./src/features/cloudbites/cloudBitesData.ts');
const { CloudBitesPage } = require('./src/features/cloudbites/CloudBitesPage.tsx');
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('PASS ' + label); };
const click = async (el) => { assert.ok(el, 'click target exists'); await act(async () => el.click()); };
const type = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
(async () => {
  const main = fs.readFileSync(path.join(__dirname, 'src/main.jsx'), 'utf8');
  check('production entry routes the public CloudBites page without a private shell', () => {
    assert.match(main, /\/cloudbites/); assert.match(main, /<CloudBitesPage\s*\/>/);
  });
  check('five cuisine and eight dish photographs are optimized local assets', () => {
    assert.equal(categories.length, 5); assert.equal(dishes.length, 8);
    for (const name of ['hero', ...categories.map(c => c.image), ...dishes.map(d => d.image)]) {
      const file = path.join(__dirname, 'public/assets/cloudbites', name + '.webp');
      assert.ok(fs.existsSync(file), name); assert.ok(fs.statSync(file).size < 400000, name + ' is too large');
    }
  });
  check('zone checker never treats ZIP or arbitrary addresses as verified coverage', () => {
    assert.equal(checkPlanningZone('00100'), null);
    assert.equal(checkPlanningZone('Somewhere, Nairobi'), null);
    assert.equal(checkPlanningZone('Kilimani, Nairobi')?.id, 'kilimani');
    assert.equal(zones.length, 5);
  });
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<CloudBitesPage />); });
  check('complete landing sections and no fake commerce or ratings', () => {
    for (const id of ['how','menu','about','popular','zones','app','allergens','policies']) assert.ok(document.getElementById(id), id);
    assert.match(document.body.textContent, /Restaurant-Quality Food, Delivered Fast/);
    assert.match(document.body.textContent, /30 minutes or less/);
    assert.match(document.body.textContent, /No 4.8\/5 score or 10,000\+ order claim/);
    assert.match(document.body.textContent, /No orders or courier deliveries are live yet/);
    assert.equal(document.querySelectorAll('.cb-category').length, 5);
    assert.equal(document.querySelectorAll('.cb-dish').length, 8);
    assert.equal(document.querySelectorAll('.cb-map-pin').length, 5);
    assert.ok([...document.querySelectorAll('.cb-store-row button')].every(el => el.disabled));
  });
  const address = document.getElementById('cb-address');
  await type(address, 'Westlands');
  await click(document.querySelector('.cb-address-form button'));
  check('address form estimates only named planning neighborhoods', () => {
    assert.match(document.querySelector('.cb-address-result').textContent, /Westlands: planning estimate 25–35 min/);
    assert.match(document.querySelector('.cb-address-result').textContent, /Coverage and timing are not confirmed/);
  });
  await type(address, '00100');
  await click(document.querySelector('.cb-address-form button'));
  check('ZIP cannot silently claim a delivery zone', () => assert.match(document.querySelector('.cb-address-result').textContent, /can’t verify this address/));
  await click(document.querySelectorAll('.cb-map-pin')[2]);
  check('interactive planning map updates the selected neighborhood and estimate', () => {
    assert.match(document.querySelector('.cb-zone-feedback').textContent, /Kilimani/);
    assert.ok(document.querySelectorAll('.cb-map-pin')[2].classList.contains('is-selected'));
  });
  await click(document.querySelectorAll('.cb-category')[4]);
  check('category image filters the dish carousel', () => {
    assert.equal(document.querySelectorAll('.cb-dish').length, 2);
    assert.match(document.querySelector('.cb-dish').textContent, /Brownie/);
  });
  await click(document.querySelector('.cb-dish-action button'));
  document.querySelector('.cb-cart-trigger').focus();
  await click(document.querySelector('.cb-cart-trigger'));
  check('Add to Cart builds a temporary list but cannot pretend to check out', () => {
    assert.equal(document.querySelector('.cb-cart-head h2 span').textContent, '(1)');
    assert.match(document.querySelector('.cb-cart-foot').textContent, /KES 450/);
    assert.ok(document.querySelector('.cb-cart-foot button').disabled);
    assert.match(document.querySelector('.cb-cart-foot').textContent, /No checkout/);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close lunch list');
  });
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check('cart closes and work/biker links land on existing Brief surfaces', () => {
    assert.equal(document.querySelector('.cb-cart-panel'), null);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Open lunch list, 1 items');
    assert.equal(document.querySelector('.cb-work-actions a').getAttribute('href'), '/#workforce');
    assert.equal(document.querySelectorAll('.cb-work-actions a')[1].getAttribute('href'), '/#city/errands');
  });
  await act(async () => root.unmount());
  dom.window.close();
  console.log(`PASSED ${passed} FAILED 0`); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
