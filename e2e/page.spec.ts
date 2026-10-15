import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string): string => join(root, 'tests/fixtures', name);
const validText = readFileSync(fixture('semaphore-v4-valid.json'), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-e2e-'));
const temp = (name: string, content: string | Uint8Array): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const tampered = (): string => {
  const raw = JSON.parse(validText) as { nullifier: string };
  raw.nullifier = (BigInt(raw.nullifier) + 1n).toString();
  return JSON.stringify(raw);
};
const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8' });

test.beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root });
});

/** Fails the test if the page talks to any other origin or reports an error. */
async function open(page: Page): Promise<string[]> {
  const problems: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('http://127.0.0.1:4317/') && !url.startsWith('blob:')) problems.push(`request to ${url}`);
  });
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  await page.goto('/');
  await expandAll(page);
  return problems;
}
/** File checks and the full report sit in collapsed sections; these tests use them directly. */
async function expandAll(page: Page): Promise<void> {
  for (const id of ['advanced-tools', 'technical-details']) await page.locator(`#${id}`).evaluate((element) => ((element as HTMLDetailsElement).open = true));
}

const outcome = (page: Page) => page.locator('#report');

test('checks a valid proof and shows every section of the report', async ({ page }) => {
  const problems = await open(page);
  await page.setInputFiles('#proof-file', fixture('semaphore-v4-valid.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['Claim', 'Someone knew the secret behind a membership commitment', 'Hidden by the proof', 'Public', 'PASSED using snarkjs 0.7.6 and ark-groth16 0.6.0, two independent verifiers that agree.', 'NOT REVIEWED.', 'Application checks not performed', 'Whether this nullifier has been used before.', 'Limits', 'This result assumes', 'fixture message']) {
    expect(text).toContain(expected);
  }
  await expect(page.locator('#download')).toBeVisible();
  expect(problems).toEqual([]);
});

test('shows no claim for a rejected proof', async ({ page }) => {
  const problems = await open(page);
  await page.fill('#proof-text', tampered());
  await page.click('#check');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'invalid');
  const text = await page.locator('#sections').innerText();
  expect(text).toContain('None. The verifier rejected this proof');
  expect(text).toContain('FAILED using snarkjs 0.7.6 and ark-groth16 0.6.0, two independent verifiers that agree.');
  expect(text).not.toContain('Someone knew the secret');
  expect(text).not.toContain('PASSED');
  expect(problems).toEqual([]);
});

test('says an unsupported file was not checked, and treats its content as text', async ({ page }) => {
  const problems = await open(page);
  await page.fill('#proof-text', '{"<img src=x onerror=alert(1)>":"<b>PASSED</b>"}');
  await page.click('#check');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'unsupported');
  const text = await page.locator('#sections').innerText();
  expect(text).toContain('Not checked');
  expect(text).toContain('This says nothing about whether a proof is valid.');
  expect(text).not.toContain('PASSED');
  expect(await page.locator('#sections img, #sections b').count()).toBe(0);
  expect(problems).toEqual([]);
});

