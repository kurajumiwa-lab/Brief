import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import crypto from 'node:crypto';
test.use({ serviceWorkers: 'block' });
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);
const password = 'product-review-test-password';
const headers = (user) => ({ authorization: `Bearer ${user.token}` });
let serial = 0;
async function register(page, prefix, name) {
  const handle = `rv_${prefix}_${Date.now().toString(36)}_${serial++}`;
  const r = await page.request.post('/ingest/api/auth/register', {
    data: { handle, password, displayName: name }
  });
  expect(r.status()).toBe(201);
  return { ...(await r.json()), handle };
}
async function setup(page, empty = false) {
  const seller = await register(page, 'seller', 'Amani Studio'),
    viewer = await register(page, 'reader', 'Nia M.');
  const s = await page.request.post('/ingest/api/spaces', {
    headers: headers(seller),
    data: {
      name: 'Amani Basket Studio',
      type: 'business',
      visibility: 'public',
      initialOffer: {
        title: 'Handwoven market basket',
        price: 1800,
        type: 'product'
      }
    }
  });
  expect(s.status()).toBe(201);
  const { space } = await s.json();
  const listingId = space.initialOfferId;
  expect(
    (
      await page.request.post(
        `/ingest/api/spaces/${space.id}/offers/${listingId}/publish`,
        { headers: headers(seller) }
      )
    ).status()
  ).toBe(200);
  const authors = [],
    reviews = [];
  let image, video;
  if (!empty)
    for (let i = 0; i < 12; i++) {
      const u = await register(
        page,
        'customer',
        ['Amina K.', 'Daniel M.', 'Wanjiku N.', 'Brian O.'][i % 4]
      );
      authors.push(u);
      if (i === 0) {
        for (const [kind, file] of [
          [
            'image',
            { name: 'review-photo.png', mimeType: 'image/png', buffer: png }
          ],
          [
            'video',
            {
              name: 'review-clip.webm',
              mimeType: 'video/webm',
              buffer: fs.readFileSync('tests/fixtures/review-clip.webm')
            }
          ]
        ]) {
          const r = await page.request.post(
            '/ingest/api/product-reviews/media',
            { headers: headers(u), multipart: { file } }
          );
          expect(r.status()).toBe(200);
          if (kind === 'image') image = (await r.json()).media;
          else video = (await r.json()).media;
        }
      }
      const r = await page.request.post(
        `/ingest/api/product-reviews/${listingId}/submit`,
        {
          headers: headers(u),
          data: {
            rating: [5, 5, 4, 5, 3, 4, 5, 4, 2, 5, 4, 5][i],
            title:
              i === 0
                ? 'Beautifully made, useful every day'
                : `My basket experience ${i + 1}`,
            body:
              i === 0
                ? 'I use it for weekend market trips. The quality feels sturdy and the fast delivery was appreciated. '.repeat(
                    6
                  ) + 'Last line of my experience.'
                : 'I have used this basket for daily shopping and it is easy to use. The size suits my needs and it feels like good value.',
            recommend: i !== 8 && i !== 4,
            categories: { quality: 5, value: 4, durability: 4, shipping: 5 },
            pros: ['Sturdy', 'Useful size'],
            cons: i === 8 ? ['Handle could be softer'] : [],
            size: 'Medium',
            color: i % 2 ? 'Natural' : 'Olive',
            uploadIds: i === 0 ? [image.id, video.id] : [],
            consent: true,
            key: crypto.randomUUID()
          }
        }
      );
      expect(r.status()).toBe(200);
      reviews.push((await r.json()).review);
    }
  if (!empty) {
    await page.request.post(
      `/ingest/api/product-reviews/${reviews[0].id}/vote`,
      { headers: headers(viewer), data: { vote: 'yes' } }
    );
    await page.request.post(
      `/ingest/api/product-reviews/${reviews[0].id}/vote`,
      { headers: headers(authors[1]), data: { vote: 'yes' } }
    );
    await page.request.post(
      `/ingest/api/product-reviews/${reviews[1].id}/vote`,
      { headers: headers(authors[2]), data: { vote: 'yes' } }
    );
    await page.request.post(
      `/ingest/api/product-reviews/${reviews[0].id}/response`,
      {
        headers: headers(seller),
        data: {
          body: 'Thank you for sharing how you use your basket. We appreciate the thoughtful feedback.'
        }
      }
    );
  }
  return { listingId, space, seller, viewer, authors, reviews, image, video };
}
async function signedIn(page, user, path) {
  await page.goto('/reviews');
  await page.evaluate(
    (token) => localStorage.setItem('brief_session', token),
    user.token
  );
  await page.goto(path);
}

