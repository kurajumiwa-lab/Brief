// CloudBites: public local-commerce concept, truthful preview state and local UI.
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
const { categories, dishes, findConceptArea, zones } = require('./src/features/cloudbites/cloudBitesData.ts');
const { CloudBitesPage } = require('./src/features/cloudbites/CloudBitesPage.tsx');
let passed = 0;
const check = (label, fn) => { fn(); passed++; console.log('PASS ' + label); };
const click = async (el) => { assert.ok(el, 'click target exists'); await act(async () => el.click()); };
const type = async (el, value) => { await act(async () => { Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
(async () => {
  const main = fs.readFileSync(path.join(__dirname, 'src/main.jsx'), 'utf8');
  check('production entry routes the public CloudBites concept without a private shell', () => {
    assert.match(main, /\/cloudbites/); assert.match(main, /<CloudBitesPage\s*\/>/);
  });
  check('five menu categories and eight illustrative dishes have optimized local photos', () => {
    assert.equal(categories.length, 5); assert.equal(dishes.length, 8);
    for (const name of ['hero', ...categories.map(c => c.image), ...dishes.map(d => d.image)]) {
      const file = path.join(__dirname, 'public/assets/cloudbites', name + '.webp');
      assert.ok(fs.existsSync(file), name); assert.ok(fs.statSync(file).size < 400000, name + ' is too large');
    }
    assert.ok(dishes.every(dish => /sample item/i.test(dish.badge)));
  });
  check('area helper recognizes only named sample neighborhoods, not ZIPs or arbitrary addresses', () => {
    assert.equal(findConceptArea('Westlands, Nairobi')?.id, 'westlands');
    assert.equal(findConceptArea('Upper Hill')?.id, 'upperhill');
    assert.equal(findConceptArea('00100'), null);
    assert.equal(findConceptArea('Somewhere, Nairobi'), null);
    assert.equal(zones.length, 5);
  });

  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(<CloudBitesPage />); });
  check('page presents CloudBites as a Brief concept and keeps live-service claims explicit', () => {
    for (const id of ['how','uses','offers','menu','popular','zones','workplace','for-business','allergens','policies']) assert.ok(document.getElementById(id), id);
    const copy = document.body.textContent;
    assert.match(copy, /Food from where you’re going\./);
    assert.match(copy, /A FOOD CONCEPT ON BRIEF/);
    assert.match(copy, /No merchant orders, reservations or workplace plans are live/);
    assert.match(copy, /not a live menu/i);
    assert.match(copy, /Local pickup first/);
    assert.match(copy, /visiting town/i);
    assert.match(copy, /quiet hours/i);
    assert.match(copy, /free to join and list/i);
    assert.match(copy, /No exclusivity/i);
    assert.match(copy, /own site, Google presence, Uber, Bolt/i);
    assert.match(copy, /future workplace flow could offer local fulfillment as an option/i);
    assert.match(copy, /additional direct demand/i);
    assert.match(copy, /no upfront subscription or listing fee/i);
    assert.match(copy, /transaction fees on completed business, promoted offers or paid workplace tools/i);
    assert.doesNotMatch(copy, /delivery-only kitchen/i);
    assert.doesNotMatch(copy, /Restaurant-Quality Food, Delivered Fast/i);
    assert.doesNotMatch(copy, /30 minutes or less/i);
    assert.doesNotMatch(copy, /free delivery/i);
    assert.match(copy, /not a promise that all services stay free/i);
    assert.doesNotMatch(copy, /4\.8\/5 score|10,000\+ order claim/i);
    assert.equal(document.querySelectorAll('.cb-category').length, 5);
    assert.equal(document.querySelectorAll('.cb-dish').length, 8);
    assert.equal(document.querySelectorAll('.cb-map-pin').length, 5);
  });

  const address = document.getElementById('cb-address');
  await type(address, 'Westlands');
  await click(document.querySelector('.cb-address-form button'));
  check('destination lookup offers no ETA, coverage or live availability', () => {
    const result = document.querySelector('.cb-address-result').textContent;
    assert.match(result, /Westlands selected/);
    assert.match(result, /would show local menus, offers and pickup options/);
    assert.match(result, /no live listings yet/);
    assert.doesNotMatch(result, /\d+\s*(?:-|–)\s*\d+\s*min|delivery time|coverage confirmed/i);
  });
  await type(address, '00100');
  await click(document.querySelector('.cb-address-form button'));
  check('an unrecognized address does not claim service coverage', () => assert.match(document.querySelector('.cb-address-result').textContent, /illustrative Nairobi areas|sample lookup/));
  await click(document.querySelectorAll('.cb-map-pin')[2]);
  check('sample map selection names an area without claiming merchant availability', () => {
    assert.match(document.querySelector('.cb-zone-feedback').textContent, /Kilimani/);
    assert.match(document.querySelector('.cb-zone-feedback').textContent, /No live businesses or availability/);
    assert.ok(document.querySelectorAll('.cb-map-pin')[2].classList.contains('is-selected'));
  });
  await click(document.querySelectorAll('.cb-category')[4]);
  check('sample category filters the illustrative dish carousel', () => {
    assert.equal(document.querySelectorAll('.cb-dish').length, 2);
    assert.match(document.querySelector('.cb-dish').textContent, /Brownie/);
    assert.match(document.querySelector('.cb-dish').textContent, /not a live merchant listing/);
  });
  await click(document.querySelector('.cb-dish-action button'));
  document.querySelector('.cb-cart-trigger').focus();
  await click(document.querySelector('.cb-cart-trigger'));
  check('sample lunch list cannot place an order, reserve pickup or check out', () => {
    assert.equal(document.querySelector('.cb-cart-head h2 span').textContent, '(1)');
    assert.match(document.querySelector('.cb-cart-foot').textContent, /KES 450/);
    assert.ok(document.querySelector('.cb-cart-foot button').disabled);
    assert.match(document.querySelector('.cb-cart-foot').textContent, /Checkout is not live/);
    assert.match(document.querySelector('.cb-cart-foot').textContent, /No order, payment, pickup slot or reservation is created/);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Close lunch list');
  });
  await act(async () => document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  check('dialog restores focus and workplace links land on existing Brief surfaces', () => {
    assert.equal(document.querySelector('.cb-cart-panel'), null);
    assert.equal(document.activeElement.getAttribute('aria-label'), 'Open lunch list, 1 item');
    assert.equal(document.querySelector('.cb-work-actions a').getAttribute('href'), '/#workforce');
    assert.equal(document.querySelectorAll('.cb-work-actions a')[1].getAttribute('href'), '/#city/errands');
  });
  const menuButton = document.querySelector('.cb-mobile-menu');
  await click(menuButton);
  check('mobile navigation exposes links without changing the public concept state', () => {
    assert.equal(menuButton.getAttribute('aria-expanded'), 'true');
    assert.ok(document.querySelector('.cb-nav').classList.contains('is-open'));
  });
  await click(menuButton);
  await act(async () => root.unmount());
  dom.window.close();
  console.log(`PASSED ${passed} FAILED 0`); process.exit(0);
})().catch(error => { console.error(error); process.exit(1); });
