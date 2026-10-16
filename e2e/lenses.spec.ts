import { Account, Address, Contract, nativeToScVal, Networks, StrKey, TransactionBuilder } from '@stellar/stellar-sdk';
import { expect, test } from '@playwright/test';

const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const unsigned = new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(new Contract(TOKEN).call('approve', Address.fromString(USER).toScVal(), Address.fromString(USER).toScVal(), nativeToScVal(100n, { type: 'i128' }), nativeToScVal(5000, { type: 'u32' }))).setTimeout(300).build().toXDR();

test('inspection happens on this device, offers no way to send the transaction, and clears stale state', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/');
  await page.locator('#before-sign > summary').click();
  await page.fill('#unsigned-xdr', unsigned);
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('Requested actions');
  await expect(page.locator('#preview-result')).toContainText('spending permission');
  await expect(page.locator('#before-sign')).not.toContainText('Simulate');
  expect(outside).toEqual([]);
  await page.fill('#unsigned-xdr', 'malformed');
  await expect(page.locator('#preview-result')).toBeHidden();
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('could not be read');
  await page.click('#clear-xdr');
  await expect(page.locator('#unsigned-xdr')).toHaveValue('');
  await expect(page.locator('#preview-result')).toBeHidden();
  expect(outside).toEqual([]);
});

test('the pinned circuit directory shows review status without contacting outside services', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/');
  await page.locator('#circuit-directory > summary').click();
  await expect(page.locator('#directory-content')).toContainText('Stellar Private Payments');
  await expect(page.locator('#directory-content')).toContainText('NOT REVIEWED');
  expect(outside).toEqual([]);
});

test('a saved proof has a transaction story and a separately labelled proof profile', async ({ page }, testInfo) => {
  await page.goto('/?example=stellar-private-payment');
  await expect(page.locator('#transaction-story')).toBeVisible();
  await expect(page.locator('#transaction-story')).toContainText('Fee charged');
  await expect(page.locator('#transaction-story')).not.toContainText('input_nullifiers');
  await page.locator('#proof-profile > summary').click();
  await expect(page.locator('#profile-content')).toContainText('NOT REVIEWED');
  await expect(page.locator('#profile-content')).toContainText('Code SHA-256');
  await expect(page.locator('#availability')).toBeHidden();
  await page.locator('#transaction-story').screenshot({ path: testInfo.outputPath('transaction-story.png'), animations: 'disabled' });
});

test('not-found results show the provider\'s history window, and no other provider is asked', async ({ page }) => {
  const asked: string[] = [];
  const outside: string[] = [];
  page.on('request', (request) => { const url = request.url(); if (!url.startsWith('http://127.0.0.1:4317/') && !url.startsWith('https://soroban-testnet.stellar.org/') && !url.startsWith('blob:')) outside.push(url); });
  await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
    const payload = route.request().postDataJSON() as { method: string };
    asked.push(payload.method);
    const result = payload.method === 'getNetwork' ? { passphrase: Networks.TESTNET } : payload.method === 'getHealth' ? { oldestLedger: 100, latestLedger: 200, ledgerRetentionWindow: 101 } : { status: 'NOT_FOUND' };
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await page.goto('/');
  await page.locator('#network-settings > summary').click();
  await page.locator('#lookup-network input[value="stellar-testnet"]').check();
  await page.fill('#lookup-text', `https://stellar.expert/explorer/testnet/tx/${'a'.repeat(64)}`);
  await page.click('#lookup');
  await expect(page.locator('#availability')).toContainText('ledgers 100–200');
  await expect(page.locator('#availability')).toContainText('not a proof failure');
  expect(asked).toContain('getHealth');
  expect(outside).toEqual([]);
});

test('new panels fit a narrow mobile screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await page.locator('#before-sign > summary').click();
  await page.fill('#unsigned-xdr', unsigned);
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('Requested actions');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