test('empty state is honest, guest CTA signs in without a splash, and layouts fit small screens', async ({
  page
}, info) => {
  const f = await setup(page, true),
    errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/reviews/${f.listingId}`);
  await expect(
    page.getByRole('heading', {
      name: 'Handwoven market basket',
      exact: true,
      level: 1
    })
  ).toBeVisible();
  await expect(
    page.getByText('No reviews yet. Yours could be the first.')
  ).toBeVisible();
  await expect(page.getByTestId('brand-intro')).toHaveCount(0);
  await expect(page.locator('.rv-average')).not.toContainText('4.7');
  await page
    .getByRole('button', { name: 'Write a review', exact: true })
    .first()
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Join the conversation' })
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Sign in to review on Wairo' })
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  for (const width of [320, 360, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
  }
  expect(errors).toEqual([]);
});

test('real review aggregates, full featured reviews, filters, search, sorting and pagination', async ({
  page
}, info) => {
  const f = await setup(page);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`/reviews/${f.listingId}`);
  await expect(page.locator('.rv-average')).toContainText(
    'Based on 12 reviews'
  );
  await expect(
    page.getByRole('heading', { name: 'Found helpful by the community' })
  ).toBeVisible();
  await expect(page.locator('.rv-featured')).toContainText(
    'Last line of my experience.'
  );
  await expect(page.locator('.rv-featured')).toContainText('Verified seller');
  await expect(page.locator('.rv-highlights')).toContainText(
    'not AI-generated'
  );
  await page.screenshot({
    path: `.cache/reviews-viewport-${info.project.name}.png`
  });
  await page.screenshot({
    path: `.cache/reviews-full-${info.project.name}.png`,
    fullPage: true
  });
  await page.getByRole('button', { name: /Filter by 5 stars/ }).click();
  await expect(page.locator('.rv-results-line')).toContainText('of 6 reviews');
  await expect(page.locator('.rv-review-list .rv-review-card')).toHaveCount(6);
  await page.getByText('Filters', { exact: true }).click();
  await page.getByRole('switch', { name: 'Verified purchase only' }).check();
  await expect(
    page.getByRole('heading', { name: 'No reviews match just yet' })
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Clear all filters', exact: true })
    .click();
  await page.getByRole('switch', { name: 'With photos / videos' }).check();
  await expect(page.locator('.rv-review-list .rv-review-card')).toHaveCount(1);
  await page.getByText('Filters', { exact: true }).click();
  await page.locator('.rv-results-line button').click();
  await page.getByLabel('Sort reviews').selectOption('lowest');
  await expect(
    page.locator('.rv-review-list .rv-review-card').first()
  ).toContainText('My basket experience 9');
  await page.getByRole('button', { name: 'Page 2', exact: true }).click();
  await expect(page.locator('.rv-results-line')).toContainText(
    'Showing 11–12 of 12'
  );
  await page.getByLabel('Jump to page').fill('1');
  await page.getByRole('button', { name: 'Go', exact: true }).click();
  await expect(page.locator('.rv-results-line')).toContainText(
    'Showing 1–10 of 12'
  );
  await page.getByLabel('Search in reviews').fill('weekend market trips');
  await expect(page.locator('.rv-review-list .rv-review-card')).toHaveCount(1);
  await page
    .locator('.rv-review-list')
    .getByRole('button', { name: 'Read more' })
    .click();
  await expect(page.locator('.rv-review-list')).toContainText(
    'Last line of my experience.'
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(errors).toEqual([]);
});

test('customer photo lightbox, real video playback and review-context links work', async ({
  page
}) => {
  const f = await setup(page);
  await page.goto(`/reviews/${f.listingId}`);
  await page
    .locator('.rv-gallery-strip')
    .getByRole('button', { name: 'Open customer photo' })
    .click();
  let modal = page.getByRole('dialog', { name: 'Through customers’ eyes' });
  await expect(modal.locator('.rv-lightbox')).toContainText(
    'Beautifully made, useful every day'
  );
  await expect(
    modal.getByRole('link', { name: /Read this review/ })
  ).toHaveAttribute('href', new RegExp(f.reviews[0].id));
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  await page.getByRole('button', { name: 'See all 1 photo & 1 video' }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Open customer video' })
    .click();
  const video = page.getByRole('dialog').locator('video');
  await expect(video).toBeVisible();
  await expect
    .poll(() => video.evaluate((el) => el.readyState))
    .toBeGreaterThanOrEqual(1);
  expect(await video.evaluate((el) => el.controls)).toBe(true);
  await page.keyboard.press('Escape');
});

test('sign-in, star selection, upload, disclosures and submission persist, and logout drops private context', async ({
  page
}) => {
  const f = await setup(page, true);
  await page.goto(`/reviews/${f.listingId}`);
  await page
    .getByRole('button', { name: 'Write a review', exact: true })
    .first()
    .click();
  const auth = page.getByRole('dialog');
  await auth.getByLabel('Handle').fill(f.viewer.handle);
  await auth.getByLabel('Password').fill(password);
  await auth.getByRole('button', { name: 'Sign in', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Share your experience' });
  await expect(modal).toBeVisible();
  await modal.getByRole('radio', { name: '4 stars', exact: true }).check();
  await modal
    .getByLabel('Review title *', { exact: true })
    .fill('Useful for everyday shopping');
  await modal
    .getByRole('textbox', { name: 'Your review', exact: true })
    .fill(
      'The basket has been useful for everyday shopping. It is sturdy, comfortable to carry, and easy to store at home.'
    );
  await modal.getByLabel('Upload review photos or videos').setInputFiles({
    name: 'my-basket.png',
    mimeType: 'image/png',
    buffer: png
  });
  await expect(modal.getByAltText('Your upload')).toBeVisible();
  await modal.getByRole('radio', { name: 'Yes, I would' }).check();
  await modal.getByLabel('Show my name as Anonymous').check();
  await modal
    .getByLabel(
      'I received a free item, discount or other incentive for this review'
    )
    .check();
  await modal
    .getByRole('checkbox', { name: /I agree to the review guidelines/ })
    .check();
  await modal
    .getByRole('button', { name: 'Submit review', exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Thank you. Your review is published.' })
  ).toBeVisible();
  await expect(page.locator('.rv-review-list')).toContainText('Anonymous');
  await expect(page.locator('.rv-review-list')).toContainText(
    'Incentivized review'
  );
  await expect(page.locator('.rv-review-list')).toContainText(
    'Purchase not verified'
  );
  await page.reload();
  await expect(page.locator('.rv-average')).toContainText('Based on 1 review');
  await expect(
    page.getByRole('button', { name: 'Remove my review' })
  ).toBeVisible();
  await page.evaluate(() => {
    localStorage.removeItem('brief_session');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'brief_session', newValue: null })
    );
  });
  await expect(
    page.getByRole('button', { name: 'Remove my review' })
  ).toHaveCount(0);
  await expect(page.locator('.rv-review-list')).toContainText(
    'Useful for everyday shopping'
  );
});

test('helpfulness change/undo, report persistence and authenticated seller responses', async ({
  page
}) => {
  const f = await setup(page);
  await signedIn(page, f.viewer, `/reviews/${f.listingId}?q=weekend`);
  const card = page.locator('.rv-review-list .rv-review-card');
  await expect(
    card.getByRole('button', { name: 'Helpful: Yes (2)' })
  ).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Helpful: No (0)' }).click();
  await expect(
    card.getByRole('button', { name: 'Helpful: No (1)' })
  ).toHaveAttribute('aria-pressed', 'true');
  await card.getByRole('button', { name: 'Helpful: No (1)' }).click();
  await expect(
    card.getByRole('button', { name: 'Helpful: No (0)' })
  ).toHaveAttribute('aria-pressed', 'false');
  await card.getByRole('button', { name: 'Report review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Report this review' });
  await dialog.getByLabel('Reason').selectOption('other');
  await dialog
    .getByLabel('Details')
    .fill('Please check whether this content follows the guidelines.');
  await dialog.getByRole('button', { name: 'Send report' }).click();
  await expect(card.getByRole('status')).toContainText('Report received');
  await signedIn(page, f.seller, `/reviews/${f.listingId}?q=weekend`);
  await card.getByRole('button', { name: 'Edit seller response' }).click();
  await card
    .getByLabel('Official seller response')
    .fill(
      'Thank you for the feedback. Please contact us if you need care instructions.'
    );
  await card.getByRole('button', { name: 'Publish response' }).click();
  await expect(card.locator('.rv-seller-response')).toContainText(
    'care instructions'
  );
  await expect(card.locator('.rv-seller-response')).toContainText(
    'Verified seller'
  );
  await expect(
    card.getByRole('button', { name: /Helpful: Yes/ })
  ).toBeDisabled();
  await page.goto(
    `/reviews/${f.listingId}?review=${f.reviews[0].id}#review-${f.reviews[0].id}`
  );
  await expect(page.locator('.rv-shared-review')).toContainText(
    'Last line of my experience.'
  );
});

