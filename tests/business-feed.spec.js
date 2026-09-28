import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
test.use({ serviceWorkers: 'block' });
const password = 'business-feed-browser-password';
const auth = (u) => ({ authorization: `Bearer ${u.token}` });
const card = (page, key) => page.locator(`.bf-card[data-card-key="${key}"]`);
async function user(page) {
  const handle = `feed_${crypto.randomBytes(7).toString('hex')}`;
  const r = await page.request.post('/ingest/api/auth/register', {
    data: { handle, password }
  });
  expect(r.status()).toBe(201);
  return { ...(await r.json()), handle };
}
async function fixture(page) {
  const seller = await user(page),
    reader = await user(page),
    tag = crypto.randomBytes(4).toString('hex');
  const s = await page.request.post('/ingest/api/spaces', {
    headers: auth(seller),
    data: {
      name: `Software studio ${tag}`,
      type: 'business',
      visibility: 'public',
      initialOffer: {
        title: `Booking software ${tag}`,
        description:
          'A software tool for scheduling restaurant demos and managing sales conversations.',
        type: 'product',
        price: 1800
      }
    }
  });
  expect(s.status()).toBe(201);
  const { space } = await s.json();
  const id = space.initialOfferId;
  expect(
    (
      await page.request.post(
        `/ingest/api/spaces/${space.id}/offers/${id}/publish`,
        { headers: auth(seller) }
      )
    ).status()
  ).toBe(200);
  return { seller, reader, space, id, key: `listing:${id}`, tag };
}
async function enter(page, u = null, path = 'city') {
  await page.goto('/#city');
  if (u) {
    await page.evaluate(
      (token) => localStorage.setItem('brief_session', token),
      u.token
    );
    await page.reload();
  }
  await page.goto(`/#${path}`);
  await expect(page.getByTestId('business-feed')).toBeVisible();
  await expect(page.locator('.bf-loading')).toHaveCount(0);
}
async function search(page, text) {
  await page.getByRole('textbox', { name: 'Search business feed' }).fill(text);
  await expect(page.locator('.bf-loading')).toHaveCount(0);
}

test('mixed-feed doorway, labelled editorial guidance, guest tuning and small-screen layout', async ({
  page
}, info) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await enter(page);
  await expect(
    page.getByRole('heading', { level: 1, name: 'Find your next good move.' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Playbooks', exact: true }).click();
  await expect(page.locator('.bf-grid .bf-card')).toHaveCount(4);
  await expect(page.locator('.bf-grid')).toContainText('Wairo editorial');
  await expect(page.locator('.bf-grid')).toContainText('not a customer result');
  await page.screenshot({
    path: `.cache/feed-${info.project.name}.png`,
    fullPage: true
  });
  await card(page, 'playbook:brief-a-task')
    .getByRole('button', { name: 'Read playbook' })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('A remote task should not require GPS');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Tune feed', exact: true }).click();
  await page.getByLabel('Your focus').selectOption('software');
  await page.getByLabel('Location', { exact: true }).fill('Nairobi');
  await page.getByRole('button', { name: 'Apply for this visit' }).click();
  await expect(page.locator('.bf-applied')).toContainText('software · Nairobi');
  await expect(page.locator('.bf-notice')).toContainText(
    'Applied for this visit'
  );
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Make this feed yours' })
  ).toBeVisible();
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 820 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBeTruthy();
  }
  expect(errors).toEqual([]);
});

