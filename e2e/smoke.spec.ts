import { test, expect } from '@playwright/test';

/**
 * Logged-out smoke over the public surfaces + auth gates. Safe against any
 * running instance (creates no accounts, writes nothing). Signed-in journeys
 * are covered by vitest at the service layer.
 */

test('landing renders for logged-out visitors', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /build an ai that knows how you think/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /build my persona/i })).toBeVisible();
});

test('protected app routes bounce to sign-in', async ({ page }) => {
  await page.goto('/me');
  await page.waitForURL(/\/sign-in/);
  await expect(page.getByLabel(/email/i)).toBeVisible();
});

test('old /office and /clones URLs land somewhere real', async ({ page }) => {
  const r1 = await page.goto('/office');
  expect(r1?.status()).toBeLessThan(400); // → /me → /sign-in, never a 404
  const r2 = await page.goto('/clones');
  expect(r2?.status()).toBeLessThan(400);
});

test('explore, about and privacy are public', async ({ page }) => {
  await page.goto('/explore');
  await expect(page).toHaveURL(/\/explore/);
  await page.goto('/about');
  await expect(page.getByRole('heading', { name: /about opersona/i })).toBeVisible();
  await page.goto('/privacy');
  await expect(page).toHaveURL(/\/privacy/);
});

test('unknown routes show the branded 404', async ({ page }) => {
  const res = await page.goto('/definitely-not-a-page');
  expect(res?.status()).toBe(404);
  await expect(page.getByText(/nothing lives at this address/i)).toBeVisible();
});

test('sign-up page renders (whether open or invite-only)', async ({ page }) => {
  await page.goto('/sign-up');
  await expect(page).toHaveURL(/\/sign-up/);
});
