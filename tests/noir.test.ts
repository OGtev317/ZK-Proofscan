import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { rerunExport, writeExport } from '../src/export.js';
import { binaryBytes, binaryPart, isBinaryPart, partBytes, type ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { AZTEC_CRS_SHA256, BB_JS_VERSION, bbJsEngine } from '../src/node/noir-engine.js';
import { bbJsEngine as bbJsEngine_, type BbJsModule } from '../src/noir/bb-engine.js';
import { stopEngines } from '../src/node/stop.js';
import { ULTRAHONK_VARIANTS, verifyUltraHonk, type UltraHonkEngine } from '../src/noir/verify.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';
import { SCALAR_FIELD } from '../src/field.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (variant: string) => ({
  proof: join(root, `tests/fixtures/noir/multiplier-${variant}.proof`),
  publicInputs: join(root, `tests/fixtures/noir/multiplier-${variant}.public_inputs`),
  verificationKey: join(root, `tests/fixtures/noir/multiplier-${variant}.vk`),
});
const load = (variant: string): Required<ProofInputs> => {
  const paths = at(variant);
  return { proof: binaryPart(readFileSync(paths.proof)), publicInputs: binaryPart(readFileSync(paths.publicInputs)), verificationKey: binaryPart(readFileSync(paths.verificationKey)) };
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopEngines);

const flipped = (part: string, index: number): string => {
  const bytes = Uint8Array.from(binaryBytes(part)!);
  bytes[index]! ^= 1;
  return binaryPart(bytes);
};
const word = (value: bigint): Uint8Array => Uint8Array.from(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));

describe('binary files as parts of a check', () => {
  it('carries bytes exactly, in one spelling only', () => {
    const bytes = Uint8Array.from({ length: 70_000 }, (_, i) => (i * 31) % 256);
    const part = binaryPart(bytes);
    expect(isBinaryPart(part)).toBe(true);
    expect(binaryBytes(part)).toEqual(bytes);
    expect(partBytes(part)).toEqual(bytes);
    expect(partBytes('{"a":1}')).toEqual(new TextEncoder().encode('{"a":1}'));
    // Text that only looks like a binary part stands for its own characters.
    for (const odd of ['base64:not base64!', 'base64:AAA', 'base64:AB==', 'base64:AAAA\n']) {
      expect(binaryBytes(odd), odd).toBeUndefined();
      expect(partBytes(odd)).toEqual(new TextEncoder().encode(odd));
    }
    expect(binaryBytes('base64:AA==')).toEqual(Uint8Array.from([0]));
  });
});

