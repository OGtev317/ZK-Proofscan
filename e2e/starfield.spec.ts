import { expect, test } from '@playwright/test';

test('keeps a black background in light mode and animates decorative white stars', async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  const problems: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4317/') && !url.startsWith('blob:')) problems.push(`request to ${url}`);
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
  await expect(page.locator('.starfield')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.starfield')).toHaveCSS('pointer-events', 'none');
  await expect(page.locator('.starfield__layer')).toHaveCount(3);
  for (const layer of await page.locator('.starfield__layer').all()) {
    await expect(layer).toHaveCSS('animation-name', 'star-drift');
    await expect(layer).toHaveCSS('animation-play-state', 'running');
    await expect(layer).toHaveCSS('background-image', /rgb\(255, 255, 255\)/);
  }
  const first = page.locator('.starfield__layer').first();
  const initialTransform = await first.evaluate((element) => getComputedStyle(element).transform);
  await expect.poll(() => first.evaluate((element) => getComputedStyle(element).transform)).not.toBe(initialTransform);
  // WebKit's screenshot helper injects inline styling blocked by this page's CSP.
  // Keep its functional/security assertions intact; capture the reference in Chromium.
  if (info.project.name === 'chromium') {
    await page.screenshot({ path: info.outputPath('starfield-desktop.png'), fullPage: true, caret: 'initial' });
  }
  // The background must never intercept the input or add an external request.
  await page.getByRole('textbox', { name: 'Transaction hash or block-explorer link' }).fill('example');
  await expect(page.locator('#lookup-text')).toHaveValue('example');
  expect(problems).toEqual([]);
});

test('lets people pause and resume star motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  const pause = page.getByRole('checkbox', { name: 'Pause star motion' });
  await pause.check();
  await expect(page.locator('.starfield__layer').first()).toHaveCSS('animation-play-state', 'paused');
  await pause.uncheck();
  await expect(page.locator('.starfield__layer').first()).toHaveCSS('animation-play-state', 'running');
});

test('keeps stars still when reduced motion is requested', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const layer of await page.locator('.starfield__layer').all()) {
    await expect(layer).toHaveCSS('animation-name', 'none');
  }
  await expect(page.locator('.motion-toggle')).toBeHidden();
});

test('keeps the mobile layout usable without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Check transaction', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.locator('#advanced-tools > summary').click();
  await expect(page.getByRole('button', { name: 'Check proof', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

for (const viewport of [{ name: 'compact', width: 320, height: 740 }, { name: 'desktop', width: 1280, height: 1000 }]) {
  test(`keeps the refined search and proof report usable on ${viewport.name}`, async ({ page }, info) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const problems: string[] = [];
    page.on('request', (request) => {
      if (!request.url().startsWith('http://127.0.0.1:4317/') && !request.url().startsWith('blob:')) problems.push(`request to ${request.url()}`);
    });
    page.on('pageerror', (error) => problems.push(error.message));
    await page.goto('/');
    await expect(page).toHaveTitle('LumenLenz');
    await expect(page.getByRole('link', { name: 'LumenLenz home', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Read the transaction.');
    await expect(page.getByRole('button', { name: 'Check transaction', exact: true })).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Transaction hash or block-explorer link' });
    await input.focus();
    // macOS WebKit uses Option-Tab to include buttons when full keyboard access is off.
    await input.press(info.project.name === 'webkit' && process.platform === 'darwin' ? 'Alt+Tab' : 'Tab');
    await expect(page.getByRole('button', { name: 'Check transaction', exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (info.project.name === 'chromium') {
      await page.screenshot({ path: info.outputPath(`reader-${viewport.name}.png`), fullPage: true, caret: 'initial' });
    }
    await page.getByRole('button', { name: 'A Stellar private payment', exact: true }).click();
    await expect(page.locator('#report')).toHaveAttribute('data-outcome', 'valid');
    await expect(page.locator('#fact-proof')).toHaveText('Passed: two independent verifiers agree');
    expect(await page.locator('#fact-proof').evaluate((element) => Boolean(element.compareDocumentPosition(document.querySelector('#plain')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await expect(page.getByRole('heading', { name: 'What remains unknown', exact: true })).toBeVisible();
    await expect(page.locator('#recorded-note')).toContainText('nothing was fetched now');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const report = await page.locator('#report').boundingBox();
    expect(report).not.toBeNull();
    expect(report!.x).toBeGreaterThanOrEqual(0);
    expect(report!.x + report!.width).toBeLessThanOrEqual(viewport.width);
    if (info.project.name === 'chromium') {
      await page.screenshot({ path: info.outputPath(`report-${viewport.name}.png`), fullPage: true, caret: 'initial' });
    }
    expect(problems).toEqual([]);
  });
}
