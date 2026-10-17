import { expect, test } from '@playwright/test';

test('the submitted grant URL serves a fixed, script-free redirect with a manual fallback', async ({ request }) => {
  const response = await request.get('/submission/');
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('<meta http-equiv="refresh" content="0; url=../"');
  expect(html).toContain('<a href="../">open the current LumenLenz demo</a>');
  expect(html).toContain('default-src \'none\'; base-uri \'none\'; form-action \'none\'');
  expect(html).toContain('content="noindex, follow"');
  expect(html).not.toMatch(/<script\b|<iframe\b|<form\b/i);
});

// Vite's SPA preview does not emulate GitHub Pages' directory-slash normalization.
// Check the exact submitted path here; check /submission normalization after deployment.
for (const path of ['/submission/', '/submission/index.html']) {
  test(`${path} opens the current homepage without external requests`, async ({ page, baseURL }) => {
    const outside: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith(`${baseURL}/`) && !request.url().startsWith('blob:')) outside.push(request.url());
    });
    await page.goto(path);
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page).toHaveTitle('LumenLenz');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the transaction.');
    expect(outside).toEqual([]);
  });
}

test('query/fragment data cannot choose a destination or trigger a shared transaction lookup', async ({ page, baseURL }) => {
  const outside: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(`${baseURL}/`) && !request.url().startsWith('blob:')) outside.push(request.url());
  });
  await page.goto('/submission/?next=https%3A%2F%2Fexample.invalid&network=stellar-testnet&tx=' + 'a'.repeat(64) + '#private-input');
  await expect(page).toHaveURL(`${baseURL}/`);
  await expect(page.locator('#report')).toBeHidden();
  expect(outside).toEqual([]);
});

test.describe('JavaScript disabled', () => {
  test.use({ javaScriptEnabled: false });
  test('the old link still redirects to the homepage', async ({ page, baseURL }) => {
    await page.goto('/submission/');
    await expect(page).toHaveURL(`${baseURL}/`);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the transaction.');
  });
});