test('recovers after a bad input and checks the next proof', async ({ page }) => {
  const problems = await open(page);
  // A file that is not text is read as a binary proof, as the command line reads it.
  await page.setInputFiles('#proof-file', temp('binary.json', Buffer.from([0xff, 0xfe, 0x00])));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'unsupported');
  await expect(page.locator('#sections')).toContainText('this is a binary proof, which needs its own public inputs file and verification key file');
  await page.setInputFiles('#proof-file', fixture('semaphore-v4-valid-depth10.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('tree depth: 10');
  expect(problems).toEqual([]);
});

test('makes the same report as the command line, and each can rerun the other', async ({ page }, info) => {
  const problems = await open(page);
  await page.setInputFiles('#proof-file', fixture('semaphore-v4-valid.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-${info.project.name}.json`);
  await saved.saveAs(fromPage);

  const fromCli = join(dir, `cli-${info.project.name}.json`);
  expect(cli('check', fixture('semaphore-v4-valid.json'), '--export', fromCli).status).toBe(0);
  expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));

  const rerunByCli = cli('rerun', fromPage);
  expect(rerunByCli.status).toBe(0);
  expect(rerunByCli.stdout).toMatch(/^REPRODUCED/);

  await page.setInputFiles('#export-file', fromCli);
  await expect(page.locator('#rerun-result')).toContainText('REPRODUCED: checking the proof again gave the same report');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  expect(problems).toEqual([]);
});

for (const system of ['groth16-bn128', 'groth16-bls12381', 'plonk-bn128', 'fflonk-bn128']) {
  test(`checks a ${system} proof with its own key, the same as the command line`, async ({ page }, info) => {
    const problems = await open(page);
    const part = (kind: string): string => fixture(`snarkjs/${system}.${kind}.json`);
    await page.setInputFiles('#proof-file', part('proof'));
    // On its own the proof is not checked, and is not called invalid.
    await expect(outcome(page)).toHaveAttribute('data-outcome', 'unsupported');
    await page.setInputFiles('#public-file', part('public'));
    await expect(page.locator('#sections')).toContainText('needs both');
    await page.setInputFiles('#key-file', part('key'));
    await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
    const text = await page.locator('#sections').innerText();
    for (const expected of ['This tool does not know what that circuit checks.', 'public input 1: 33', 'against the verification key supplied with the proof', 'NOT REVIEWED.', 'A key can be made for a circuit that accepts anything.']) {
      expect(text).toContain(expected);
    }
    expect(text).not.toContain('membership');
    expect(text).toContain('Verification key');
    expect(text).toContain('Not recognised.');

    const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
    const fromPage = join(dir, `page-${system}-${info.project.name}.json`);
    await saved.saveAs(fromPage);
    const fromCli = join(dir, `cli-${system}-${info.project.name}.json`);
    expect(cli('check', part('proof'), '--public', part('public'), '--key', part('key'), '--export', fromCli).status).toBe(0);
    expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));
    expect(cli('rerun', fromPage).stdout).toMatch(/^REPRODUCED/);
    await page.setInputFiles('#export-file', fromCli);
    await expect(page.locator('#rerun-result')).toContainText('REPRODUCED');
    expect(problems).toEqual([]);
  });
}

