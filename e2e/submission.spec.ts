import { test, expect } from '@playwright/test';

test('submission page states boundaries and opens the existing verifier', async ({ page }) => {
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4317')) external.push(request.url());
  });
  await page.goto('/submission/');
  await expect(page).toHaveTitle('Akashi by OtakuLabz — Proofs, made legible.');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Proofs,made legible.');
  await expect(page.getByText('Illustrative layout · no proof run')).toBeVisible();
  await expect(page.getByText('Stellar transaction lookup is not implemented.')).toBeVisible();
  await expect(page.getByText('Explanation review: pending')).toBeVisible();
  await page.getByRole('link', { name: 'Build status', exact: true }).click();
  await expect(page).toHaveURL(/#progress$/);
  expect(external).toEqual([]);
  await page.getByRole('link', { name: 'Explore the working prototype' }).click();
  await expect(page.getByRole('heading', { name: 'Check a proof', exact: true })).toBeVisible();
});

test('submission page fits a phone and keeps the prototype accessible', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/submission/');
  await expect(page.getByRole('link', { name: 'Open prototype', exact: false })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Our Stellar direction' }).click();
  await expect(page).toHaveURL(/#stellar$/);
});