test('real offers search/filter/rating links and legacy supply paths remain functional', async ({
  page
}, info) => {
  const f = await fixture(page);
  await enter(page);
  await search(page, f.tag);
  const c = card(page, f.key);
  await expect(c).toBeVisible();
  await expect(c).toContainText('KES 1,800');
  await expect(c).toContainText('No customer reviews yet');
  await expect(c).toContainText('Software · keyword match');
  await c.getByText('Why this card?', { exact: true }).click();
  await expect(c).toContainText('not a provider or worker trust score');
  await page.screenshot({
    path: `.cache/feed-offer-${info.project.name}.png`,
    fullPage: true
  });
  await c.getByRole('link', { name: 'No customer reviews yet' }).click();
  await expect(page).toHaveURL(new RegExp(`/reviews/${f.id}`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(f.tag);
  await enter(page);
  await page
    .getByRole('button', { name: 'Supply routes', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Browse the board', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Back to the business feed' }).click();
  await expect(page.getByTestId('business-feed')).toBeVisible();
  await page.getByRole('button', { name: 'I have something to offer' }).click();
  await expect(page.getByTestId('business-feed')).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Back to the business feed' })
  ).toBeVisible();
});

test('actual sign-in, save/follow/hide, preference persistence and logout isolation', async ({
  page
}) => {
  const f = await fixture(page);
  await enter(page);
  await search(page, f.tag);
  let c = card(page, f.key);
  await c
    .getByRole('button', {
      name: `Save Booking software ${f.tag}`,
      exact: true
    })
    .click();
  const login = page.getByRole('dialog');
  await login.getByLabel('Handle', { exact: true }).fill(f.reader.handle);
  await login.getByLabel('Password', { exact: true }).fill(password);
  await login.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(login).toHaveCount(0);
  await expect(c).toBeVisible();
  await c
    .getByRole('button', {
      name: `Save Booking software ${f.tag}`,
      exact: true
    })
    .click();
  await expect(
    c.getByRole('button', {
      name: `Unsave Booking software ${f.tag}`,
      exact: true
    })
  ).toHaveAttribute('aria-pressed', 'true');
  await c.getByRole('button', { name: 'Follow provider', exact: true }).click();
  await expect(
    c.getByRole('button', { name: 'Following', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await page
    .getByRole('navigation', { name: 'Discovery views' })
    .getByRole('button', { name: 'Following', exact: true })
    .click();
  await expect(c).toBeVisible();
  await page.getByRole('button', { name: 'Tune feed', exact: true }).click();
  let d = page.getByRole('dialog');
  await d.getByLabel('Your focus').selectOption('software');
  await d.getByLabel('Location', { exact: true }).fill('Nairobi');
  await d.getByLabel('Maximum tool / offer budget (KES)').fill('2000');
  await d.getByLabel('Remember cards I open or share to tune my feed').check();
  await d.getByRole('button', { name: 'Save preferences' }).click();
  await expect(d).toHaveCount(0);
  await expect(page.locator('.bf-applied')).toContainText('up to KES 2,000');
  await page.reload();
  await expect(page.locator('.bf-loading')).toHaveCount(0);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(c).toBeVisible();
  await c.getByRole('button', { name: 'Hide', exact: true }).click();
  await expect(c.getByRole('button', { name: 'Show again' })).toBeVisible();
  await page
    .getByRole('navigation', { name: 'Discovery views' })
    .getByRole('button', { name: 'For you', exact: true })
    .click();
  await search(page, f.tag);
  await expect(c).toHaveCount(0);
  await page.getByRole('button', { name: 'Tune feed', exact: true }).click();
  await page.getByRole('button', { name: 'Restore hidden cards (1)' }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(c).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('brief_session');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'brief_session', newValue: null })
    );
  });
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Make this feed yours' })
  ).toBeVisible();
  await expect(page.locator('.bf-applied')).toHaveCount(0);
  await expect(c).toHaveCount(0);
});

test('public card links resolve with context, and unpublishing revokes shared access', async ({
  page
}) => {
  const f = await fixture(page);
  await enter(page, null, `city/all?card=${encodeURIComponent(f.key)}`);
  const shared = page.getByRole('region', { name: 'Shared card' });
  await expect(shared).toContainText(f.tag);
  await expect(card(page, f.key)).toHaveCount(1);
  await shared
    .getByRole('button', { name: `Share Booking software ${f.tag}` })
    .click();
  await expect(page.locator('.bf-notice')).toContainText(
    /Link copied|Copy this public card link/
  );
  const l = await page.request.post(`/ingest/api/listings/${f.id}/status`, {
    headers: auth(f.seller),
    data: { status: 'paused' }
  });
  expect(l.status()).toBe(200);
  await page.reload();
  await expect(page.locator('.bf-notice')).toContainText(
    'no longer available or is private'
  );
  await expect(card(page, f.key)).toHaveCount(0);
});