test('recognises a supplied key that is on record, the same as the command line', async ({ page }) => {
  const problems = await open(page);
  const part = (kind: string): string => fixture(`snarkjs/semaphore-v4-depth3.${kind}.json`);
  await page.setInputFiles('#public-file', part('public'));
  await page.setInputFiles('#key-file', part('key'));
  await page.setInputFiles('#proof-file', part('proof'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['Recognised: an exact match to a recorded key', 'tree depth 3', 'Tied to that circuit source: Partly established.', 'This record: NOT REVIEWED.', 'which this report does not apply']) {
    expect(text).toContain(expected);
  }
  expect(text).not.toContain('nullifier');
  const fromCli = cli('check', part('proof'), '--public', part('public'), '--key', part('key')).stdout;
  for (const line of fromCli.split('\n').filter((entry) => entry.startsWith('  - '))) expect(text).toContain(line.slice(4));
  expect(problems).toEqual([]);
});

test('explains a proof whose recorded key has an explanation, the same as the command line', async ({ page }, info) => {
  const problems = await open(page);
  const files = { proof: fixture('snarkjs/proof-of-twitter.proof.json'), publicInputs: fixture('snarkjs/proof-of-twitter.public.json'), key: join(root, 'artifacts/zk-email-proof-of-twitter/verification-key.json') };
  await page.setInputFiles('#public-file', files.publicInputs);
  await page.setInputFiles('#key-file', files.key);
  await page.setInputFiles('#proof-file', files.proof);
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['Someone had an email that carries a valid signature', 'it reads: "zktestemail"', 'Tied to that circuit source: Unconfirmed.', 'NOT REVIEWED.', 'Checks not performed', 'Whether the signing key belongs to x.com or to any other domain.', 'It shows that someone had a copy of such an email.']) {
    expect(text).toContain(expected);
  }
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-twitter-${info.project.name}.json`);
  await saved.saveAs(fromPage);
  const fromCli = join(dir, `cli-twitter-${info.project.name}.json`);
  expect(cli('check', files.proof, '--public', files.publicInputs, '--key', files.key, '--export', fromCli).status).toBe(0);
  expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));
  expect(cli('rerun', fromPage).stdout).toMatch(/^REPRODUCED/);
  expect(problems).toEqual([]);
});

test('checks a RISC Zero receipt, the same as the command line', async ({ page }, info) => {
  const problems = await open(page);
  await page.setInputFiles('#proof-file', fixture('risc-zero/nethermind-test-receipt.txt'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['A program with the image ID shown ran in the RISC Zero virtual machine', 'image ID of the program: a77e54910c792ddc3f14878f3f1360af96612408d69074e87389a215f57595b9', 'PASSED using snarkjs 0.7.6 and ark-groth16 0.6.0, two independent verifiers that agree (RISC Zero Groth16 receipt, verifier parameters version 3.0.0).', 'NOT REVIEWED.', 'This tool did not see the journal.', 'This is not a statement about Stellar or any other network.']) {
    expect(text).toContain(expected);
  }
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-risc-zero-${info.project.name}.json`);
  await saved.saveAs(fromPage);
  const fromCli = join(dir, `cli-risc-zero-${info.project.name}.json`);
  expect(cli('check', fixture('risc-zero/nethermind-test-receipt.txt'), '--export', fromCli).status).toBe(0);
  expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));
  expect(cli('rerun', fromPage).stdout).toMatch(/^REPRODUCED/);
  expect(problems).toEqual([]);
});

test('runs each example, and an example leaves earlier files out', async ({ page }) => {
  const problems = await open(page);
  // Files chosen for an earlier check are not carried into an example.
  await page.setInputFiles('#public-file', fixture('snarkjs/groth16-bn128.public.json'));
  await page.setInputFiles('#key-file', fixture('snarkjs/groth16-bn128.key.json'));
  await page.click('#example-semaphore');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('Someone knew the secret behind a membership commitment');
  expect(await page.locator('#public-file').inputValue()).toBe('');
  // The example is the same file the command line checks, byte for byte.
  expect(await page.locator('#proof-text').inputValue()).toBe(validText);

  await page.click('#example-tampered');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'invalid');
  await expect(page.locator('#sections')).toContainText('None. The verifier rejected this proof');
  await expect(page.locator('#sections')).not.toContainText('PASSED');

  await page.click('#example-risc-zero');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('PASSED using snarkjs 0.7.6 and ark-groth16 0.6.0, two independent verifiers that agree (RISC Zero Groth16 receipt');
  expect(await page.locator('#proof-text').inputValue()).toBe(readFileSync(fixture('risc-zero/nethermind-test-receipt.txt'), 'utf8'));

  await expect(page.locator('footer a')).toHaveAttribute('href', 'https://github.com/OGtev317/ZK-Proofscan');
  // Noir's files have no extension, so the pickers do not filter by one.
  await expect(page.locator('#proof-file')).not.toHaveAttribute('accept');

  await page.click('#example-noir');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('PASSED using @aztec/bb.js 5.2.1');
  await expect(page.locator('#proof-text')).toHaveAttribute('placeholder', /Binary proof file chosen \(4544 bytes\)/);

  await page.click('#example-cairo');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('PASSED using swiftness 1.0.0 (Cairo STARK proof, layout dynamic, Stone 6 format).');
  expect(problems).toEqual([]);
});

