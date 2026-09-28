import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block' });

test('two illustrated cards, manual entry and same-tab reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/intro');
  await expect(page.getByTestId('brand-intro')).toBeVisible();
  await expect(page.locator('[data-wairo-app]')).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Small starts. Big possibilities.' })).toBeVisible();
  await expect(page.locator('.wairo-brand-art img')).toBeVisible();
  await expect.poll(() => page.locator('.wairo-brand-art img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Meet your next plan' }).click();
  await expect(page.getByRole('heading', { name: 'Good people. Great plans.' })).toBeVisible();
  await expect.poll(() => page.locator('.wairo-brand-art img').evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: 'Enter Wairo' }).click();
  await expect(page).toHaveURL(/\/#home$/);
  await expect(page.getByTestId('compact-home')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('compact-home')).toBeVisible();
  await expect(page.getByTestId('brand-intro')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('plays both cards then reveals the real app', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.mouse.move(0, 0);
  await expect(page.getByTestId('brand-intro')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Good people. Great plans.' })).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId('brand-intro')).toHaveCount(0, { timeout: 10000 });
  await expect(page.getByTestId('compact-home')).toBeVisible();
});

test('Skip and reduced motion do not trap the visitor', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/intro');
  await expect(page.getByText('Go at your pace')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause introduction' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Skip intro' }).click();
  await expect(page.getByTestId('compact-home')).toBeVisible();
  await expect(page.getByTestId('brand-intro')).toHaveCount(0);
});

test('fresh deep links open their destination without a marketing gate', async ({ context }) => {
  for (const destination of ['/#admin/members', '/#wanderly', '/c/unavailable', '/groups']) {
    const page = await context.newPage();
    await page.goto(destination);
    await expect(page.locator('[data-wairo-app]')).toBeVisible();
    await expect(page.getByTestId('brand-intro')).toHaveCount(0);
    await expect(page.locator('#boot-splash')).toHaveCount(0);
    await page.close();
  }
});