test('moderation is private, hides review media, and authenticated moderators can inspect and restore', async ({
  page
}, info) => {
  const f = await setup(page, true);
  await page.goto('/reviews/moderation');
  await expect(
    page.getByRole('heading', { name: 'Sign in as a moderator' })
  ).toBeVisible();
  await signedIn(page, f.seller, '/reviews/moderation');
  await expect(page.getByRole('alert')).toContainText('moderator access');
  await expect(page.locator('.rv-moderation .rv-review-card')).toHaveCount(0);
  const up = await page.request.post('/ingest/api/product-reviews/media', {
    headers: headers(f.viewer),
    multipart: {
      file: { name: 'moderate.png', mimeType: 'image/png', buffer: png }
    }
  });
  const media = (await up.json()).media;
  const submit = await page.request.post(
    `/ingest/api/product-reviews/${f.listingId}/submit`,
    {
      headers: headers(f.viewer),
      data: {
        rating: 3,
        title: 'A basket review to assess',
        body: 'The basket has been useful for everyday shopping. Here is a photo of the details I would like to share.',
        recommend: true,
        consent: true,
        uploadIds: [media.id],
        key: crypto.randomUUID()
      }
    }
  );
  const review = (await submit.json()).review;
  await page.request.post(`/ingest/api/product-reviews/${review.id}/report`, {
    headers: headers(f.seller),
    data: {
      reason: 'privacy',
      note: 'Please check the photo for accidental personal details.'
    }
  });
  const handle = `product_review_${info.project.name}`;
  let login = await page.request.post('/ingest/api/auth/register', {
    data: { handle, password }
  });
  if (login.status() === 409)
    login = await page.request.post('/ingest/api/auth/login', {
      data: { handle, password }
    });
  expect([200, 201]).toContain(login.status());
  const moderator = await login.json();
  await signedIn(page, moderator, '/reviews/moderation');
  const card = page
    .locator('.rv-moderation .rv-review-card')
    .filter({ has: page.locator(`a[href*="review=${review.id}"]`) });
  await expect(card).toBeVisible();
  await card
    .getByLabel('Decision reason')
    .fill('Temporarily hiding while the privacy concern is checked.');
  await card.getByRole('button', { name: 'Hide review', exact: true }).click();
  await expect(card).toContainText('Review status: hidden');
  expect(
    (await page.request.get(`/ingest/api/media/file/${media.id}`)).status()
  ).toBe(404);
  await card.getByText('Review media (1)', { exact: true }).click();
  await expect(card.getByAltText('Review media for moderation')).toBeVisible();
  await expect
    .poll(() =>
      card
        .getByAltText('Review media for moderation')
        .evaluate((el) => el.complete && el.naturalWidth > 0)
    )
    .toBe(true);
  await card
    .getByLabel('Decision reason')
    .fill('The photo has been checked and no personal information is present.');
  await card
    .getByRole('button', { name: 'Restore review', exact: true })
    .click();
  await expect(card).toContainText('Review status: published');
  expect(
    (await page.request.get(`/ingest/api/media/file/${media.id}`)).status()
  ).toBe(200);
});
