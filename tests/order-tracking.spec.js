import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block' });
const h = (u) => ({ authorization: `Bearer ${u.token}` });
async function setup(page, info, split = true) {
  const suffix = `${Date.now().toString(36)}_${info.project.name}`;
  const register = async (role) => {
    const r = await page.request.post('/ingest/api/auth/register', {
      data: {
        handle: `track_${role}_${suffix}`,
        password: 'tracking-test-password'
      }
    });
    expect(r.status()).toBe(201);
    return r.json();
  };
  const seller = await register('seller'),
    buyer = await register('buyer');
  const sr = await page.request.post('/ingest/api/spaces', {
    headers: h(seller),
    data: {
      name: 'Nairobi Basket Studio',
      type: 'business',
      initialOffer: {
        title: 'Handwoven market basket',
        price: 1800,
        type: 'product'
      }
    }
  });
  expect(sr.status()).toBe(201);
  const { space } = await sr.json();
  const publish = await page.request.post(
    `/ingest/api/spaces/${space.id}/offers/${space.initialOfferId}/publish`,
    { headers: h(seller) }
  );
  expect(publish.status()).toBe(200);
  const or = await page.request.post('/ingest/api/orders', {
    headers: h(buyer),
    data: {
      listingId: space.initialOfferId,
      quantity: 2,
      delivery: {
        email: 'customer@example.test',
        address: 'Kilimani, Nairobi',
        instructions: 'Call when you arrive.'
      }
    }
  });
  expect(or.status()).toBe(201);
  const { order } = await or.json();
  const accept = await page.request.post(
    `/ingest/api/orders/${order.id}/stage`,
    { headers: h(seller), data: { stage: 'accepted' } }
  );
  expect(accept.status()).toBe(200);
  const dispatches = [];
  if (split)
    for (const mode of ['stage', 'door']) {
      const r = await page.request.post(
        `/ingest/api/spaces/${space.id}/dispatches`,
        {
          headers: h(seller),
          data: {
            orderId: order.id,
            deliveryMode: mode,
            destinationCounty: 'Nakuru',
            destinationTown: 'Nakuru KFA Stage',
            carrierSacco: mode === 'stage' ? '2NK SACCO' : 'Local rider',
            waybillRef: mode === 'stage' ? '2NK-4831' : 'RIDER-4832',
            quantity: 1,
            receiverName: 'Customer',
            receiverPhone: '+254700000001',
            conductorContact: '+254711000002',
            estimatedDelivery: '2026-09-30T15:00:00+03:00'
          }
        }
      );
      expect(r.status()).toBe(201);
      dispatches.push((await r.json()).dispatch);
    }
  return { order, space, buyer, seller, dispatches };
}
async function lookup(page, order) {
  await page.goto(`/track?order=${encodeURIComponent(order.id)}`);
  await page
    .getByLabel('Email address', { exact: true })
    .fill('customer@example.test');
  await page.getByRole('button', { name: 'Track order', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Order tracking', exact: true })
  ).toBeVisible();
}

test('anonymous landing is independent, keyboard usable, responsive, and has actionable errors', async ({
  page
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/track');
  await expect(
    page.getByRole('heading', { name: 'Track your order', exact: true })
  ).toBeVisible();
  await expect(page.getByTestId('brand-intro')).toHaveCount(0);
  await page.getByLabel('Order number', { exact: true }).fill('ord_missing');
  await page
    .getByLabel('Email address', { exact: true })
    .fill('wrong@example.test');
  await page.getByLabel('Email address', { exact: true }).press('Enter');
  await expect(page.getByRole('alert')).toContainText('No matching order');
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  await page
    .getByText('Where do I find my order number and email?', { exact: true })
    .click();
  await expect(page.locator('.track-faq details').first()).toHaveAttribute(
    'open',
    ''
  );
  expect(errors).toEqual([]);
});

test('real guest lookup, split switching, recorded history, delivery requests and seller acknowledgment', async ({
  page
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const f = await setup(page, info);
  await lookup(page, f.order);
  await expect(
    page.getByRole('heading', { name: 'In transit', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Your package is on its way!', { exact: true }).first()
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: /Shipment 1 of 2/ })
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.track-carrier')).toContainText('2NK-4831');
  await expect(
    page.locator('.track-timeline li[aria-current="step"]')
  ).toContainText('In transit');
  await expect(page.locator('.track-timeline li').last()).not.toHaveClass(
    /complete/
  );
  await page
    .getByText('View complete tracking history', { exact: true })
    .click();
  await expect(page.locator('.track-history[open]')).toContainText(
    'Order placed'
  );
  await page.getByRole('button', { name: /Shipment 2 of 2/ }).click();
  await expect(page.locator('.track-carrier')).toContainText('RIDER-4832');
  await expect(page.locator('.track-timeline')).toContainText(
    'Out for delivery'
  );
  await expect(page.getByText('Qty 1 in this shipment')).toBeVisible();
  await page
    .getByRole('button', { name: 'Leave with neighbor', exact: true })
    .click();
  await page
    .getByLabel('Details for the seller')
    .fill('Please leave with Amina at the next door, with her permission.');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Request sent' })
  ).toBeVisible();
  await expect(page.locator('.track-requests')).toContainText(
    'Awaiting seller'
  );
  const orderResponse = await page.request.get(
    `/ingest/api/orders/${f.order.id}`,
    { headers: h(f.seller) }
  );
  const saved = (await orderResponse.json()).order.trackingRequests[0];
  expect(saved.shipmentId).toBe(f.dispatches[1].id);
  expect(
    (
      await page.request.post(
        `/ingest/api/orders/${f.order.id}/tracking-requests/${saved.id}`,
        { headers: h(f.seller), data: { status: 'acknowledged' } }
      )
    ).status()
  ).toBe(200);
  await page
    .getByRole('button', { name: 'Refresh tracking', exact: true })
    .click();
  await expect(page.locator('.track-requests')).toContainText(
    'Seller acknowledged'
  );
  await expect(
    page.getByRole('switch', { name: /SMS updates/ })
  ).toBeDisabled();
  await expect(
    page.getByRole('switch', { name: /Email updates/ })
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  const storage = await page.evaluate(() =>
    JSON.stringify({ ...localStorage, ...sessionStorage })
  );
  expect(storage).not.toContain('customer@example.test');
  expect(storage).not.toContain(saved.message);
  await page.screenshot({
    path: `.cache/tracking-results-${info.project.name}.png`,
    fullPage: true
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Track your order', exact: true })
  ).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toHaveValue(
    ''
  );
  expect(errors).toEqual([]);
});

test('actual carrier update reaches polling and completed shipment blocks delivery changes', async ({
  page
}, info) => {
  const f = await setup(page, info);
  await page.clock.install();
  await lookup(page, f.order);
  const r = await page.request.patch(
    `/ingest/api/spaces/${f.space.id}/dispatches/${f.dispatches[0].id}`,
    {
      headers: h(f.seller),
      data: { status: 'ready_at_stage', location: 'Nakuru KFA Stage' }
    }
  );
  expect(r.status()).toBe(200);
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole('heading', {
      name: 'Ready at destination stage',
      exact: true
    })
  ).toBeVisible();
  await expect(page.locator('.track-delivery')).toContainText(
    'Last reported location'
  );
  const c = await page.request.patch(
    `/ingest/api/spaces/${f.space.id}/dispatches/${f.dispatches[0].id}`,
    { headers: h(f.seller), data: { status: 'collected' } }
  );
  expect(c.status()).toBe(200);
  await page.clock.fastForward(31000);
  await expect(
    page.getByRole('heading', { name: 'Collected', exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Leave with neighbor', exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Wrong item delivered?', exact: true })
    .click();
  await page
    .getByLabel('Details for the seller')
    .fill('The basket delivered was a different size.');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('.track-requests')).toContainText('different size');
});

test('buyer can save tracking details; logout clears private data; seller can respond in the UI', async ({
  page
}, info) => {
  const f = await setup(page, info, false);
  await page.goto('/track');
  await page.evaluate(
    (token) => localStorage.setItem('brief_session', token),
    f.buyer.token
  );
  await page.goto(`/track?order=${f.order.id}`);
  await expect(
    page.getByRole('heading', { name: 'Order tracking', exact: true })
  ).toBeVisible();
  await page
    .getByText('Edit address & tracking email', { exact: true })
    .click();
  await page
    .getByLabel('Tracking email', { exact: true })
    .fill('new.customer@example.test');
  await page
    .getByRole('textbox', { name: 'Delivery address', exact: true })
    .fill('Westlands, Nairobi');
  await page
    .getByRole('button', { name: 'Save delivery details', exact: true })
    .click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Delivery details saved' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Contact support', exact: true })
    .click();
  await page
    .getByLabel('Details for the seller')
    .fill('Please confirm the delivery day.');
  await page.getByRole('button', { name: 'Send request', exact: true }).click();
  await expect(page.locator('.track-requests')).toContainText(
    'Awaiting seller'
  );
  await page.evaluate(() => {
    localStorage.removeItem('brief_session');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'brief_session', newValue: null })
    );
  });
  await expect(
    page.getByRole('heading', { name: 'Track your order', exact: true })
  ).toBeVisible();
  await expect(
    page.getByText('Westlands, Nairobi', { exact: true })
  ).toHaveCount(0);
  await page.evaluate(
    (token) => localStorage.setItem('brief_session', token),
    f.seller.token
  );
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Acknowledge', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expect(page.locator('.track-requests')).toContainText(
    'Seller acknowledged'
  );
  await expect(
    page.getByText('Edit address & tracking email', { exact: true })
  ).toHaveCount(0);
});

test('failed refresh keeps last update visibly stale, and expiry clears access even with refresh paused', async ({
  page
}, info) => {
  const f = await setup(page, info);
  await page.clock.install();
  await lookup(page, f.order);
  await page.route('**/api/public/order-tracking/read', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Tracking is temporarily unavailable.' })
    })
  );
  await page
    .getByRole('button', { name: 'Refresh tracking', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('last successful update');
  await expect(
    page.getByRole('heading', { name: 'In transit', exact: true })
  ).toBeVisible();
  await page.unroute('**/api/public/order-tracking/read');
  await page.getByRole('switch', { name: /Auto-refresh/ }).uncheck();
  await page.clock.fastForward(31 * 60 * 1000);
  await expect(
    page.getByRole('heading', { name: 'Track your order', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('expired');
});
