import './test-env.mjs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
process.env.BRIEF_DEV_AUTH = '0';
const { store } = await import('../src/store.js');
const auth = await import('../src/domain/auth.js');
const spaces = await import('../src/domain/space.js');
const orders = await import('../src/domain/order.js');
const tracking = await import('../src/domain/orderTracking.js');
const { default: app } = await import('../src/index.js');
store._reset();
const seller = auth.createUser({
  handle: 'tracking_seller',
  password: 'tracking-password'
});
const buyer = auth.createUser({
  handle: 'tracking_buyer',
  password: 'tracking-password'
});
const other = auth.createUser({
  handle: 'tracking_other',
  password: 'tracking-password'
});
store.update('users', buyer.id, { email: 'buyer@example.test' });
const sellerToken = auth.issueSession(seller.id).token,
  buyerToken = auth.issueSession(buyer.id).token,
  otherToken = auth.issueSession(other.id).token;
const space = spaces.createSpace({
  ownerId: seller.id,
  name: 'Nairobi Goods',
  type: 'business'
});
const listing = spaces.createSpaceOffer(space.id, {
  title: 'Handwoven basket',
  price: 1200,
  type: 'product',
  images: ['/api/media/file/test-basket'],
  callerId: seller.id
});
spaces.publishSpaceOffer(space.id, listing.id, { callerId: seller.id });
const order = orders.createOrder({
  listingId: listing.id,
  buyerId: buyer.id,
  quantity: 3,
  note: 'INTERNAL_ORDER_NOTE',
  delivery: { address: 'Kilimani, Nairobi', instructions: 'Call at the gate' }
});
orders.transitionOrder(order.id, 'accepted');
const makeDispatch = (overrides = {}) =>
  spaces.createSpaceDispatch({
    spaceId: space.id,
    orderId: order.id,
    destinationCounty: 'Nakuru',
    destinationTown: 'Nakuru Town Stage',
    carrierSacco: '2NK SACCO',
    waybillRef: '2NK-REAL-REFERENCE',
    receiverName: 'PRIVATE_RECEIVER',
    receiverPhone: '+254700999111',
    notes: 'INTERNAL_DRIVER_NOTE',
    callerId: seller.id,
    ...overrides
  });
