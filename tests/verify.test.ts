import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { verifyProof as semaphoreVerify } from '@semaphore-protocol/proof';
import { afterAll, describe, expect, it } from 'vitest';
import { SCALAR_FIELD } from '../src/field.js';
import { SNARKJS_VERSION, snarkjsEngine, stopSnarkjs } from '../src/snarkjs-engine.js';
import { bundledSemaphoreV4Keys } from '../src/node/keys.js';
import { ArtifactMismatchError, SEMAPHORE_V4_KEYS_SHA256, loadSemaphoreV4Keys } from '../src/semaphore-v4/artifact.js';
import { hashToField } from '../src/semaphore-v4/hash.js';
import { verifySemaphoreV4, type Groth16Engine } from '../src/semaphore-v4/verify.js';
import { KEYS_PATH, plus, text, valid, validText } from './helpers.js';

const keys = await bundledSemaphoreV4Keys();
const run = (input: string, engine: Groth16Engine = snarkjsEngine) => verifySemaphoreV4(input, keys, engine);
afterAll(stopSnarkjs);

describe('Semaphore v4 verification', () => {
  it('passes the real proof and reports exactly what was checked', async () => {
    const raw = valid();
    expect(await run(validText)).toEqual({
      status: 'valid',
      format: 'semaphore-v4',
      verifier: { name: 'snarkjs', version: '0.7.6' },
      artifact: { sha256: SEMAPHORE_V4_KEYS_SHA256, merkleTreeDepth: 3 },
      message: raw.message,
      scope: raw.scope,
      publicSignals: [raw.merkleTreeRoot, raw.nullifier, hashToField(BigInt(raw.message)).toString(), hashToField(BigInt(raw.scope)).toString()],
    });
  });

  it("agrees with Semaphore's own verifier on the valid proof and on tampered ones", async () => {
    expect(await semaphoreVerify(valid() as never)).toBe(true);
    for (const key of ['merkleTreeRoot', 'nullifier', 'message', 'scope'] as const) {
      const raw = valid();
      raw[key] = plus(raw[key], 1n);
      expect(await semaphoreVerify(raw as never)).toBe(false);
      expect((await run(JSON.stringify(raw))).status).toBe('invalid');
    }
  });

  it('passes real proofs made at other tree depths, and rejects each under the wrong depth', async () => {
    for (const depth of [1, 10]) {
      const other = readFileSync(new URL(`./fixtures/semaphore-v4-valid-depth${depth}.json`, import.meta.url), 'utf8');
      expect(await run(other)).toMatchObject({ status: 'valid', artifact: { merkleTreeDepth: depth } });
      expect(await semaphoreVerify(JSON.parse(other) as never)).toBe(true);
      const moved = JSON.stringify({ ...JSON.parse(other), merkleTreeDepth: depth + 1 });
      expect((await run(moved)).status).toBe('invalid');
    }
  });

  // Seeded so a failure can be repeated. A changed file may still pass only
  // if it says exactly the same thing, for example with different spacing.
  it('never passes a randomly damaged proof file that says something different', async () => {
    let seed = 0x5eed1234;
    const next = (limit: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % limit;
    };
    const alphabet = '0123456789"{}[],: \n-+.eEx';
    const same = JSON.stringify(valid());
    const seen = { valid: 0, invalid: 0, unsupported: 0, error: 0 };
    for (let i = 0; i < 400; i++) {
      const at = next(validText.length);
      const kind = next(3);
      const char = alphabet[next(alphabet.length)]!;
      const damaged = kind === 0 ? validText.slice(0, at) + char + validText.slice(at + 1)
        : kind === 1 ? validText.slice(0, at) + validText.slice(at + 1)
        : validText.slice(0, at) + char + validText.slice(at);
      const result = await run(damaged);
      seen[result.status]++;
      if (result.status === 'valid') expect(JSON.stringify(JSON.parse(damaged))).toBe(same);
      expect(result.status).not.toBe('error');
    }
    expect(seen.invalid).toBeGreaterThan(20);
    expect(seen.unsupported).toBeGreaterThan(20);
  });

  it('rejects a change to any single proof point', async () => {
    for (let i = 0; i < 8; i++) {
      expect((await run(text((raw) => { raw.points[i] = plus(raw.points[i]!, 1n); }))).status).toBe('invalid');
    }
    expect((await run(text((raw) => { raw.points.reverse(); }))).status).toBe('invalid');
    expect((await run(text((raw) => { raw.points = raw.points.map(() => '0'); }))).status).toBe('invalid');
  });

  it('rejects the proof under a different tree depth', async () => {
    for (const depth of [1, 2, 4, 32]) {
      expect((await run(text((raw) => { raw.merkleTreeDepth = depth; }))).status).toBe('invalid');
    }
  });

  it('rejects the proof when two public values are swapped', async () => {
    expect((await run(text((raw) => { [raw.message, raw.scope] = [raw.scope, raw.message]; }))).status).toBe('invalid');
    expect((await run(text((raw) => { [raw.merkleTreeRoot, raw.nullifier] = [raw.nullifier, raw.merkleTreeRoot]; }))).status).toBe('invalid');
  });

  it('does not check a proof whose nullifier is written as an out-of-range alias', async () => {
    const alias = text((raw) => { raw.nullifier = plus(raw.nullifier, SCALAR_FIELD); });
    expect(await run(alias)).toEqual({ status: 'unsupported', reason: expect.stringMatching(/nullifier/) });
  });

  it('keeps a failed check apart from a rejected proof', async () => {
    const identity = { name: 'test', version: '0' };
    const throwing: Groth16Engine = { identity, verify: async () => { throw new Error('worker crashed'); } };
    expect(await run(validText, throwing)).toEqual({ status: 'error', message: 'worker crashed' });
    const vague: Groth16Engine = { identity, verify: async () => undefined as never };
    expect((await run(validText, vague)).status).toBe('error');
    expect((await run('{}')).status).toBe('unsupported');
  });
});

