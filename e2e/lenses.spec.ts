import { Account, Address, Contract, nativeToScVal, Networks, StrKey, TransactionBuilder } from '@stellar/stellar-base';
import { expect, test } from '@playwright/test';

const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const unsigned = new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(new Contract(TOKEN).call('approve', Address.fromString(USER).toScVal(), Address.fromString(USER).toScVal(), nativeToScVal(100n, { type: 'i128' }), nativeToScVal(5000, { type: 'u32' }))).setTimeout(300).build().toXDR();

test('local inspection is offline, cannot simulate without consent, and clears stale state', async ({ page }) => {
  const outside: string[] = [];
  page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:4317/')) outside.push(request.url()); });
  await page.goto('/');
  await page.locator('#before-sign > summary').click();
  await page.fill('#unsigned-xdr', unsigned);
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('Requested actions');
  await expect(page.locator('#preview-result')).toContainText('spending permission');
  await expect(page.locator('#simulate-xdr')).toBeDisabled();
  expect(outside).toEqual([]);
  await page.check('#simulation-consent');
  await expect(page.locator('#simulate-xdr')).toBeEnabled();
  await page.fill('#unsigned-xdr', 'malformed');
  await expect(page.locator('#simulate-xdr')).toBeDisabled();
  await expect(page.locator('#preview-result')).toBeHidden();
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('could not be read');
  await page.click('#clear-xdr');
  await expect(page.locator('#unsigned-xdr')).toHaveValue('');
  await expect(page.locator('#preview-result')).toBeHidden();
  expect(outside).toEqual([]);
});

test('simulation sends only after consent and never signs or submits', async ({ page }) => {
  const asked: string[] = [];
  await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
    const payload = route.request().postDataJSON() as { method: string; params: Record<string, unknown> };
    asked.push(payload.method);
    if (payload.method === 'simulateTransaction') {
      expect(payload.params).toMatchObject({ transaction: unsigned, authMode: 'record' });
    }
    const result = payload.method === 'getNetwork' ? { passphrase: Networks.TESTNET } : { latestLedger: 123, minResourceFee: '456', results: [{ auth: [] }], stateChanges: [] };
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await page.goto('/');
  await page.locator('#before-sign > summary').click();
  await page.fill('#unsigned-xdr', unsigned);
  await page.click('#inspect-xdr');
  await expect(page.locator('#preview-result')).toContainText('Requested actions');
  expect(asked).toEqual([]);
  await page.check('#simulation-consent');
  await page.click('#simulate-xdr');
  await expect(page.locator('#simulation-result')).toContainText('Prediction only');
  await expect(page.locator('#simulation-result')).toContainText('456 stroops');
  expect(asked).toEqual(['getNetwork', 'simulateTransaction']);
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

test('not-found results show the actual provider window and never contact the archive by default', async ({ page }) => {
  const asked: string[] = [];
  const archive: string[] = [];
  await page.route('https://soroban-testnet.stellar.org/**', async (route) => {
    const payload = route.request().postDataJSON() as { method: string };
    asked.push(payload.method);
    const result = payload.method === 'getNetwork' ? { passphrase: Networks.TESTNET } : payload.method === 'getHealth' ? { oldestLedger: 100, latestLedger: 200, ledgerRetentionWindow: 101 } : { status: 'NOT_FOUND' };
    await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
  });
  await page.route('https://archive-rpc.lightsail.network/**', async (route) => { archive.push(route.request().url()); await route.abort(); });
  await page.goto('/');
  await page.locator('#network-settings > summary').click();
  await page.locator('#lookup-network input[value="stellar-testnet"]').check();
  await page.fill('#lookup-text', `https://stellar.expert/explorer/testnet/tx/${'a'.repeat(64)}`);
  await page.click('#lookup');
  await expect(page.locator('#availability')).toContainText('ledgers 100–200');
  await expect(page.locator('#availability')).toContainText('not a proof failure');
  expect(asked).toContain('getHealth');
  expect(archive).toEqual([]);
});

test('archive fallback requires consent and does not mix the providers', async ({ page }) => {
  const providers: string[] = [];
  for (const host of ['mainnet.sorobanrpc.com', 'archive-rpc.lightsail.network']) {
    await page.route(`https://${host}/**`, async (route) => {
      providers.push(host);
      const { method } = route.request().postDataJSON() as { method: string };
      const result = method === 'getNetwork' ? { passphrase: Networks.PUBLIC } : method === 'getHealth' ? { oldestLedger: host.startsWith('archive') ? 1 : 100, latestLedger: 200 } : { status: 'NOT_FOUND' };
      await route.fulfill({ json: { jsonrpc: '2.0', id: 1, result } });
    });
  }
  await page.goto('/');
  await page.locator('#network-settings > summary').click();
  await page.locator('#lookup-network input[value="stellar-mainnet"]').check();
  await page.locator('.archive-settings > summary').click();
  await page.check('#archive-opt-in');
  await page.fill('#lookup-text', 'a'.repeat(64));
  await page.click('#lookup');
  await expect(page.locator('#availability')).toContainText('archive-rpc.lightsail.network');
  await expect(page.locator('#availability')).toContainText('ledgers 1–200');
  expect(providers).toContain('mainnet.sorobanrpc.com');
  expect(providers).toContain('archive-rpc.lightsail.network');
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
