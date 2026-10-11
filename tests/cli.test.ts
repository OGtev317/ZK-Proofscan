import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { plus, text, validText } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-'));
const file = (name: string, content: string): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 60_000 });

describe('command line', () => {
  it('exits 0 for a valid proof and names what was not checked', () => {
    const result = cli('check', file('valid.json', validText));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Cryptographic verification: PASSED/);
    expect(result.stdout).toMatch(/snarkjs 0\.7\.6/);
    expect(result.stdout).toMatch(/^Claim: Someone knew the secret/);
    expect(result.stdout).toMatch(/Application checks not performed:/);
    expect(result.stdout).toMatch(/NOT REVIEWED/);
  });

  it('exits 1 for a proof the verifier rejects', () => {
    const result = cli('check', file('tampered.json', text((raw) => { raw.nullifier = plus(raw.nullifier, 1n); })));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAILED/);
    expect(result.stdout).toMatch(/Claim: None/);
  });

  it('exits 2 for an unsupported file without calling it invalid', () => {
    const result = cli('check', file('other.json', '{"proof":"0x7a2f"}'));
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/not a supported proof file/);
    expect(result.stdout).not.toMatch(/FAILED|PASSED/);
  });

  it('exits 3 when the file cannot be read', () => {
    const result = cli('check', join(dir, 'missing.json'));
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/could not be completed/);
    // A file that is not text is read as bytes, and is then not a supported proof.
    expect(cli('check', file('binary.json', Buffer.from([0xff, 0xfe, 0x00]) as never)).status).toBe(2);
  });

  it('reports the SHA-256 of the exact file, and refuses a byte-order mark', () => {
    const path = file('hash.json', validText);
    const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
    expect(JSON.parse(cli('check', '--json', path).stdout).input.sha256).toBe(digest);
    const marked = cli('check', '--json', file('bom.json', `\ufeff${validText}`));
    expect(marked.status).toBe(2);
    expect(JSON.parse(marked.stdout).input.sha256).toBe(createHash('sha256').update(`\ufeff${validText}`).digest('hex'));
  });

  it('answers in JSON when asked, including when nothing could be checked', () => {
    const missing = cli('check', '--json', join(dir, 'missing.json'));
    expect(missing.status).toBe(3);
    expect(JSON.parse(missing.stdout)).toMatchObject({ outcome: 'error', message: expect.stringMatching(/could not read the file/) });
    const huge = cli('check', '--json', file('huge.json', 'x'.repeat(3_000_000)));
    expect(huge.status).toBe(2);
    expect(JSON.parse(huge.stdout)).toMatchObject({ outcome: 'unsupported', reason: 'the file is too large' });
    const junk = cli('check', '--json', file('junk2.json', 'junk'));
    expect(junk.status).toBe(2);
    expect(JSON.parse(junk.stdout)).toMatchObject({ outcome: 'unsupported' });
  });

  it('writes the same result as JSON', () => {
    const result = cli('check', '--json', file('valid2.json', validText));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: 'valid',
      verification: { result: 'passed', verifier: { name: 'snarkjs', version: '0.7.6' } },
      applicationChecks: [{ id: 'group-root-accepted', status: 'not-performed' }, { id: 'nullifier-unused', status: 'not-performed' }],
    });
  });

  it('exports a report that another run reproduces, and notices a forged one', () => {
    const exported = join(dir, 'evidence.json');
    expect(cli('check', file('valid3.json', validText), '--export', exported).status).toBe(0);
    expect(cli('check', file('valid4.json', validText), '--export', exported).status).toBe(3);

    const again = cli('rerun', exported);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^REPRODUCED/);

    const forged = JSON.parse(readFileSync(exported, 'utf8'));
    forged.report.limits = [];
    const refused = cli('rerun', file('forged.json', JSON.stringify(forged)));
    expect(refused.status).toBe(1);
    expect(refused.stdout).toMatch(/NOT REPRODUCED/);
    expect(refused.stdout).toMatch(/Sections that differ: limits/);

    expect(cli('rerun', file('junk.json', 'junk')).status).toBe(2);
    expect(cli('rerun', join(dir, 'absent.json')).status).toBe(3);
  });

  it('exits 64 on wrong usage', () => {
    expect(cli().status).toBe(64);
    expect(cli('check').status).toBe(64);
    expect(cli('check', 'a.json', 'b.json').status).toBe(64);
    expect(cli('check', 'a.json', '--verbose').status).toBe(64);
    expect(cli('rerun', 'a.json', '--json').status).toBe(64);
    expect(cli('a.json').status).toBe(64);
  });
});