const beforeLedger = JSON.stringify(store.all('ledgerTransactions'));
const first = makeDispatch({
  quantity: 1,
  estimatedDelivery: '2026-09-30T12:00:00+03:00'
});
const second = makeDispatch({
  quantity: 2,
  deliveryMode: 'door',
  waybillRef: 'RIDER-SECOND'
});
const server = await new Promise((resolve) => {
  const s = app.listen(0, '127.0.0.1', () => resolve(s));
});
const call = async (path, body, session, method = 'POST') => {
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
const publicPath = '/api/public/order-tracking';
let token,
  count = 0;
const test = async (name, fn) => {
  await fn();
  count++;
  console.log('PASS ' + name);
};
try {
  await test('anonymous lookup accepts both matching keys, normalizes email, never requires login', async () => {
    const r = await call(`${publicPath}/lookup`, {
      orderNumber: order.id,
      email: ' BUYER@EXAMPLE.TEST '
    });
    assert.equal(r.status, 200);
    token = r.body.token;
    assert.equal(r.body.tracking.orderNumber, order.id);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.match(order.id, /^ord_[a-f0-9]{32}$/);
    assert.equal(r.body.canManage, false);
    assert.equal(r.body.canRespond, false);
  });
  await test('unknown references, missing credentials and wrong email produce the same refusal', async () => {
    const cases = [
      { orderNumber: order.id, email: 'wrong@example.test' },
      { orderNumber: 'ord_missing', email: 'buyer@example.test' },
      { orderNumber: order.id },
      { email: 'buyer@example.test' },
      {}
    ];
    for (const input of cases) {
      const r = await call(`${publicPath}/lookup`, input);
      assert.equal(r.status, 404);
      assert.equal(
        r.body.error,
        'No matching order. Check the order number and tracking email.'
      );
    }
  });
  await test('public projection omits private identity, payment, raw notes, other buyers and email proof', async () => {
    const r = await call(`${publicPath}/read`, { token });
    assert.equal(r.status, 200);
    const text = JSON.stringify(r.body);
    for (const value of [
      buyer.id,
      seller.id,
      'INTERNAL_ORDER_NOTE',
      'INTERNAL_DRIVER_NOTE',
      'PRIVATE_RECEIVER',
      '+254700999111',
      'trackingEmailHash',
      'transactionId',
      'idempotencyKey',
      'passwordHash',
      'buyer@example.test'
    ])
      assert.ok(!text.includes(value), value);
    assert.equal(r.body.tracking.deliveryAddress, 'Kilimani, Nairobi');
    assert.equal(r.body.tracking.items[0].image, '/api/media/file/test-basket');
    assert.equal(r.body.tracking.items[0].quantity, 3);
    assert.equal(r.headers.get('cache-control'), 'no-store');
  });
  await test('ordinary order APIs remain private; account tracking is party-only', async () => {
    assert.equal(
      (await call(`/api/orders/${order.id}`, null, null, 'GET')).status,
      401
    );
    assert.equal(
      (await call(`/api/orders/${order.id}/tracking`, null, otherToken, 'GET'))
        .status,
      404
    );
    assert.equal(
      (await call(`/api/orders/${order.id}/tracking`, null, buyerToken, 'GET'))
        .body.canManage,
      true
    );
    assert.equal(
      (await call(`/api/orders/${order.id}/tracking`, null, sellerToken, 'GET'))
        .body.canRespond,
      true
    );
  });
  await test('split shipments retain independent stages, dates, quantities and carrier references', async () => {
    const view = tracking.project(
      store.find('orders', (o) => o.id === order.id)
    );
    assert.equal(view.split, true);
    assert.equal(view.shipments.length, 2);
    const a = view.shipments.find((s) => s.id === first.id),
      b = view.shipments.find((s) => s.id === second.id);
    assert.equal(a.quantity, 1);
    assert.equal(b.quantity, 2);
    assert.equal(a.estimatedDelivery, '2026-09-30T09:00:00.000Z');
    assert.equal(b.estimatedDelivery, null);
    assert.ok(a.timeline.some((s) => s.id === 'ready_at_stage'));
    assert.ok(b.timeline.some((s) => s.id === 'out_for_delivery'));
    assert.equal(b.trackingNumber, 'RIDER-SECOND');
  });
  await test('dispatch is not fulfilment or payment, and does not write to the ledger', async () => {
    assert.equal(
      store.find('orders', (o) => o.id === order.id).status,
      'accepted'
    );
    assert.equal(JSON.stringify(store.all('ledgerTransactions')), beforeLedger);
    store.update('orders', order.id, { status: 'fulfilled' });
    const view = tracking.project(
      store.find('orders', (o) => o.id === order.id)
    );
    assert.ok(view.shipments.every((s) => s.status === 'in_transit'));
    assert.ok(view.shipments.every((s) => !s.timeline.at(-1).completed));
    store.update('orders', order.id, { status: 'accepted' });
  });
  await test('seller-recorded scans persist, show latest location, and missing steps are never synthesized', async () => {
    const a = spaces.updateDispatchStatus({
      spaceId: space.id,
      dispatchId: first.id,
      status: 'in_transit',
      location: 'Naivasha',
      callerId: seller.id
    });
    assert.equal(a.history.at(-1).location, 'Naivasha');
    spaces.updateDispatchStatus({
      spaceId: space.id,
      dispatchId: first.id,
      status: 'ready_at_stage',
      location: 'Nakuru KFA stage',
      callerId: seller.id
    });
    const view = tracking.project(
      store.find('orders', (o) => o.id === order.id)
    );
    const aView = view.shipments.find((s) => s.id === first.id),
      bView = view.shipments.find((s) => s.id === second.id);
    assert.equal(aView.lastLocation, 'Nakuru KFA stage');
    assert.equal(aView.status, 'ready_at_stage');
    assert.equal(bView.status, 'in_transit');
    assert.equal(aView.timeline.find((s) => s.id === 'collected').at, null);
    assert.deepEqual(
      aView.events.map((e) => e.at),
      aView.events.map((e) => e.at).sort((a, b) => b.localeCompare(a))
    );
  });
  await test('dispatch endpoints prevent cross-owner disclosure, linking, status changes and excess quantities', async () => {
    assert.equal(
      (
        await call(
          `/api/spaces/${space.id}/dispatches`,
          null,
          otherToken,
          'GET'
        )
      ).status,
      404
    );
    assert.equal(
      (
        await call(
          `/api/spaces/${space.id}/dispatches`,
          null,
          sellerToken,
          'GET'
        )
      ).status,
      200
    );
    assert.throws(() => makeDispatch({ quantity: 1 }), /exceed/);
    const alien = spaces.createSpace({
      ownerId: other.id,
      name: 'Other shop',
      type: 'business'
    });
    assert.throws(
      () => makeDispatch({ spaceId: alien.id, callerId: other.id }),
      /belong/
    );
    const sameOwnerSpace = spaces.createSpace({
      ownerId: seller.id,
      name: 'Other branch',
      type: 'business'
    });
    assert.throws(() => makeDispatch({ spaceId: sameOwnerSpace.id }), /belong/);
    assert.throws(
      () =>
        spaces.updateDispatchStatus({
          spaceId: space.id,
          dispatchId: first.id,
          status: 'delivered',
          callerId: seller.id
        }),
      /Invalid/
    );
    assert.throws(
      () =>
        spaces.updateDispatchStatus({
          spaceId: space.id,
          dispatchId: first.id,
          status: 'staged',
          callerId: seller.id
        }),
      /backwards/
    );
    assert.throws(
      () =>
        spaces.updateDispatchStatus({
          spaceId: space.id,
          dispatchId: first.id,
          status: 'collected',
          callerId: other.id
        }),
      /authorized/
    );
    assert.throws(() => makeDispatch({ orderId: 'ord_nonexistent' }), /belong/);
  });
  await test('guest preference request is scoped, durable and idempotent, not an accepted carrier instruction', async () => {
    const body = {
      token,
      kind: 'hold',
      message: 'Please hold at KFA until Friday.',
      shipmentId: first.id,
      key: 'hold-1'
    };
    const r = await call(`${publicPath}/requests`, body);
    assert.equal(r.status, 200);
    assert.equal(r.body.tracking.requests[0].status, 'requested');
    await call(`${publicPath}/requests`, body);
    assert.equal(
      store.find('orders', (o) => o.id === order.id).trackingRequests.length,
      1
    );
    assert.equal(
      (
        await call(`${publicPath}/requests`, {
          ...body,
          shipmentId: second.id + 'bad',
          key: 'bad'
        })
      ).status,
      404
    );
    assert.equal(
      (
        await call(`${publicPath}/requests`, {
          ...body,
          shipmentId: null,
          key: 'none'
        })
      ).status,
      400
    );
    assert.equal(JSON.stringify(store.all('ledgerTransactions')), beforeLedger);
  });
  await test('seller can acknowledge requests; another member and buyer cannot', async () => {
    const id = store.find('orders', (o) => o.id === order.id)
      .trackingRequests[0].id;
    const path = `/api/orders/${order.id}/tracking-requests/${id}`;
    assert.equal(
      (await call(path, { status: 'acknowledged' }, otherToken)).status,
      404
    );
    assert.equal(
      (await call(path, { status: 'acknowledged' }, buyerToken)).status,
      404
    );
    assert.equal(
      (await call(path, { status: 'acknowledged' }, sellerToken)).status,
      200
    );
    assert.equal(
      (await call(`${publicPath}/read`, { token })).body.tracking.requests[0]
        .status,
      'acknowledged'
    );
  });
  await test('completed and cancelled shipments refuse preference writes but allow support', async () => {
    spaces.updateDispatchStatus({
      spaceId: space.id,
      dispatchId: first.id,
      status: 'collected',
      callerId: seller.id
    });
    const body = {
      token,
      kind: 'neighbor',
      message: 'Leave with my neighbor',
      shipmentId: first.id,
      key: 'closed'
    };
    assert.equal((await call(`${publicPath}/requests`, body)).status, 409);
    assert.equal(
      (
        await call(`${publicPath}/requests`, {
          ...body,
          kind: 'wrong_item',
          key: 'issue'
        })
      ).status,
      200
    );
    assert.throws(
      () =>
        spaces.updateDispatchStatus({
          spaceId: space.id,
          dispatchId: first.id,
          status: 'in_transit',
          callerId: seller.id
        }),
      /backwards/
    );
  });
  await test('new buyer without email can set up tracking; ownership and pre-dispatch gate enforced', async () => {
    const passwordOrder = orders.createOrder({
      listingId: listing.id,
      buyerId: other.id
    });
    assert.equal(
      tracking.project(store.find('orders', (o) => o.id === passwordOrder.id))
        .trackingEmailConfigured,
      false
    );
    const path = `/api/orders/${passwordOrder.id}/delivery-details`;
    assert.equal(
      (await call(path, { email: 'guest@example.test' }, buyerToken, 'PUT'))
        .status,
      404
    );
    assert.equal(
      (await call(path, { email: 'bad' }, otherToken, 'PUT')).status,
      400
    );
    const r = await call(
      path,
      {
        email: 'guest@example.test',
        address: 'Kisumu',
        instructions: 'Gate B'
      },
      otherToken,
      'PUT'
    );
    assert.equal(r.status, 200);
    assert.equal(
      tracking.lookup(passwordOrder.id, 'guest@example.test').tracking
        .deliveryInstructions,
      'Gate B'
    );
    assert.equal(
      (
        await call(
          `/api/orders/${order.id}/delivery-details`,
          { email: 'new@example.test' },
          buyerToken,
          'PUT'
        )
      ).status,
      409
    );
    const token = r.body.token;
    tracking.setDeliveryDetails(passwordOrder.id, other.id, {
      email: 'updated@example.test'
    });
    assert.throws(
      () => tracking.readToken(token),
      (e) => e.status === 410
    );
  });
  await test('invalid and expired signed tokens fail closed; secrets cannot be swapped between orders', async () => {
    for (const value of ['', token + 'x', 'junk', null])
      assert.equal(
        (await call(`${publicPath}/read`, { token: value })).status,
        410
      );
    const [payload] = token.split('.');
    const claim = JSON.parse(Buffer.from(payload, 'base64url'));
    claim.expiresAt = Date.now() - 1000;
    const oldPayload = Buffer.from(JSON.stringify(claim)).toString('base64url');
    const key = store.find(
      'appSecrets',
      (s) => s.name === 'order_tracking'
    ).value;
    const expired =
      oldPayload +
      '.' +
      crypto.createHmac('sha256', key).update(oldPayload).digest('hex');
    assert.equal(
      (await call(`${publicPath}/read`, { token: expired })).status,
      410
    );
  });
  await test('email snapshots do not silently change when the account email changes', async () => {
    store.update('users', buyer.id, { email: 'changed@example.test' });
    assert.equal(
      tracking.lookup(order.id, 'buyer@example.test').tracking.orderNumber,
      order.id
    );
    assert.throws(
      () => tracking.lookup(order.id, 'changed@example.test'),
      (e) => e.status === 404
    );
  });
  await test('legacy missing history produces no fabricated dates or delivery proof', async () => {
    const row = store.find('spaceDispatches', (d) => d.id === second.id);
    store.update('spaceDispatches', second.id, {
      history: undefined,
      status: 'delivered'
    });
    const view = tracking.project(
      store.find('orders', (o) => o.id === order.id)
    );
    const shipment = view.shipments.find((s) => s.id === second.id);
    assert.equal(
      shipment.timeline.find((s) => s.id === 'out_for_delivery').completed,
      false
    );
    assert.equal(
      shipment.timeline.find((s) => s.id === 'out_for_delivery').at,
      null
    );
    assert.equal(shipment.status, 'delivered');
    store.update('spaceDispatches', second.id, { history: row.history });
  });
  await test('unshipped stages and preparation remain current without false shipping milestones', async () => {
    const pending = orders.createOrder({
      listingId: listing.id,
      buyerId: buyer.id
    });
    orders.transitionOrder(pending.id, 'accepted');
    orders.transitionOrder(pending.id, 'preparing');
    const preparing = tracking.project(
      store.find('orders', (o) => o.id === pending.id)
    );
    assert.equal(
      preparing.shipments[0].timeline.find((s) => s.id === 'preparing').current,
      true
    );
    const staged = makeDispatch({ orderId: pending.id });
    store.update('spaceDispatches', staged.id, {
      status: 'staged',
      history: [{ status: 'staged', at: staged.createdAt }]
    });
    const view = tracking.project(
      store.find('orders', (o) => o.id === pending.id)
    );
    assert.equal(
      view.shipments[0].timeline.find((s) => s.id === 'staged').current,
      true
    );
    assert.equal(
      view.shipments[0].timeline.find((s) => s.id === 'shipped').completed,
      false
    );
  });
  await test('invalid checkout email fails before consuming stock or writing an order', async () => {
    const before = store.all('orders').length;
    assert.throws(
      () =>
        orders.createOrder({
          listingId: listing.id,
          buyerId: buyer.id,
          delivery: { email: 'not-an-email' }
        }),
      /valid tracking email/
    );
    assert.equal(store.all('orders').length, before);
    assert.equal(JSON.stringify(store.all('ledgerTransactions')), beforeLedger);
  });
  await test('lookup abuse is rate-limited and feature gates cover public tracking', async () => {
    let r;
    for (let i = 0; i < 22; i++)
      r = await call(`${publicPath}/lookup`, {
        orderNumber: 'missing',
        email: 'bad@example.test'
      });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
    process.env.BRIEF_DISABLED_FEATURES = 'commerce';
    assert.equal((await call(`${publicPath}/read`, { token })).status, 503);
    delete process.env.BRIEF_DISABLED_FEATURES;
  });
  console.log(`\n${count} order tracking checks passed`);
} finally {
  server.closeAllConnections?.();
  await new Promise((resolve) => server.close(resolve));
}
