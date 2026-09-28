// Presentation contracts only; the real purchase proof and access guards are
// tested against the server separately. No test reviews enter the live store.
const assert = require('assert').strict;
const { JSDOM } = require('jsdom');
const dom = new JSDOM(
  '<!doctype html><html><body><div id="root"></div></body></html>',
  { url: 'https://wairo.test/reviews/list_1', pretendToBeVisual: true }
);
global.window = dom.window;
global.document = dom.window.document;
global.HTMLElement = dom.window.HTMLElement;
global.Node = dom.window.Node;
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
});
global.IS_REACT_ACT_ENVIRONMENT = true;
const React = require('react'),
  { act } = React,
  { createRoot } = require('react-dom/client');
const { ReviewCard } = require('./src/features/reviews/ReviewCard.tsx');
const { Stars } = require('./src/features/reviews/shared.tsx');
const root = createRoot(document.getElementById('root'));
let count = 0;
const fixture = {
  id: 'rev_fixture',
  rating: 4,
  title: 'Review title',
  body: 'An honest long review. '.repeat(30) + 'The final detail.',
  createdAt: '2026-09-28T08:00:00Z',
  name: 'Anonymous',
  verifiedPurchase: true,
  incentivized: true,
  recommend: true,
  categories: {},
  pros: [],
  cons: [],
  size: 'M',
  color: 'Natural',
  variantSource: 'reviewer-stated',
  media: [],
  helpful: 7,
  notHelpful: 2,
  myVote: null,
  isMine: false,
  canRespond: false,
  canVote: false,
  response: {
    body: 'Thank you for the feedback.',
    at: '2026-09-28T09:00:00Z',
    seller: 'Basket Studio',
    verifiedSeller: true
  }
};
async function test(name, fn) {
  await fn();
  count++;
  console.log('PASS ' + name);
}
(async () => {
  const render = async (over) => {
    await act(async () =>
      root.render(
        <ReviewCard
          key={JSON.stringify(over)}
          review={{ ...fixture, ...over }}
          listingId="list_1"
          onRefresh={() => {}}
          onAuth={() => {}}
          onMedia={() => {}}
        />
      )
    );
  };
  await test('verified purchase and official seller badges are distinct and present', async () => {
    await render({});
    assert.equal(document.querySelectorAll('.rv-verified').length, 2);
    assert.match(document.body.textContent, /Verified purchase/);
    assert.match(document.body.textContent, /Verified seller/);
  });
  await test('unverified reviews never acquire a purchase badge from a seller response', async () => {
    await render({ verifiedPurchase: false });
    assert.equal(
      document.querySelectorAll('.rv-review-person .rv-verified').length,
      0
    );
    assert.match(document.body.textContent, /Purchase not verified/);
  });
  await test('anonymous, incentive and reviewer-stated variant disclosures remain visible', async () => {
    await render({});
    assert.match(document.body.textContent, /Anonymous/);
    assert.match(document.body.textContent, /Incentivized review/);
    assert.match(document.body.textContent, /Reviewer-stated details/);
  });
  await test('long review text expands and collapses with accurate aria state', async () => {
    await render({});
    assert.ok(
      !document
        .querySelector('.rv-review-body')
        .textContent.includes('The final detail.')
    );
    const button = document.querySelector('.rv-read-more');
    await act(async () => button.click());
    assert.equal(button.getAttribute('aria-expanded'), 'true');
    assert.match(
      document.querySelector('.rv-review-body').textContent,
      /The final detail/
    );
    await act(async () => button.click());
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  });
  await test('authors and the seller cannot manipulate helpfulness via the UI', async () => {
    for (const over of [{ isMine: true }, { canRespond: true }]) {
      await render(over);
      assert.ok(
        [...document.querySelectorAll('.rv-votes button')].every(
          (b) => b.disabled
        )
      );
    }
  });
  await test('averages retain fractional star fill and an accessible numeric label', async () => {
    await act(async () => root.render(<Stars value={4.7} />));
    assert.equal(
      document.querySelector('.rv-stars').getAttribute('aria-label'),
      '4.7 out of 5 stars'
    );
    assert.ok(
      Math.abs(
        parseFloat(
          document.querySelectorAll('.rv-star-part>span')[4].style.width
        ) - 70
      ) < 0.001
    );
  });
  await act(async () => root.unmount());
  console.log(`PASSED ${count} FAILED 0`);
})()
  .then(() => {
    dom.window.close();
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
