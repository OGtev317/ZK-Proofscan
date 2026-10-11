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
const temp = (name: string, content: string): string => {
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
  return problems;
}

const outcome = (page: Page) => page.locator('#report');

test('checks a valid proof and shows every section of the report', async ({ page }) => {
  const problems = await open(page);
  await page.setInputFiles('#proof-file', fixture('semaphore-v4-valid.json'));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'valid');
  const text = await page.locator('#sections').innerText();
  for (const expected of ['Claim', 'Someone knew the secret behind a membership commitment', 'Hidden by the proof', 'Public', 'PASSED using snarkjs 0.7.6.', 'NOT REVIEWED.', 'Application checks not performed', 'Whether this nullifier has been used before.', 'Limits', 'This result assumes', 'fixture message']) {
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
  expect(text).toContain('FAILED using snarkjs 0.7.6.');
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
  await page.setInputFiles('#proof-file', temp('binary.json', Buffer.from([0xff, 0xfe, 0x00]) as never));
  await expect(outcome(page)).toHaveAttribute('data-outcome', 'error');
  await expect(page.locator('#download')).toBeHidden();
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
