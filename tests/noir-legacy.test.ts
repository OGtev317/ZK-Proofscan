import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { BASE_FIELD, SCALAR_FIELD } from '../src/field.js';
import { binaryBytes, binaryPart, type ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { BB_JS_LEGACY_PACKAGE, BB_JS_LEGACY_VERSION, bbJsLegacyEngine } from '../src/node/noir-legacy-engine.js';
import { stopEngines } from '../src/node/stop.js';
import { LEGACY_ULTRAHONK_VARIANTS, looksLikeLegacyKey, verifyLegacyUltraHonk, type LegacyUltraHonkVariant } from '../src/noir/legacy.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const at = (name: string) => ({
  proof: join(root, `tests/fixtures/noir-legacy/multiplier-${name}.proof`),
  publicInputs: join(root, `tests/fixtures/noir-legacy/multiplier-${name}.public_inputs`),
  verificationKey: join(root, `tests/fixtures/noir-legacy/multiplier-${name}.vk`),
});
const load = (name: string): Required<ProofInputs> => {
  const paths = at(name);
  return { proof: binaryPart(readFileSync(paths.proof)), publicInputs: binaryPart(readFileSync(paths.publicInputs)), verificationKey: binaryPart(readFileSync(paths.verificationKey)) };
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopEngines);

