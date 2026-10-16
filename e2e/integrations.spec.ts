import { Account, Address, Contract, nativeToScVal, Networks, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { expect, test } from '@playwright/test';

const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const unsigned = new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(new Contract(TOKEN).call('approve', Address.fromString(USER).toScVal(), Address.fromString(USER).toScVal(), nativeToScVal(100n, { type: 'i128' }), nativeToScVal(5000, { type: 'u32' }))).setTimeout(300).build().toXDR();

test('Lab import is local, bounded, and invalidates the previous inspection', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/');
  await page.locator('#before-sign > summary').click();
  await page.setInputFiles('#xdr-file', { name: 'unsigned.xdr', mimeType: 'text/plain', buffer: Buffer.from(unsigned) });
  await expect(page.locator('#unsigned-xdr')).toHaveValue(unsigned);
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('Requested actions');
  await page.locator('[name="preview-network"][value="stellar-mainnet"]').check();
  await expect(page.locator('#preview-result')).toBeHidden();
  await page.setInputFiles('#xdr-file', { name: 'too-large.txt', mimeType: 'text/plain', buffer: Buffer.alloc(262_145, 65) });
  await expect(page.locator('#preview-result')).toContainText('too large');
  await expect(page.locator('#unsigned-xdr')).toHaveValue('');
  const link = page.locator('#before-sign a[href^="https://lab.stellar.org"]');
  await expect(link).toHaveAttribute('href', 'https://lab.stellar.org/');
  expect(page.url()).not.toContain(unsigned);
  expect(outside).toEqual([]);
});

test('report embed shows a real saved swap and clears without contacting an RPC', async ({ page }, testInfo) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/integrations/');
  await page.click('#embed-swap');
  const card = page.locator('lumenlenz-report');
  await expect(card).toContainText('0.0927076', { timeout: 30_000 });
  await expect(card).toContainText('published deployment');
  await expect(card).toContainText('Supplied report');
  await expect(page.locator('#embed-status')).toContainText('No supported proof');
  await card.screenshot({ path: testInfo.outputPath('supplied-swap-report.png'), animations: 'disabled' });
  await page.click('#embed-clear');
  await expect(card).not.toContainText('0.0927076');
  expect(outside).toEqual([]);
});

test('embed separates a locally checked testnet proof from its display-only rendering', async ({ page }) => {
  await page.goto('/integrations/');
  await page.click('#embed-proof');
  await expect(page.locator('lumenlenz-report')).toContainText('two independent verifiers agree', { timeout: 45_000 });
  await expect(page.locator('#embed-status')).toContainText('component only displays');
  await expect(page.locator('lumenlenz-report')).not.toContainText('passed on this device');
});

test('local acknowledgement resets for changed envelope/network and invokes no wallet or RPC', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/integrations/');
  await expect(page.locator('#review-confirm')).toBeDisabled();
  await page.fill('#review-xdr', unsigned);
  await page.click('#review-local');
  await expect(page.locator('#review-details')).toContainText('spending permission');
  await page.check('#review-ack');
  await page.click('#review-confirm');
  await expect(page.locator('#review-status')).toContainText('No wallet invoked');
  await page.locator('[name="review-network"][value="stellar-mainnet"]').check();
  await expect(page.locator('#review-confirm')).toBeDisabled();
  await expect(page.locator('#review-details')).toBeEmpty();
  await page.click('#review-local');
  await page.check('#review-ack');
  await page.fill('#review-xdr', 'malformed');
  await expect(page.locator('#review-confirm')).toBeDisabled();
  expect(outside).toEqual([]);
});

test('embed renders hostile text literally, handles malformed input, and fits mobile', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/integrations/');
  await page.evaluate(() => {
    const card = document.querySelector('lumenlenz-report') as HTMLElement & { result: unknown };
    card.result = { facts: { family: 'stellar', provider: '<img src=x onerror=alert(1)>', network: 'stellar-testnet', transaction: 'x'.repeat(64), position: 1, status: 'succeeded', from: 'A', action: '<script>alert(1)</script>' } };
  });
  const card = page.locator('lumenlenz-report');
  await expect(card).toContainText('<script>alert(1)</script>');
  await expect(card.locator('img,script')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { (document.querySelector('lumenlenz-report') as unknown as { result: unknown }).result = { report: {} }; });
  await expect(card).toContainText('could not be rendered');
});