describe('Noir proofs (UltraHonk, made by Barretenberg)', () => {
  it('pins the verifier version and the setup files it is given', () => {
    expect(JSON.parse(readFileSync(join(root, 'node_modules/@aztec/bb.js/package.json'), 'utf8')).version).toBe(BB_JS_VERSION);
    expect(bbJsEngine.identity).toEqual({ name: '@aztec/bb.js', version: BB_JS_VERSION });
    for (const [name, expected] of Object.entries(AZTEC_CRS_SHA256)) expect(sha256(readFileSync(join(root, 'artifacts/aztec-crs', name))), name).toBe(expected);
  });

  it.each(ULTRAHONK_VARIANTS)('accepts a real proof made as %s and says only what a supplied key supports', async (variant) => {
    const good = load(variant);
    const report = await check(good);
    if (report.outcome !== 'valid' || report.basis !== 'supplied-key') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.publicInputs).toEqual(['11', '33']);
    expect(report.verification).toMatchObject({ result: 'passed', verifier: { name: '@aztec/bb.js', version: BB_JS_VERSION }, proofSystem: { protocol: 'ultrahonk', curve: 'bn128', variant } });
    // Hashes are of the files' exact bytes.
    expect(report.input.sha256).toBe(sha256(readFileSync(at(variant).proof)));
    expect(report.verification.verificationKeySha256).toBe(sha256(readFileSync(at(variant).verificationKey)));
    expect(report.verification.publicInputsSha256).toBe(sha256(readFileSync(at(variant).publicInputs)));
    expect(report.keyRecognition).toEqual({ match: 'none' });
    const shown = renderReport(report);
    expect(shown).toContain(`PASSED using @aztec/bb.js ${BB_JS_VERSION}, against the verification key supplied with the proof (UltraHonk on BN254, variant ${variant}).`);
    expect(shown).toContain('This tool does not know what that circuit checks.');
    expect(shown).toContain('A key can be made for a circuit that accepts anything.');
    expect(shown).toContain('UltraHonk proofs and keys change between versions of Barretenberg.');
    expect(shown).toContain('NOT REVIEWED');
  });

  it('uses no network: nothing is fetched while a proof is checked', async () => {
    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      asked.push(String(input));
      throw new Error('no network in this test');
    }) as typeof fetch;
    try {
      expect((await check(load('evm'))).outcome).toBe('valid');
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toEqual([]);
  });

  it('rejects a proof after a change to the proof, a public input or the key', async () => {
    const good = load('evm');
    const proofBytes = binaryBytes(good.proof)!.length;
    for (let index = 0; index < proofBytes; index += 151) {
      const report = await check({ ...good, proof: flipped(good.proof, index) });
      expect(report.outcome, `proof byte ${index}`).toBe('invalid');
      expect(report).not.toHaveProperty('claim');
    }
    // Measured: the verifier does not read the first 24 bytes of a key's three opening
    // numbers. A key with anything there is refused, so no change to a key goes unnoticed.
    const keyBytes = binaryBytes(good.verificationKey)!.length;
    for (const index of [0, 23, 32, 55, 64, 87]) {
      expect(await check({ ...good, verificationKey: flipped(good.verificationKey, index) }), `key byte ${index}`).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/three small numbers/) });
    }
    for (const index of [24, 31, 56, 63, 88, 95, 96, 200, 777, 1500, keyBytes - 1]) {
      expect((await check({ ...good, verificationKey: flipped(good.verificationKey, index) })).outcome, `key byte ${index}`).toBe('invalid');
    }
    const rejected = await check({ ...good, publicInputs: binaryPart(Uint8Array.from([...word(11n), ...word(34n)])) });
    expect(rejected).toMatchObject({ outcome: 'invalid', basis: 'supplied-key', publicInputs: ['11', '34'], verification: { result: 'failed', proofSystem: { protocol: 'ultrahonk' } } });
    expect(rejected).not.toHaveProperty('verification.proofSystem.variant');
    expect(renderReport(rejected)).toMatch(/^Claim: None/);
  }, 240_000);

  it('does not verify a proof under another variant\'s key, or another circuit\'s inputs', async () => {
    const evm = load('evm');
    // A key is for one hash family. With and without hiding share a key: the proof says which it is.
    expect(load('evm-no-zk').verificationKey).toBe(evm.verificationKey);
    expect(load('noir-recursive-no-zk').verificationKey).toBe(load('noir-recursive').verificationKey);
    expect(await check({ ...evm, proof: load('evm-no-zk').proof })).toMatchObject({ outcome: 'valid', verification: { proofSystem: { variant: 'evm-no-zk' } } });
    for (const other of ['noir-recursive', 'noir-recursive-no-zk']) {
      expect((await check({ ...evm, verificationKey: load(other).verificationKey })).outcome, other).toBe('invalid');
      expect((await check({ ...evm, proof: load(other).proof })).outcome, other).toBe('invalid');
    }
    // The wrong number of public inputs for the key.
    expect((await check({ ...evm, publicInputs: binaryPart(word(11n)) })).outcome).toBe('invalid');
    expect((await check({ ...evm, publicInputs: binaryPart(Uint8Array.from([...word(11n), ...word(33n), ...word(0n)])) })).outcome).toBe('invalid');
  }, 120_000);

  it('refuses files that are not the shape Barretenberg writes, without calling them invalid', async () => {
    const good = load('evm');
    const proof = binaryBytes(good.proof)!;
    for (const [change, reason] of [
      [{ proof: binaryPart(proof.subarray(0, proof.length - 1)) }, /whole number of 32-byte values/],
      [{ proof: binaryPart(new Uint8Array(0)) }, /whole number of 32-byte values/],
      [{ proof: binaryPart(new Uint8Array(64_000)) }, /whole number of 32-byte values/],
      [{ publicInputs: binaryPart(new Uint8Array(33)) }, /public inputs file is not a whole number/],
      [{ publicInputs: binaryPart(Uint8Array.from([...word(SCALAR_FIELD), ...word(33n)])) }, /not a number inside the field/],
      [{ publicInputs: binaryPart(Uint8Array.from([...word(11n + SCALAR_FIELD), ...word(33n)])) }, /not a number inside the field/],
      [{ verificationKey: binaryPart(new Uint8Array(0)) }, /key file is empty or too large/],
      [{ verificationKey: binaryPart(new Uint8Array(40)) }, /three small numbers/],
      [{ verificationKey: binaryPart(new Uint8Array(20_000)) }, /key file is empty or too large/],
    ] as [Partial<ProofInputs>, RegExp][]) {
      const report = await check({ ...good, ...change });
      expect(report).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(reason) });
    }
    // A binary proof on its own, or with half its files, is not checked.
    expect(await check({ proof: good.proof })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/binary proof, which needs its own public inputs file/) });
    expect(await check({ proof: good.proof, verificationKey: good.verificationKey })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/needs both/) });
    // A text proof with a binary key is read as snarkjs's format and refused there.
    expect(await check({ ...good, proof: '{"protocol":"groth16"}' })).toMatchObject({ outcome: 'unsupported' });
    // Where Barretenberg is not available, a binary proof is not checked rather than failed.
    const { ultraHonk: _none, ...without } = scanning;
    expect(await scan(good, without)).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/this build cannot check/) });
  });

  it('reports a verifier that could not run as an error, never as a rejected proof', async () => {
    const good = load('evm');
    const only = (variant: string): UltraHonkEngine => ({ identity: bbJsEngine.identity, verify: async (tried) => tried === variant });
    expect(await verifyUltraHonk(good, only('noir-recursive'))).toMatchObject({ status: 'valid', variant: 'noir-recursive' });
    expect(await verifyUltraHonk(good, only('none'))).toMatchObject({ status: 'invalid' });
    expect(await verifyUltraHonk(good, { identity: bbJsEngine.identity, verify: async () => { throw new Error('boom'); } })).toEqual({ status: 'error', message: 'boom' });
    // Failing for a later variant only is still an error: the variant that might have passed was not tried.
    expect(await verifyUltraHonk(good, { identity: bbJsEngine.identity, verify: async (tried) => { if (tried !== 'evm') throw new Error('boom'); return false; } })).toMatchObject({ status: 'error' });
    expect(await verifyUltraHonk(good, { identity: bbJsEngine.identity, verify: async () => 'yes' as unknown as boolean })).toMatchObject({ status: 'error' });
    // The real verifier faulting on files it was given is that verifier refusing them.
    await expect(bbJsEngine.verify('evm', new Uint8Array(96), [], new Uint8Array(32))).resolves.toBe(false);
  });

  it('does not call a good proof invalid when the verifier cannot set up', async () => {
    // Found in review: when setup failed the check reported FAILED for a proof that passes.
    const good = load('evm');
    const real = async () => (await import('@aztec/bb.js')) as unknown as BbJsModule;
    const g2 = () => Promise.resolve(readFileSync(join(root, 'artifacts/aztec-crs/bn254_g2.dat')));
    const broken = [
      bbJsEngine_(real, () => Promise.reject(new Error('cannot read'))),
      bbJsEngine_(real, () => Promise.resolve(new Uint8Array(128))),
      bbJsEngine_(() => Promise.reject(new Error('cannot load')), g2),
    ];
    for (const engine of broken) expect(await verifyUltraHonk(good, engine)).toMatchObject({ status: 'error' });
    // A failed read of the setup point is not kept: the next check reads it again.
    let reads = 0;
    const flaky = bbJsEngine_(real, () => (++reads === 1 ? Promise.reject(new Error('cannot read')) : g2()));
    expect(await verifyUltraHonk(good, flaky)).toMatchObject({ status: 'error' });
    expect(await verifyUltraHonk(good, flaky)).toMatchObject({ status: 'valid', variant: 'evm' });
    expect(await verifyUltraHonk(good, bbJsEngine_(real, g2))).toMatchObject({ status: 'valid', variant: 'evm' });
  }, 120_000);

  it('checks, exports and reruns from the command line with the files as they are on disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-noir-'));
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120_000 });
    const paths = at('noir-recursive');
    const exported = join(dir, 'evidence.json');
    const done = cli('check', paths.proof, '--public', paths.publicInputs, '--key', paths.verificationKey, '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout.trimEnd()).toBe(renderReport(await check(load('noir-recursive'))));
    const bundle = JSON.parse(readFileSync(exported, 'utf8'));
    expect(bundle.proof).toMatch(/^base64:/);
    expect(binaryBytes(bundle.proof)).toEqual(Uint8Array.from(readFileSync(paths.proof)));
    const again = cli('rerun', exported);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^REPRODUCED/);

    const forged = structuredClone(bundle);
    forged.report.claim = 'The holder is over 18.';
    expect(await rerunExport(JSON.stringify(forged), check)).toMatchObject({ reproduced: false, fields: ['claim'] });
    const other = JSON.parse(writeExport(load('noir-recursive'), await check(load('noir-recursive'))));
    other.publicInputs = binaryPart(Uint8Array.from([...word(11n), ...word(34n)]));
    expect(await rerunExport(JSON.stringify(other), check)).toMatchObject({ reproduced: false, kind: 'different', report: { outcome: 'invalid' } });

    const altered = join(dir, 'altered.public_inputs');
    writeFileSync(altered, Uint8Array.from([...word(11n), ...word(34n)]));
    expect(cli('check', paths.proof, '--public', altered, '--key', paths.verificationKey).status).toBe(1);
    expect(cli('check', paths.proof).status).toBe(2);
    // The command line leaves no setup files behind.
    const copies = (): number => Number(execFileSync('sh', ['-c', `ls -d "${tmpdir()}"/zk-proofscan-crs-* 2>/dev/null | wc -l`], { encoding: 'utf8' }).trim());
    const before = copies();
    expect(cli('check', paths.proof, '--public', paths.publicInputs, '--key', paths.verificationKey).status).toBe(0);
    expect(copies()).toBe(before);
  }, 240_000);
});