test('checks a Noir proof from its three binary files, the same as the command line', async ({ page }, info) => {
  const problems = await open(page);
  const part = (kind: string): string => fixture(`noir/multiplier-noir-recursive.${kind}`);
  await page.setInputFiles('#public-file', part('public_inputs'));
  await page.setInputFiles('#key-file', part('vk'));
  await page.setInputFiles('#proof-file', part('proof'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['PASSED using @aztec/bb.js 5.2.1, against the verification key supplied with the proof (UltraHonk on BN254, variant noir-recursive).', 'This tool does not know what that circuit checks.', 'NOT REVIEWED.']) expect(text).toContain(expected);
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-noir-${info.project.name}.json`);
  await saved.saveAs(fromPage);
  const fromCli = join(dir, `cli-noir-${info.project.name}.json`);
  expect(cli('check', part('proof'), '--public', part('public_inputs'), '--key', part('vk'), '--export', fromCli).status).toBe(0);
  expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));
  await page.setInputFiles('#export-file', fromCli);
  await expect(page.locator('#rerun-result')).toContainText('REPRODUCED');

  // The same proof with one public input changed is rejected, not left unchecked.
  const altered = readFileSync(part('public_inputs'));
  altered[31] = altered[31]! ^ 1;
  await page.setInputFiles('#public-file', temp('altered.public_inputs', altered));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'invalid');

  // A proof from Barretenberg 0.87.0, the version Stellar's UltraHonk verifier checks, is checked here too, with and without hiding.
  for (const variant of ['keccak', 'keccak-zk']) {
    const legacy = (kind: string): string => fixture(`noir-legacy/multiplier-${variant}.${kind}`);
    await page.setInputFiles('#public-file', legacy('public_inputs'));
    await page.setInputFiles('#key-file', legacy('vk'));
    await page.setInputFiles('#proof-file', legacy('proof'));
    await expect(page.locator('#sections')).toContainText(`PASSED using @aztec/bb.js 0.87.0, against the verification key supplied with the proof (UltraHonk on BN254, variant ${variant}).`);
    await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
    await expect(page.locator('#unknown')).toContainText('This proof was checked with Barretenberg 0.87.0, an older version');
  }
  // The same proof with one public input changed is rejected.
  const legacyAltered = readFileSync(fixture('noir-legacy/multiplier-keccak.public_inputs'));
  legacyAltered[31] = legacyAltered[31]! ^ 1;
  await page.setInputFiles('#key-file', fixture('noir-legacy/multiplier-keccak.vk'));
  await page.setInputFiles('#proof-file', fixture('noir-legacy/multiplier-keccak.proof'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await page.setInputFiles('#public-file', temp('legacy-altered.public_inputs', legacyAltered));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'invalid');
  await expect(page.locator('#fact-proof')).toHaveText('Failed: the verifier rejected the proof');
  // A poseidon-transcript key of this version is not one this tool reads, and is left unchecked rather than failed.
  await page.setInputFiles('#public-file', fixture('noir-legacy/multiplier-poseidon.public_inputs'));
  await page.setInputFiles('#key-file', fixture('noir-legacy/multiplier-poseidon.vk'));
  await page.setInputFiles('#proof-file', fixture('noir-legacy/multiplier-poseidon.proof'));
  await expect(outcome(page)).not.toHaveAttribute('data-outcome', 'valid');

  // Typing replaces a binary proof that was chosen.
  await page.fill('#proof-text', '{}');
  await page.click('#check');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'unsupported');
  expect(problems).toEqual([]);
});

test('checks a Cairo proof, the same as the command line, and refuses a weak one', async ({ page }, info) => {
  const problems = await open(page);
  await page.setInputFiles('#proof-file', fixture('cairo/dynamic-stone6-96-bits.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid', { timeout: 120_000 });
  await expect(page.locator('#sections')).toContainText('PASSED using swiftness 1.0.0');
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-cairo-${info.project.name}.json`);
  await saved.saveAs(fromPage);
  const fromCli = join(dir, `cli-cairo-${info.project.name}.json`);
  expect(cli('check', fixture('cairo/dynamic-stone6-96-bits.json'), '--export', fromCli).status).toBe(0);
  expect(readFileSync(fromPage, 'utf8')).toBe(readFileSync(fromCli, 'utf8'));

  await page.setInputFiles('#proof-file', fixture('cairo/starknet-stone5-70-bits.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'unsupported');
  await expect(page.locator('#sections')).toContainText('below the 80 this tool requires');
  expect(problems).toEqual([]);
});

test('notices a forged export', async ({ page }) => {
  const problems = await open(page);
  const exported = join(dir, `forge-source-${Date.now()}.json`);
  expect(cli('check', fixture('semaphore-v4-valid.json'), '--export', exported).status).toBe(0);
  const forged = JSON.parse(readFileSync(exported, 'utf8')) as { report: { claim: string; limits: string[] } };
  forged.report.claim = 'This proves the holder is a unique human.';
  forged.report.limits = [];
  await page.setInputFiles('#export-file', temp('forged.json', JSON.stringify(forged)));
  await expect(page.locator('#rerun-result')).toContainText('NOT REPRODUCED');
  await expect(page.locator('#rerun-result')).toContainText('claim, limits');
  await expect(page.locator('#sections')).not.toContainText('unique human');
  await expect(page.locator('#sections')).toContainText('Someone knew the secret');

  await page.setInputFiles('#export-file', temp('junk.json', 'junk'));
  await expect(page.locator('#rerun-result')).toContainText('Not rerun: the export is not valid JSON.');
  await expect(page.locator('#sections')).toBeEmpty();
  expect(problems).toEqual([]);
});

/** Answers the page's RPCs with recorded answers, so these tests contact no network. Any other host is refused. */
async function providers(page: Page, asked: string[]): Promise<void> {
  const sepolia = JSON.parse(readFileSync(fixture('sepolia/proof-of-twitter-mint.json'), 'utf8')) as Record<string, unknown>;
  const pool = JSON.parse(readFileSync(fixture('stellar-testnet/private-payments/answers.json'), 'utf8')) as Record<string, unknown>;
  const plainTransaction = JSON.parse(readFileSync(fixture('stellar-testnet/not-a-proof/answers.json'), 'utf8')) as Record<string, unknown>;
  const mainnet: Record<string, unknown> = { getNetwork: { passphrase: 'Public Global Stellar Network ; September 2015' }, getTransaction: { status: 'NOT_FOUND' } };
  const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' };
  await page.context().route(/^https:\/\//, async (route) => {
    const request = route.request();
    const host = new URL(request.url()).host;
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const { id, method, params } = request.postDataJSON() as { id: number; method: string; params: { keys?: string[]; hash?: string } };
    // Stellar testnet answers for the pool transaction and the contract-creating one, and knows no other.
    const testnet = params.hash === undefined || params.hash === (pool.getTransaction as { txHash: string }).txHash ? pool : params.hash === (plainTransaction.getTransaction as { txHash: string }).txHash ? plainTransaction : { ...pool, getTransaction: { status: 'NOT_FOUND' } };
    const answers = host === 'sepolia.drpc.org' ? sepolia : host === 'soroban-testnet.stellar.org' ? testnet : host === 'mainnet.sorobanrpc.com' ? mainnet : undefined;
    if (answers === undefined) return route.abort();
    asked.push(`${host} ${method}`);
    const answer = answers[method] as Record<string, unknown> | undefined;
    const result = method === 'getLedgerEntries' && answer !== undefined && !('entries' in answer) ? answer[params.keys![0]!] : answer;
    return route.fulfill({ status: 200, headers, contentType: 'application/json', body: JSON.stringify({ jsonrpc: '2.0', id, result }) });
  });
}
/** Like `open`, but the page may also ask the named RPCs. */
async function openWithProviders(page: Page, asked: string[], path = '/'): Promise<string[]> {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console error: ${message.text()}`);
  });
  await providers(page, asked);
  await page.goto(path);
  return problems;
}

test('looks up a transaction from an explorer link, explains it, and can share it', async ({ page }, info) => {
  const asked: string[] = [];
  const problems = await openWithProviders(page, asked);
  await expect(page.locator('#lookup-note')).toContainText('Checking sends the transaction hash to sepolia.drpc.org');
  await page.click('#example-lookup');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  expect(asked).toEqual(['sepolia.drpc.org eth_chainId', 'sepolia.drpc.org eth_getTransactionByHash', 'sepolia.drpc.org eth_getTransactionReceipt']);
  await expect(page.locator('#plain')).toContainText('The proof is valid: snarkjs and ark-groth16, two independent verifiers, both accept it. What it shows: Someone had an email');
  await expect(page.locator('#plain')).toContainText('on Ethereum Sepolia (a test network), according to sepolia.drpc.org; the network accepted that transaction');
  await expect(page.locator('#source')).toContainText('Transaction 0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787 on sepolia');
  // The reader's view: both verdicts side by side, what it proves, what it does not.
  await expect(page.locator('#fact-status')).toHaveText('Succeeded');
  await expect(page.locator('#status-note')).toContainText('As reported by sepolia.drpc.org');
  await expect(page.locator('#fact-proof')).toHaveText('Passed: two independent verifiers agree');
  await expect(page.locator('#proves')).toContainText('Someone had an email that carries a valid signature');
  await expect(page.locator('#unknown li').first()).toContainText('About the key:');
  await expect(page.locator('#unknown')).toContainText('The explanation wording has not been reviewed by a qualified person.');
  expect(new URL(page.url()).search).toBe('?network=sepolia&tx=0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787');

  // The export carries where the proof was found, and the command line reruns it.
  const [saved] = await Promise.all([page.waitForEvent('download'), page.click('#download')]);
  const fromPage = join(dir, `page-lookup-${info.project.name}.json`);
  await saved.saveAs(fromPage);
  expect(JSON.parse(readFileSync(fromPage, 'utf8')).source).toMatchObject({ kind: 'evm-transaction', chain: 'sepolia', provider: 'sepolia.drpc.org' });
  const rerun = cli('rerun', fromPage);
  expect(rerun.stdout).toMatch(/^REPRODUCED/);
  expect(rerun.stdout).toContain('Source recorded in the export');
  await expect(page.locator('#share')).toBeVisible();
  expect(problems).toEqual([]);
});

test('switches to Stellar from a pasted link and checks a private payment', async ({ page }) => {
  const asked: string[] = [];
  const problems = await openWithProviders(page, asked);
  await page.fill('#lookup-text', 'https://stellar.expert/explorer/testnet/tx/cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc');
  await expect(page.locator('input[name="family"][value="stellar"]')).toBeChecked();
  await expect(page.locator('#lookup-network input[value="stellar-testnet"]')).toBeChecked();
  await expect(page.locator('#lookup-note')).toContainText('soroban-testnet.stellar.org');
  await page.click('#lookup');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#plain')).toContainText('It was made for a circuit this tool has on record: Stellar Private Payments (Nethermind), testnet key.');
  await expect(page.locator('#source')).toContainText('the verifier the called contract names');
  expect(asked.filter((entry) => entry.endsWith('getLedgerEntries'))).toHaveLength(3);
  expect(problems).toEqual([]);
});

test('looks up a shared link as it opens, and sends nothing for what it cannot read', async ({ page }) => {
  const asked: string[] = [];
  const problems = await openWithProviders(page, asked, '/?network=sepolia&tx=0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#lookup-network input[value="sepolia"]')).toBeChecked();
  const before = asked.length;
  for (const pasted of ['not a hash', 'https://example.com/tx/0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787']) {
    await page.fill('#lookup-text', pasted);
    await page.click('#lookup');
    await expect(page.locator('#plain')).toContainText('This proof was not checked: that is not a transaction hash or a block explorer link to a transaction.');
    await expect(page.locator('#share')).toBeHidden();
  }
  // A Stellar hash while Ethereum is chosen switches to Stellar rather than asking an Ethereum RPC.
  await page.fill('#lookup-text', 'cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc');
  await expect(page.locator('input[name="family"][value="stellar"]')).toBeChecked();
  expect(asked.length).toBe(before);
  expect(problems).toEqual([]);
});

test('describes a transaction with no proof instead of calling it an error, and Enter checks', async ({ page }) => {
  const asked: string[] = [];
  const problems = await openWithProviders(page, asked);
  await page.fill('#lookup-text', 'https://stellar.expert/explorer/testnet/tx/294424f4b8818140ecf48e587bac0d9185ee3638f4a769de84dd3a49de1044bb');
  await page.press('#lookup-text', 'Enter');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'no-proof');
  await expect(page.locator('#plain')).toContainText('This is a transaction on the Stellar test network: creating a smart contract. According to soroban-testnet.stellar.org, the network accepted it. No zero-knowledge proof that this tool can read was found in it');
  await expect(page.locator('#fact-status')).toHaveText('Succeeded');
  await expect(page.locator('#fact-proof')).toHaveText('No supported proof found');
  await expect(page.locator('#unknown-block')).toBeHidden();
  await expect(page.locator('#facts')).toContainText('GAYU5HRTJPRGF4BFKI4BXRLFBEKAMK5BF5L6VTNERKA3P42SN2Y5EJ46');
  await expect(page.locator('#download')).toBeHidden();
  expect(asked).toEqual(['soroban-testnet.stellar.org getNetwork', 'soroban-testnet.stellar.org getTransaction']);
  expect(problems).toEqual([]);
});

test('tries a bare Stellar hash on testnet, then mainnet, and says so first', async ({ page }) => {
  const asked: string[] = [];
  const problems = await openWithProviders(page, asked);
  await page.fill('#lookup-text', 'ab'.repeat(32));
  await expect(page.locator('#lookup-note')).toContainText('soroban-testnet.stellar.org, then, if it is not found there, to mainnet.sorobanrpc.com');
  await expect(page.locator('#network-summary')).toHaveText('Stellar testnet, then mainnet');
  await page.click('#lookup');
  await expect(page.locator('#plain')).toContainText('the provider has no such transaction on stellar-mainnet');
  expect(asked).toEqual(['soroban-testnet.stellar.org getNetwork', 'soroban-testnet.stellar.org getTransaction', 'mainnet.sorobanrpc.com getNetwork', 'mainnet.sorobanrpc.com getTransaction']);
  expect(problems).toEqual([]);
});

test('replays a saved example without contacting any network, and says so', async ({ page }) => {
  const problems = await open(page);
  // `open` fails the test if anything outside the page's own address is requested.
  await page.click('#saved-stellar-private-payment');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#recorded-note')).toContainText('Saved example. The provider\'s answers were recorded on 2026-10-14 and replayed here; nothing was fetched now.');
  await expect(page.locator('#fact-proof')).toHaveText('Passed: two independent verifiers agree');
  await expect(page.locator('#unknown li').first()).toContainText('About the key:');
  expect(new URL(page.url()).search).toBe('?example=stellar-private-payment');

  // The Stellar Noir proof, checked with Barretenberg 0.87.0 in the page.
  await page.click('#saved-stellar-noir');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#sections')).toContainText('PASSED using @aztec/bb.js 0.87.0');
  await expect(page.locator('#source')).toContainText('nethermind-ultrahonk.verify-proof');

  await page.click('#saved-stellar-no-proof');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'no-proof');
  await expect(page.locator('#plain')).toContainText('creating a smart contract');

  // A live lookup afterwards carries no saved-example banner.
  await page.click('#saved-stellar-private-payment');
  await expect(page.locator('#recorded-note')).toBeVisible();
  expect(problems).toEqual([]);
});

test('opens a shared link to a saved example', async ({ page }) => {
  const problems: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4317/') && !request.url().startsWith('blob:')) problems.push(`request to ${request.url()}`);
  });
  await page.goto('/?example=stellar-private-payment');
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  await expect(page.locator('#recorded-note')).toBeVisible();
  expect(problems).toEqual([]);
});