describe('verification keys', () => {
  const bytes = readFileSync(KEYS_PATH);

  it('are the file shipped in the pinned Semaphore package', () => {
    const shipped = readFileSync(new URL('../node_modules/@semaphore-protocol/proof/src/verification-keys.json', import.meta.url));
    expect(Buffer.compare(bytes, shipped)).toBe(0);
  });

  it('are refused after any change', () => {
    const changed = Buffer.from(bytes);
    changed[changed.length - 10]! ^= 1;
    expect(() => loadSemaphoreV4Keys(changed)).toThrow(ArtifactMismatchError);
    expect(() => loadSemaphoreV4Keys(Buffer.concat([bytes, Buffer.from('\n')]))).toThrow(ArtifactMismatchError);
    expect(() => loadSemaphoreV4Keys(new Uint8Array())).toThrow(ArtifactMismatchError);
  });

  it('use a different key for every depth', () => {
    const seen = new Set(Array.from({ length: 32 }, (_, i) => JSON.stringify(keys.keyForDepth(i + 1))));
    expect(seen.size).toBe(32);
    expect(() => keys.keyForDepth(0)).toThrow(RangeError);
    expect(() => keys.keyForDepth(33)).toThrow(RangeError);
  });
});

describe('snarkjs versions', () => {
  const require = createRequire(import.meta.url);

  it('pins the installed verifier', () => {
    expect(require('../node_modules/snarkjs/package.json').version).toBe(SNARKJS_VERSION);
  });

  // Measured, not assumed: for Groth16 both versions reject a public input
  // moved by the field size, so that is not a reason to prefer 0.7.6. Both
  // also accept other spellings of the same number, which is why the importer
  // insists on one canonical spelling before anything reaches the verifier.
  it('records how 0.7.5 and 0.7.6 treat unusual public inputs', async () => {
    const old = await import('../node_modules/@semaphore-protocol/proof/node_modules/snarkjs/main.js' as string);
    expect(require('../node_modules/@semaphore-protocol/proof/node_modules/snarkjs/package.json').version).toBe('0.7.5');
    const raw = valid();
    const p = raw.points;
    const proof = { pi_a: [p[0], p[1]], pi_b: [[p[3], p[2]], [p[5], p[4]]], pi_c: [p[6], p[7]], protocol: 'groth16', curve: 'bn128' };
    const both = async (nullifier: string): Promise<boolean[]> => {
      const signals = [raw.merkleTreeRoot, nullifier, hashToField(BigInt(raw.message)).toString(), hashToField(BigInt(raw.scope)).toString()];
      return [await old.groth16.verify(keys.keyForDepth(3), signals, proof), await snarkjsEngine.verify(keys.keyForDepth(3), signals, proof)];
    };
    expect(await both(raw.nullifier)).toEqual([true, true]);
    expect(await both(plus(raw.nullifier, SCALAR_FIELD))).toEqual([false, false]);
    expect(await both(plus(raw.nullifier, -SCALAR_FIELD))).toEqual([false, false]);
    expect(await both(`0x${BigInt(raw.nullifier).toString(16)}`)).toEqual([true, true]);
    expect(await both(`00${raw.nullifier}`)).toEqual([true, true]);
  });
});