test('network campaign cards show truthful approval terms and open the canonical worker workspace', async ({
  page
}) => {
  const owner = await user(page),
    worker = await user(page),
    title = `Real outreach ${crypto.randomBytes(4).toString('hex')}`;
  const w = await page.request.post('/ingest/api/workforces', {
    headers: auth(owner),
    data: { name: 'Browser execution studio' }
  });
  expect(w.status()).toBe(201);
  const { workforce } = await w.json();
  const p = await page.request.post(
    `/ingest/api/workforces/${workforce.id}/programs`,
    {
      headers: auth(owner),
      data: {
        templateKey: 'lead_calling',
        title,
        target: 20,
        unitPriceKes: 300,
        audience: 'network',
        objective: 'A consent-based outreach pilot',
        deadline: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10)
      }
    }
  );
  expect(p.status()).toBe(201);
  const { program } = await p.json();
  expect(
    (
      await page.request.post(
        `/ingest/api/work-programs/${program.id}/status`,
        {
          headers: auth(owner),
          data: { action: 'publish', revision: program.revision }
        }
      )
    ).status()
  ).toBe(200);
  await enter(page);
  await search(page, title);
  await expect(page.locator('.bf-card')).toHaveCount(0);
  await enter(page, worker);
  await search(page, title);
  const c = card(page, `program:${program.id}`);
  await expect(c).toContainText('KES 240');
  await expect(c).toContainText('Not earnings or a payment guarantee');
  await expect(c.getByRole('button', { name: /Share/ })).toHaveCount(0);
  await c.getByText(/Before you can take this work/).click();
  await expect(c).toContainText('Set up your worker profile');
  await c.getByRole('button', { name: 'Review work & eligibility' }).click();
  await expect(page.getByTestId('workforce-desk')).toBeVisible();
  await expect(page.locator(`[id="program-${program.id}"]`)).toBeAttached();
  await expect(
    page.getByRole('heading', { name: title, exact: true })
  ).toBeVisible();
});

test('search/sort, source errors and retry do not masquerade as empty success', async ({
  page
}) => {
  await enter(page);
  await page.getByLabel('Sort feed').selectOption('latest');
  await page.getByRole('button', { name: 'Playbooks', exact: true }).click();
  await search(page, 'software');
  await expect(page.locator('.bf-grid .bf-card')).toHaveCount(1);
  await page.route('**/api/discover/business?**', (r) =>
    r.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Temporary feed outage' })
    })
  );
  await search(page, 'a changed query');
  await expect(page.getByRole('alert')).toContainText('Temporary feed outage');
  await expect(page.locator('.bf-grid')).toHaveCount(0);
  await page.unroute('**/api/discover/business?**');
  await page.getByRole('button', { name: 'Retry feed' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await search(page, 'software');
  await expect(page.locator('.bf-grid .bf-card')).toHaveCount(1);
});

test('matched briefs open the existing capability workspace without exposing private demand', async ({
  page
}) => {
  const buyer = await user(page),
    supplier = await user(page),
    tag = crypto.randomBytes(4).toString('hex');
  const e = await page.request.post('/ingest/api/enterprises', {
    headers: auth(supplier),
    data: {
      displayName: `Packaging studio ${tag}`,
      businessType: 'manufacturer',
      supplyRole: 'direct_supplier',
      location: 'Nairobi',
      serviceAreas: ['Nairobi'],
      publication: 'public',
      firstCapability: {
        name: 'Printed paper takeaway bags',
        category: 'Packaging',
        productsServices: ['Paper bags'],
        minimumQuantity: 100,
        maximumQuantity: 50000,
        typicalCapacity: 20000,
        unit: 'pieces',
        capacityKind: 'production',
        leadTime: { minDays: 2, maxDays: 4 },
        serviceAreas: ['Nairobi']
      }
    }
  });
  expect(e.status()).toBe(201);
  const d = await page.request.post('/ingest/api/requests', {
    headers: auth(buyer),
    data: {
      title: `Paper bags for business ${tag}`,
      description: 'PRIVATE commercial contacts that cannot enter discovery',
      quantity: 5000,
      unit: 'pieces',
      category: 'Packaging',
      location: 'Nairobi',
      requiredBy: new Date(Date.now() + 5 * 86400000)
        .toISOString()
        .slice(0, 10),
      budgetMax: 50000,
      visibility: 'public',
      intent: 'submit'
    }
  });
  expect(d.status()).toBe(201);
  const { request } = await d.json();
  expect(
    (
      await page.request.patch(`/ingest/api/requests/${request.id}/status`, {
        headers: auth(buyer),
        data: { status: 'matching', revision: request.revision }
      })
    ).status()
  ).toBe(200);
  await enter(page, supplier);
  await page
    .getByRole('button', { name: 'Matched briefs', exact: true })
    .click();
  await search(page, tag);
  const c = page.locator('.bf-grid .bf-card');
  await expect(c).toHaveCount(1);
  await expect(c).not.toContainText('PRIVATE commercial contacts');
  await expect(c).not.toContainText('50,000');
  await c.getByRole('button', { name: 'Review matched brief' }).click();
  await expect(
    page.getByTestId('relevant-request').filter({ hasText: tag })
  ).toBeVisible();
  await expect(
    page.getByTestId('relevant-request').filter({ hasText: tag })
  ).toContainText('I can help with this Request');
});