const number = (bytes: Uint8Array, word: number): bigint => BigInt(`0x${Buffer.from(bytes.subarray(word * 32, word * 32 + 32)).toString('hex')}`);
/** A copy of a proof with some of its 32-byte values replaced. */
const withWords = (part: string, changes: Record<number, bigint>): Uint8Array => {
  const bytes = Uint8Array.from(binaryBytes(part)!);
  for (const [word, value] of Object.entries(changes)) bytes.set(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'), Number(word) * 32);
  return bytes;
};
const flipped = (part: string, index: number, mask = 1): string => {
  const bytes = Uint8Array.from(binaryBytes(part)!);
  bytes[index]! ^= mask;
  return binaryPart(bytes);
};
/** What the library itself says, without this tool's own checks in front of it. */
const raw = (variant: LegacyUltraHonkVariant, inputs: Required<ProofInputs>, proof: Uint8Array): Promise<boolean> =>
  bbJsLegacyEngine.verify(variant, binaryBytes(inputs.verificationKey)!, binaryBytes(inputs.publicInputs)!, proof);

describe('UltraHonk proofs from Barretenberg 0.87.0 (the version the Stellar verifier is built for)', () => {
  it('pins the older verifier, installed beside the current one', () => {
    const installed = JSON.parse(readFileSync(join(root, 'node_modules', BB_JS_LEGACY_PACKAGE, 'package.json'), 'utf8'));
    expect(installed).toMatchObject({ name: '@aztec/bb.js', version: BB_JS_LEGACY_VERSION });
    expect(BB_JS_LEGACY_VERSION).toBe('0.87.0');
    expect(JSON.parse(readFileSync(join(root, 'node_modules/@aztec/bb.js/package.json'), 'utf8')).version).not.toBe(BB_JS_LEGACY_VERSION);
    // The two versions' keys cannot be mistaken for each other.
    expect(looksLikeLegacyKey(binaryBytes(load('keccak').verificationKey)!)).toBe(true);
    expect(looksLikeLegacyKey(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.vk')))).toBe(false);
  });

  it.each(LEGACY_ULTRAHONK_VARIANTS)('accepts a real %s proof, names the version, and says what a pass here does not show', async (variant) => {
    const report = await check(load(variant));
    if (report.outcome !== 'valid' || report.basis !== 'supplied-key') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.publicInputs).toEqual(['11', '33']);
    expect(report.verification).toMatchObject({ result: 'passed', verifier: { name: '@aztec/bb.js', version: '0.87.0' }, proofSystem: { protocol: 'ultrahonk', curve: 'bn128', variant } });
    expect(report.input.sha256).toBe(sha256(readFileSync(at(variant).proof)));
    expect(report.verification.verificationKeySha256).toBe(sha256(readFileSync(at(variant).verificationKey)));
    expect(report.keyRecognition).toEqual({ match: 'none' });
    const shown = renderReport(report);
    for (const line of [
      `PASSED using @aztec/bb.js 0.87.0, against the verification key supplied with the proof (UltraHonk on BN254, variant ${variant}).`,
      'This tool does not know what that circuit checks.',
      'A key can be made for a circuit that accepts anything.',
      'This proof was checked with Barretenberg 0.87.0, an older version',
      'A pass here does not show that a contract would accept this proof.',
      'The bytes of a proof do not identify it.',
      'NOT REVIEWED',
    ]) expect(shown).toContain(line);
    // A proof for the current version says none of this.
    expect(renderReport(await check({ proof: binaryPart(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.proof'))), publicInputs: binaryPart(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.public_inputs'))), verificationKey: binaryPart(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.vk'))) }))).not.toContain('0.87.0');
  });

  it('uses no network: nothing is fetched while a proof is checked', async () => {
    const real = globalThis.fetch;
    const asked: string[] = [];
    globalThis.fetch = (async (input: unknown) => {
      asked.push(String(input));
      throw new Error('no network in this test');
    }) as typeof fetch;
    try {
      expect((await check(load('keccak'))).outcome).toBe('valid');
    } finally {
      globalThis.fetch = real;
    }
    expect(asked).toEqual([]);
  });

  it('rejects a proof after a change to the proof, a public input or the key', async () => {
    const good = load('keccak');
    const proofBytes = binaryBytes(good.proof)!.length;
    for (let index = 5; index < proofBytes; index += 409) {
      const report = await check({ ...good, proof: flipped(good.proof, index) });
      expect(report.outcome, `proof byte ${index}`).not.toBe('valid');
      expect(report).not.toHaveProperty('claim');
    }
    const word = (value: bigint): number[] => [...Buffer.from(value.toString(16).padStart(64, '0'), 'hex')];
    expect(await check({ ...good, publicInputs: binaryPart(Uint8Array.from([...word(11n), ...word(34n)])) })).toMatchObject({ outcome: 'invalid', publicInputs: ['11', '34'], verification: { result: 'failed', verifier: { version: '0.87.0' } } });
    expect(await check({ ...good, publicInputs: binaryPart(Uint8Array.from(word(11n))) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/number of public inputs/) });
    // Measured: the verifier itself does not compare the count with the key.
    expect(await raw('keccak', { ...good, publicInputs: binaryPart(Uint8Array.from(word(11n))) }, binaryBytes(good.proof)!)).toBe(false);
    expect(await check({ ...good, publicInputs: binaryPart(Uint8Array.from([...word(11n), ...word(33n + SCALAR_FIELD)])) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/not a number inside the field/) });
    // Measured: the verifier does not read bytes 8 to 11 of a key. The opening numbers must agree, so a key with anything there is refused.
    for (const index of [8, 9, 10, 11]) {
      expect(await raw('keccak', { ...good, verificationKey: flipped(good.verificationKey, index, 0xff) }, binaryBytes(good.proof)!), `key byte ${index}`).toBe(true);
    }
    for (const index of [0, 6, 7, 8, 9, 10, 11, 12, 15]) {
      expect(await check({ ...good, verificationKey: flipped(good.verificationKey, index) }), `key byte ${index}`).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/circuit size and its logarithm that agree/) });
    }
    for (const index of [16, 23]) {
      expect(await check({ ...good, verificationKey: flipped(good.verificationKey, index) }), `key byte ${index}`).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/number of public inputs/) });
    }
    // No change anywhere else in a key goes unnoticed.
    for (const index of [24, 31, 32, 63, 64, 100, 777, 1500, 1759]) {
      expect((await check({ ...good, verificationKey: flipped(good.verificationKey, index) })).outcome, `key byte ${index}`).toBe('invalid');
    }
  }, 240_000);

  it.each(LEGACY_ULTRAHONK_VARIANTS)('refuses a %s proof rewritten in a way this version of the verifier would still accept', async (variant) => {
    // Found by changing every byte of a proof: three ways to rewrite a proof
    // that Barretenberg 0.87.0 accepts as the same proof. Each is pinned here
    // as the library behaves, and refused by this tool before the verifier runs.
    const good = load(variant);
    const proof = binaryBytes(good.proof)!;
    const words = proof.length / 32;
    const last = (back: number): bigint => number(proof, words - back);
    expect(Array.from({ length: words }, (_, i) => number(proof, i)).every((value) => value < SCALAR_FIELD)).toBe(true);

    // 1. A number written as itself plus the field size.
    const scalar = Array.from({ length: words - 16 }, (_, i) => i + 8).find((i) => number(proof, i) > 1n << 240n && number(proof, i) + SCALAR_FIELD < 1n << 256n)!;
    const aliased = withWords(good.proof, { [scalar]: number(proof, scalar) + SCALAR_FIELD });
    expect(await raw(variant, good, aliased)).toBe(true);
    expect(await check({ ...good, proof: binaryPart(aliased) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/number outside the field/) });

    // 2. The last point with one coordinate's halves split another way.
    const resplit = withWords(good.proof, { [words - 4]: last(4) + (1n << 136n), [words - 3]: last(3) - 1n });
    expect(await raw(variant, good, resplit)).toBe(true);
    expect(await check({ ...good, proof: binaryPart(resplit) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/last point of the proof/) });

    // 3. Unread high bytes in the last point's high halves.
    for (const back of [3, 1]) {
      const padded = withWords(good.proof, { [words - back]: last(back) + (1n << 200n) });
      expect(await raw(variant, good, padded), `word ${words - back}`).toBe(true);
      expect(await check({ ...good, proof: binaryPart(padded) }), `word ${words - back}`).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/last point of the proof/) });
    }
    // A coordinate at or above the curve's field size is refused too, whatever the verifier would do with it.
    const x = last(4) + (last(3) << 136n);
    if (x + BASE_FIELD < 1n << 254n) {
      const lifted = withWords(good.proof, { [words - 4]: (x + BASE_FIELD) & ((1n << 136n) - 1n), [words - 3]: (x + BASE_FIELD) >> 136n });
      expect(await check({ ...good, proof: binaryPart(lifted) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/last point of the proof/) });
    }
    // The same rewriting of an earlier point is the verifier's own to reject.
    const early = withWords(good.proof, { 0: number(proof, 0) + (1n << 136n), 1: number(proof, 1) - 1n });
    expect(await raw(variant, good, early)).toBe(false);
    expect((await check({ ...good, proof: binaryPart(early) })).outcome).toBe('invalid');
  }, 240_000);

  it('refuses what it does not check, without calling it invalid', async () => {
    const good = load('keccak');
    const current = { proof: binaryPart(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.proof'))), verificationKey: binaryPart(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.vk'))) };
    // This version's other transcript is a real proof this tool does not check.
    expect(await check(load('poseidon'))).toMatchObject({ outcome: 'unsupported' });
    // A proof of one version with a key of the other.
    expect(await check({ ...good, proof: current.proof })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/not the size of a Keccak UltraHonk proof/) });
    expect((await check({ ...good, verificationKey: current.verificationKey })).outcome).not.toBe('valid');
    // A proof that hides its witness, cut to the size of one that does not.
    const zk = load('keccak-zk');
    expect((await check({ ...zk, proof: binaryPart(binaryBytes(zk.proof)!.subarray(0, 14592)) })).outcome).toBe('invalid');
    expect(await check({ ...good, proof: binaryPart(binaryBytes(good.proof)!.subarray(0, 14560)) })).toMatchObject({ outcome: 'unsupported' });
    // Where the older verifier is not available, the proof is not checked rather than failed.
    const { ultraHonkLegacy: _none, ...without } = scanning;
    expect(await scan(good, without)).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/this build cannot check/) });
  });

  it('reports a verifier that could not run as an error, never as a rejected proof', async () => {
    const good = load('keccak');
    expect(await verifyLegacyUltraHonk(good, { identity: bbJsLegacyEngine.identity, verify: async () => { throw new Error('boom'); } })).toEqual({ status: 'error', message: 'boom' });
    expect(await verifyLegacyUltraHonk(good, { identity: bbJsLegacyEngine.identity, verify: async () => 'yes' as unknown as boolean })).toMatchObject({ status: 'error' });
    expect(await verifyLegacyUltraHonk(good, { identity: bbJsLegacyEngine.identity, verify: async () => false })).toMatchObject({ status: 'invalid', legacy: true });
  });

  it('does not let an empty key and an empty proof pass', async () => {
    // Found in review: this version of the verifier accepts a proof of all
    // zeros under a key whose points are all zero, whatever the public inputs.
    const good = load('keccak');
    const key = binaryBytes(good.verificationKey)!;
    const emptyKey = Uint8Array.from([...key.subarray(0, 32), ...new Uint8Array(1728)]);
    const emptyProof = new Uint8Array(14592);
    expect(await bbJsLegacyEngine.verify('keccak', emptyKey, binaryBytes(good.publicInputs)!, emptyProof)).toBe(true);
    expect(await bbJsLegacyEngine.verify('keccak', new Uint8Array(1760), new Uint8Array(0), emptyProof)).toBe(true);
    // A real circuit's key holds no such point, and with one the empty proof fails.
    expect(await raw('keccak', good, emptyProof)).toBe(false);
    expect((await check({ ...good, proof: binaryPart(emptyProof) })).outcome).toBe('invalid');
    // This tool does not read a key that holds a point at infinity, so the empty key is never verified against.
    expect(await check({ ...good, verificationKey: binaryPart(emptyKey), proof: binaryPart(emptyProof) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/point at infinity/) });
    for (const point of [0, 13, 26]) {
      const one = Uint8Array.from(key);
      one.fill(0, 32 + 64 * point, 96 + 64 * point);
      expect(await check({ ...good, verificationKey: binaryPart(one) }), `point ${point}`).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/point at infinity/) });
    }
    // The current verifier refuses the same trick by itself.
    const currentKey = readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.vk'));
    const emptyCurrent = Uint8Array.from([...currentKey.subarray(0, 96), ...new Uint8Array(currentKey.length - 96)]);
    expect((await check({ proof: binaryPart(new Uint8Array(readFileSync(join(root, 'tests/fixtures/noir/multiplier-evm.proof')).length)), publicInputs: good.publicInputs, verificationKey: binaryPart(emptyCurrent) })).outcome).not.toBe('valid');
  }, 120_000);

  it('checks, exports and reruns from the command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-noir-legacy-'));
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120_000 });
    const paths = at('keccak-zk');
    const exported = join(dir, 'evidence.json');
    const done = cli('check', paths.proof, '--public', paths.publicInputs, '--key', paths.verificationKey, '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout.trimEnd()).toBe(renderReport(await check(load('keccak-zk'))));
    const again = cli('rerun', exported);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^REPRODUCED/);
    expect(cli('check', at('poseidon').proof, '--public', at('poseidon').publicInputs, '--key', at('poseidon').verificationKey).status).toBe(2);
  }, 240_000);
});
