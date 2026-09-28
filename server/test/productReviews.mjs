import './test-env.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.BRIEF_DEV_AUTH = '0';
process.env.BRIEF_REVIEWERS = 'review_moderator';
const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const spaces = await import('../src/domain/space.js');
const orders = await import('../src/domain/order.js');
const reviews = await import('../src/domain/productReviews.js');
const upload = await import('../src/domain/upload.js');
const { default: app } = await import('../src/index.js');
store._reset();
const user = (handle) =>
  auth.createUser({
    handle,
    displayName: handle.replace('review_', ''),
    password: 'review-testing-password'
  });
const seller = user('review_seller'),
  buyer = user('review_buyer'),
  other = user('review_other'),
  third = user('review_third'),
  mod = user('review_moderator');
const token = (u) => auth.issueSession(u.id).token;
const st = token(seller),
  bt = token(buyer),
  ot = token(other),
  mt = token(mod);
const space = spaces.createSpace({
  ownerId: seller.id,
  name: 'Basket Studio',
  type: 'business',
  visibility: 'public'
});
const listing = spaces.createSpaceOffer(space.id, {
  callerId: seller.id,
  title: 'Handwoven basket',
  price: 1800,
  type: 'product'
});
spaces.publishSpaceOffer(space.id, listing.id, { callerId: seller.id });
const hiddenSpace = spaces.createSpace({
  ownerId: seller.id,
  name: 'Private studio',
  type: 'business',
  visibility: 'private'
});
const hidden = spaces.createSpaceOffer(hiddenSpace.id, {
  callerId: seller.id,
  title: 'PRIVATE_PRODUCT',
  price: 50
});
spaces.publishSpaceOffer(hiddenSpace.id, hidden.id, { callerId: seller.id });
const order = orders.createOrder({ listingId: listing.id, buyerId: buyer.id });
// Isolated fixture only: never a payment provider or a production seed.
store.insert('ledgerTransactions', {
  id: 'txn_review_test_fixture',
  status: 'settled',
  amount: 1800,
  currency: 'KES',
  testFixture: true
});
store.update('orders', order.id, { transactionId: 'txn_review_test_fixture' });
store.insert('ledgerTransactions', {
  id: 'txn_review_pending_fixture',
  status: 'pending',
  amount: 1800,
  currency: 'KES',
  testFixture: true
});
const ledgerBefore = JSON.stringify(store.all('ledgerTransactions'));
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const mp4 = Buffer.alloc(32);
mp4.writeUInt32BE(24, 0);
mp4.write('ftyp', 4);
mp4.write('isom', 8);
const photo = upload.saveReviewUpload({
  bytes: png,
  ownerId: buyer.id,
  originalName: 'basket.png'
}).upload;
const video = upload.saveReviewUpload({
  bytes: mp4,
  ownerId: other.id,
  originalName: 'basket.mp4'
}).upload;
const input = (more = {}) => ({
  rating: 5,
  title: 'Good quality basket',
  body: 'The quality is excellent and it feels sturdy. It arrived quickly and is easy to use every day.',
  recommend: true,
  consent: true,
  categories: { quality: 5, value: 4 },
  pros: ['Sturdy'],
  cons: [],
  key: crypto.randomUUID(),
  ...more
});
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const call = async (path, method = 'GET', body, session) => {
  const r = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(session ? { authorization: `Bearer ${session}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const pub = `/api/public/product-reviews/${listing.id}`,
  priv = `/api/product-reviews/${listing.id}`;
let count = 0,
  first,
  second;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log('PASS ' + name);
};
try {
  await test('anonymous browse is public but empty ratings and recommendations stay null', async () => {
    const r = await call(pub);
    assert.equal(r.status, 200);
    assert.equal(r.body.summary.count, 0);
    assert.equal(r.body.summary.average, null);
    assert.equal(r.body.summary.recommendPercent, null);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal(r.body.capabilities.aiSummary, false);
  });
  await test('private spaces, unpublished listings and non-public enterprises are not discoverable', async () => {
    assert.equal(
      (await call(`/api/public/product-reviews/${hidden.id}`)).status,
      404
    );
    assert.equal(
      (await call(`/api/public/product-reviews/${hidden.id}/media`)).status,
      404
    );
    const catalog = await call('/api/public/product-reviews');
    assert.ok(!JSON.stringify(catalog.body).includes('PRIVATE_PRODUCT'));
    store.update('vendors', space.vendorId, {
      enterprise: { publication: 'private', operatingStatus: 'active' }
    });
    assert.equal((await call(pub)).status, 404);
    store.update('vendors', space.vendorId, { enterprise: null });
  });
  await test('anonymous writes and sellers reviewing their own product are refused', async () => {
    assert.equal((await call(`${priv}/submit`, 'POST', input())).status, 401);
    assert.equal(
      (await call(`${priv}/submit`, 'POST', input(), st)).status,
      403
    );
  });
  await test('validation enforces rating, minimum body, recommendation, consent and category bounds', async () => {
    for (const changes of [
      { rating: 0 },
      { rating: 6 },
      { rating: 2.4 },
      { rating: true },
      { rating: '5' },
      { categories: { quality: true } },
      { body: 'too short' },
      { title: 'a' },
      { recommend: null },
      { consent: false },
      { categories: { quality: 6 } }
    ])
      assert.throws(
        () => reviews.create(listing.id, third.id, input(changes)),
        (e) => e.status === 400
      );
    assert.equal(store.all('productReviews').length, 0);
  });
  await test('only owned review uploads attach; private evidence and foreign assets never become public', async () => {
    const privatePhoto = upload.saveUpload({
      bytes: png,
      ownerId: buyer.id,
      purpose: 'private_request'
    }).upload;
    assert.throws(
      () =>
        reviews.create(
          listing.id,
          buyer.id,
          input({ uploadIds: [privatePhoto.id] })
        ),
      (e) => e.status === 403
    );
    assert.throws(
      () =>
        reviews.create(listing.id, other.id, input({ uploadIds: [photo.id] })),
      (e) => e.status === 403
    );
    assert.equal((await call(`/api/media/file/${photo.id}`)).status, 404);
    assert.equal((await call(`/api/media/file/${video.id}`)).status, 404);
    assert.equal(
      upload.saveReviewUpload({
        bytes: Buffer.from('<svg>javascript fake</svg>'),
        ownerId: buyer.id
      }).ok,
      false
    );
    assert.equal(
      upload.saveUpload({ bytes: mp4, ownerId: buyer.id }).ok,
      false
    );
  });
  await test('a paid matching order earns verification, publication is idempotent and actor claims are ignored', async () => {
    const body = input({
      orderId: order.id,
      uploadIds: [photo.id],
      userId: seller.id,
      verifiedPurchase: true
    });
    const r = await call(`${priv}/submit`, 'POST', body, bt);
    assert.equal(r.status, 200);
    first = r.body.review;
    assert.equal(first.verifiedPurchase, true);
    assert.equal(first.isMine, true);
    assert.equal(first.name, 'buyer');
    assert.equal(
      store.find('productReviews', (r) => r.id === first.id).authorId,
      buyer.id
    );
    assert.equal(
      (await call(`${priv}/submit`, 'POST', body, bt)).body.review.id,
      first.id
    );
    assert.equal(store.all('productReviews').length, 1);
    assert.throws(
      () => reviews.create(listing.id, buyer.id, input()),
      (e) => e.status === 409
    );
  });
  await test('purchase proof follows the ledger, not cancellation or fulfilment labels', async () => {
    const before = store.find('orders', (o) => o.id === order.id).status;
    store.update('orders', order.id, { status: 'cancelled' });
    assert.equal(reviews.page(listing.id).reviews[0].verifiedPurchase, true);
    store.update('orders', order.id, { status: before });
    store.update('orders', order.id, {
      transactionId: 'txn_review_pending_fixture'
    });
    assert.equal(reviews.page(listing.id).reviews[0].verifiedPurchase, false);
    store.update('orders', order.id, {
      transactionId: 'txn_review_test_fixture'
    });
    assert.equal(reviews.page(listing.id).reviews[0].verifiedPurchase, true);
  });
  await test('foreign order references, unpaid fulfilment and forged badges cannot verify a review', async () => {
    assert.throws(
      () => reviews.create(listing.id, other.id, input({ orderId: order.id })),
      (e) => e.status === 403
    );
    const unpaid = orders.createOrder({
      listingId: listing.id,
      buyerId: other.id
    });
    store.update('orders', unpaid.id, {
      status: 'fulfilled',
      fulfilledAt: new Date().toISOString()
    });
    assert.throws(
      () => reviews.create(listing.id, other.id, input({ orderId: unpaid.id })),
      (e) => e.status === 403
    );
    second = reviews.create(
      listing.id,
      other.id,
      input({
        rating: 4,
        recommend: false,
        verifiedPurchase: true,
        anonymous: true,
        incentivized: true,
        size: 'Medium',
        color: 'Natural',
        uploadIds: [video.id],
        cons: ['Handle could be softer']
      })
    );
    assert.equal(second.verifiedPurchase, false);
    assert.equal(second.name, 'Anonymous');
    assert.equal(second.incentivized, true);
  });
  await test('summary, category ratings, recommendations and themes are derived from published reviews', async () => {
    reviews.create(
      listing.id,
      third.id,
      input({
        rating: 2,
        recommend: true,
        categories: { value: 2 },
        body: 'The quality was not what I expected, although the basket is still useful for light shopping.'
      })
    );
    const r = (await call(pub)).body;
    assert.equal(r.summary.count, 3);
    assert.equal(r.summary.average, 3.7);
    assert.equal(r.summary.recommendPercent, 67);
    assert.equal(r.summary.recommendCount, 3);
    assert.equal(
      r.summary.categories.find((c) => c.id === 'quality').average,
      5
    );
    assert.equal(r.summary.categories.find((c) => c.id === 'quality').count, 2);
    assert.equal(
      r.summary.categories.find((c) => c.id === 'value').average,
      3.3
    );
    assert.equal(r.highlights.themes.find((t) => t.id === 'quality').count, 3);
    assert.equal(r.highlights.pros.find((p) => p.text === 'sturdy').count, 3);
  });
  await test('public projection excludes account/order IDs and private order or media metadata', async () => {
    const response = (await call(pub)).body;
    const encoded = JSON.stringify(response);
    for (const secret of [
      buyer.id,
      other.id,
      seller.id,
      order.id,
      'txn_review_test_fixture',
      'originalName',
      'reporterId',
      'passwordHash',
      'orderId',
      'authorId'
    ])
      assert.ok(!encoded.includes(secret), secret);
    assert.equal(response.galleryTotal, 2);
    assert.equal(response.photoCount, 1);
    assert.equal(response.videoCount, 1);
  });
  await test('all filters combine, sorted pages have truthful totals, and share focus is listing-scoped', async () => {
    assert.equal((await call(pub + '?stars=4,5&verified=1')).body.total, 1);
    assert.equal((await call(pub + '?media=1')).body.total, 2);
    assert.equal(
      (await call(pub + '?size=Medium&color=Natural')).body.total,
      1
    );
    assert.equal((await call(pub + '?q=light%20shopping')).body.total, 1);
    assert.equal((await call(pub + '?sort=lowest')).body.reviews[0].rating, 2);
    assert.equal((await call(pub + '?sort=highest')).body.reviews[0].rating, 5);
    assert.equal(
      (await call(pub + '?sort=images')).body.reviews[0].id,
      first.id
    );
    assert.equal((await call(pub + '?theme=shipping')).body.total, 2);
    assert.equal(
      (await call(pub + '?review=' + first.id)).body.focus.id,
      first.id
    );
    assert.equal((await call(pub + '?review=foreign')).body.focus, null);
  });
  await test('helpful votes persist once per actor and support change/undo, with self/seller votes blocked', async () => {
    const path = `/api/product-reviews/${first.id}/vote`;
    assert.equal((await call(path, 'POST', { vote: 'yes' })).status, 401);
    assert.equal((await call(path, 'POST', { vote: 'yes' }, bt)).status, 403);
    assert.equal((await call(path, 'POST', { vote: 'no' }, st)).status, 403);
    await call(path, 'POST', { vote: 'yes' }, ot);
    await call(path, 'POST', { vote: 'yes' }, ot);
    assert.equal(store.all('productReviewVotes').length, 1);
    assert.equal((await call(pub)).body.featured[0].helpful, 1);
    await call(path, 'POST', { vote: 'no' }, ot);
    assert.equal(
      (await call(pub)).body.reviews.find((r) => r.id === first.id).notHelpful,
      1
    );
    await call(path, 'POST', { vote: null }, ot);
    assert.equal(store.all('productReviewVotes').length, 0);
  });
  await test('seller replies are authenticated, timestamped, and never set by a reviewer', async () => {
    const path = `/api/product-reviews/${first.id}/response`;
    assert.equal(
      (
        await call(
          path,
          'POST',
          { body: 'Thank you for sharing your feedback.' },
          ot
        )
      ).status,
      403
    );
    const r = await call(
      path,
      'POST',
      { body: 'Thank you for sharing your feedback.' },
      st
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.review.response.verifiedSeller, true);
    assert.equal(r.body.review.response.seller, 'Basket Studio');
    assert.ok(r.body.review.response.at);
  });
  await test('image/video bytes are readable only after publication, video ranges work and media are not cached', async () => {
    for (const media of [photo, video]) {
      const r = await fetch(
        `http://127.0.0.1:${server.address().port}/api/media/file/${media.id}`
      );
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('cache-control'), 'private, no-store');
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
    }
    const r = await fetch(
      `http://127.0.0.1:${server.address().port}/api/media/file/${video.id}`,
      { headers: { Range: 'bytes=0-7' } }
    );
    assert.equal(r.status, 206);
    assert.equal((await r.arrayBuffer()).byteLength, 8);
  });
  await test('reports persist privately, deduplicate, and only moderators can act', async () => {
    const path = `/api/product-reviews/${first.id}/report`;
    await call(
      path,
      'POST',
      {
        reason: 'privacy',
        note: 'The review may include personal information.'
      },
      ot
    );
    await call(
      path,
      'POST',
      {
        reason: 'privacy',
        note: 'The review may include personal information.'
      },
      ot
    );
    assert.equal(store.all('productReviewReports').length, 1);
    assert.equal((await call('/api/product-reviews/moderation')).status, 401);
    assert.equal(
      (await call('/api/product-reviews/moderation', 'GET', null, st)).status,
      403
    );
    const r = await call('/api/product-reviews/moderation', 'GET', null, mt);
    assert.equal(r.status, 200);
    assert.ok(!JSON.stringify(r.body).includes(other.id));
    assert.equal(
      (
        await call(
          `/api/product-reviews/${first.id}/moderate`,
          'POST',
          { action: 'hide', reason: 'Privacy concern confirmed.' },
          st
        )
      ).status,
      403
    );
  });
  await test('moderation excludes review/media from aggregates, gallery, focus and bytes and records an audit', async () => {
    const path = `/api/product-reviews/${first.id}/moderate`;
    assert.equal(
      (
        await call(
          path,
          'POST',
          { action: 'hide', reason: 'Privacy concern confirmed.' },
          mt
        )
      ).status,
      200
    );
    const r = (await call(pub + '?review=' + first.id)).body;
    assert.equal(r.summary.count, 2);
    assert.equal(r.focus, null);
    assert.equal(r.photoCount, 0);
    assert.equal((await call(`/api/media/file/${photo.id}`)).status, 404);
    assert.ok(
      store.find(
        'auditLog',
        (a) => a.action === 'product_review.hide' && a.objectId === first.id
      )
    );
    await call(
      path,
      'POST',
      {
        action: 'restore',
        reason: 'Author confirmed no personal information is present.'
      },
      mt
    );
    assert.equal((await call(pub)).body.summary.count, 3);
  });
  await test('publication privacy also gates already-published media and search', async () => {
    store.update('spaces', space.id, { visibility: 'private' });
    assert.equal((await call(pub)).status, 404);
    assert.equal((await call(`/api/media/file/${photo.id}`)).status, 404);
    store.update('spaces', space.id, { visibility: 'public' });
  });
  await test('context exposes only this buyer’s settled order references', async () => {
    const a = await call(`${priv}/context`, 'GET', null, bt),
      b = await call(`${priv}/context`, 'GET', null, ot);
    assert.equal(a.body.orders.length, 1);
    assert.equal(a.body.orders[0].id, order.id);
    assert.equal(b.body.orders.length, 0);
    assert.equal(a.body.canModerate, false);
    assert.equal(a.body.myReview.id, first.id);
  });
  await test('ten-per-page pagination and related co-review claims follow real rows', async () => {
    for (let i = 0; i < 11; i++) {
      const u = user('review_extra_' + i);
      reviews.create(listing.id, u.id, input({ rating: 3 }));
    }
    const p = (await call(pub + '?page=2')).body;
    assert.equal(p.pageSize, 10);
    assert.equal(p.from, 11);
    assert.equal(p.to, 14);
    assert.equal(p.reviews.length, 4);
    assert.equal((await call(pub + '?page=999')).body.page, 2);
    const otherListing = spaces.createSpaceOffer(space.id, {
      callerId: seller.id,
      title: 'Related basket',
      price: 1900,
      type: 'product'
    });
    spaces.publishSpaceOffer(space.id, otherListing.id, {
      callerId: seller.id
    });
    reviews.create(otherListing.id, buyer.id, input());
    const r = (await call(pub)).body;
    assert.equal(r.relatedLabel, 'Customers also reviewed');
    assert.equal(r.related[0].id, otherListing.id);
  });
  await test('withdrawal is author-only, removes public media, and does not move any money', async () => {
    assert.equal(
      (await call(`/api/product-reviews/${first.id}`, 'DELETE', null, ot))
        .status,
      404
    );
    assert.equal(
      (await call(`/api/product-reviews/${first.id}`, 'DELETE', null, bt))
        .status,
      200
    );
    assert.equal((await call(`/api/media/file/${photo.id}`)).status, 404);
    assert.equal(JSON.stringify(store.all('ledgerTransactions')), ledgerBefore);
  });
  await test('a moderated author cannot evade a removal by withdrawing and re-posting', async () => {
    reviews.moderate(second.id, mod.id, {
      action: 'hide',
      reason: 'Confirmed guideline violation requires moderation.'
    });
    reviews.withdraw(second.id, other.id);
    assert.throws(
      () => reviews.create(listing.id, other.id, input()),
      (e) => e.status === 409
    );
    assert.throws(
      () =>
        reviews.moderate(second.id, mod.id, {
          action: 'restore',
          reason: 'This review has already been withdrawn by its author.'
        }),
      (e) => e.status === 409
    );
  });
  await test('report spam is rate-limited without creating duplicate reports', async () => {
    const target = reviews.page(listing.id).reviews[0].id;
    let result;
    for (let i = 0; i < 17; i++)
      result = await call(
        `/api/product-reviews/${target}/report`,
        'POST',
        {
          reason: 'spam',
          note: 'A repeated report must not create duplicate records.'
        },
        bt
      );
    assert.equal(result.status, 429);
    assert.ok(Number(result.headers.get('retry-after')) > 0);
    assert.equal(
      store.filter(
        'productReviewReports',
        (r) => r.reviewId === target && r.reporterId === buyer.id
      ).length,
      1
    );
  });
  await test('commerce feature gates cover the new public routes', async () => {
    process.env.BRIEF_DISABLED_FEATURES = 'commerce';
    assert.equal((await call(pub)).status, 503);
    delete process.env.BRIEF_DISABLED_FEATURES;
  });
  console.log(`\n${count} product review checks passed`);
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
