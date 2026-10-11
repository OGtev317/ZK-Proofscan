import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { plus, text, validText } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-'));
const file = (name: string, content: string): string => {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
};
const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 60_000 });

beforeAll(() => {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json'], { cwd: root });
}, 120_000);

describe('command line', () => {
  it('exits 0 for a valid proof and names what was not checked', () => {
    const result = cli(file('valid.json', validText));
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Cryptographic verification: PASSED/);
    expect(result.stdout).toMatch(/snarkjs 0\.7\.6/);
    expect(result.stdout).toMatch(/Not checked: whether any application accepts this group root/);
  });

  it('exits 1 for a proof the verifier rejects', () => {
    const result = cli(file('tampered.json', text((raw) => { raw.nullifier = plus(raw.nullifier, 1n); })));
    expect(result.status).toBe(1);
    expect(result.stdout).toMatch(/FAILED/);
  });

  it('exits 2 for an unsupported file without calling it invalid', () => {
    const result = cli(file('other.json', '{"proof":"0x7a2f"}'));
    expect(result.status).toBe(2);
    expect(result.stdout).toMatch(/not a supported proof file/);
    expect(result.stdout).not.toMatch(/FAILED|PASSED/);
  });

  it('exits 3 when the file cannot be read', () => {
    const result = cli(join(dir, 'missing.json'));
    expect(result.status).toBe(3);
    expect(result.stdout).toMatch(/could not be completed/);
    expect(cli(file('binary.json', Buffer.from([0xff, 0xfe, 0x00]) as never)).status).toBe(3);
  });

  it('writes the same result as JSON', () => {
    const result = cli('--json', file('valid2.json', validText));
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: 'valid', format: 'semaphore-v4', verifier: { name: 'snarkjs', version: '0.7.6' } });
  });

  it('exits 64 on wrong usage', () => {
    expect(cli().status).toBe(64);
    expect(cli('a.json', 'b.json').status).toBe(64);
  });
});
