import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import * as library from '../src/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
afterAll(() => library.stop());

describe('the library interface', () => {
  it('offers the documented functions, and checks a proof as the command line does', async () => {
    for (const name of ['checkProof', 'checkFiles', 'lookUp', 'rerun', 'stop', 'explain', 'plainWords', 'renderReport', 'writeExport', 'readTransactionReference', 'explorerLinks']) {
      expect(typeof (library as Record<string, unknown>)[name], name).toBe('function');
    }
    expect(library.TOOL).toEqual({ name: 'lumenlenz', version: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version });
    const report = await library.checkProof({ proof: readFileSync(join(root, 'tests/fixtures/semaphore-v4-valid.json'), 'utf8') });
    expect(report.outcome).toBe('valid');
    expect(library.explain({ report }).proofCheck.text).toBe('Passed: two independent verifiers agree');
    // A bare hash with no network sends nothing and says why.
    expect(await library.lookUp(`0x${'ab'.repeat(32)}`, { env: {} })).toEqual({ kind: 'not-checked', reason: 'a hash on its own does not say which network it is on; name the network' });
  });
});
