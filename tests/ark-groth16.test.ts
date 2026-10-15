import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { ARK_GROTH16_VERSION, ARK_GROTH16_WASM_SHA256, arkGroth16, crossCheckedGroth16, crossCheckedSupplied, encode, VerifiersDisagree } from '../src/ark-groth16.js';
import { bundledScanning, arkGroth16Engine } from '../src/node/bundled.js';
import { stopEngines } from '../src/node/stop.js';
import { scan } from '../src/scan.js';
import { sha256Hex } from '../src/sha256.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../src/snarkjs-engine.js';
import { verifySuppliedKey } from '../src/supplied-key/verify.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const json = (path: string): Record<string, unknown> => JSON.parse(read(path)) as Record<string, unknown>;
const wasm = readFileSync(join(root, 'artifacts/ark-groth16/ark-groth16.wasm'));
const scanning = await bundledScanning();
afterAll(stopEngines);

const GROTH16 = [
  ['groth16-bn128', 'tests/fixtures/snarkjs/groth16-bn128'],
  ['groth16-bls12381', 'tests/fixtures/snarkjs/groth16-bls12381'],
  ['semaphore-v4-depth3', 'tests/fixtures/snarkjs/semaphore-v4-depth3'],
] as const;
const files = (base: string) => ({ key: json(`${base}.key.json`), proof: json(`${base}.proof.json`), signals: JSON.parse(read(`${base}.public.json`)) as string[] });

/** Calls the module directly, so its own answer codes can be seen. */
async function raw(input: Uint8Array): Promise<number> {
  const { instance } = (await WebAssembly.instantiate(wasm, {})) as unknown as { instance: WebAssembly.Instance };
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory; alloc(size: number): number; verify(pointer: number, length: number): number };
  const pointer = exports.alloc(input.length);
  new Uint8Array(exports.memory.buffer, pointer, input.length).set(input);
  return exports.verify(pointer, input.length);
}

describe("arkworks' Groth16 verifier", () => {
  it('is the pinned build of the pinned release, and can reach nothing outside itself', () => {
    expect(sha256Hex(wasm)).toBe(ARK_GROTH16_WASM_SHA256);
    const lock = read('verifiers/ark-groth16/Cargo.lock');
    expect(lock).toContain(`name = "ark-groth16"\nversion = "${ARK_GROTH16_VERSION}"`);
    const module = new WebAssembly.Module(wasm);
    expect(WebAssembly.Module.imports(module)).toEqual([]);
    expect(WebAssembly.Module.exports(module).map((entry) => entry.name).sort()).toEqual(['alloc', 'memory', 'verify']);
  });

  it.each(GROTH16)('agrees with snarkjs on %s, and on the same proof altered', async (_name, base) => {
    const { key, proof, signals } = files(base);
    expect(await arkGroth16Engine.verify(key, signals, proof)).toBe(true);
    expect(await snarkjsEngine.verify(key, signals, proof)).toBe(true);
    const altered = [...signals];
    altered[0] = (BigInt(altered[0]!) + 1n).toString();
    expect(await arkGroth16Engine.verify(key, altered, proof)).toBe(false);
    expect(await snarkjsEngine.verify(key, altered, proof)).toBe(false);
    // The proof's first and last points swapped.
    const swapped = { ...proof, pi_a: proof.pi_c, pi_c: proof.pi_a };
    expect(await arkGroth16Engine.verify(key, signals, swapped)).toBe(false);
  });

  it('checks every Groth16 proof the tool reads, through the same check as everything else', async () => {
    for (const [proof, publicInputs, verificationKey] of [
      ['tests/fixtures/snarkjs/proof-of-twitter.proof.json', 'tests/fixtures/snarkjs/proof-of-twitter.public.json', 'artifacts/zk-email-proof-of-twitter/verification-key.json'],
      ['tests/fixtures/snarkjs/groth16-bn128.proof.json', 'tests/fixtures/snarkjs/groth16-bn128.public.json', 'tests/fixtures/snarkjs/groth16-bn128.key.json'],
    ]) {
      const report = await scan({ proof: read(proof!), publicInputs: read(publicInputs!), verificationKey: read(verificationKey!) }, scanning);
      expect(report.outcome, proof).toBe('valid');
      if (report.outcome === 'valid') expect(report.verification.verifier).toEqual({ name: 'snarkjs', version: '0.7.6', alsoCheckedBy: { name: 'ark-groth16', version: '0.6.0' } });
    }
    for (const proof of ['tests/fixtures/semaphore-v4-valid.json', 'tests/fixtures/risc-zero/nethermind-test-receipt.txt']) {
      const report = await scan({ proof: read(proof) }, scanning);
      expect(report.outcome, proof).toBe('valid');
    }
  });

  it('refuses numbers outside the field and points off the curve, with its own codes', async () => {
    const { key, proof, signals } = files('tests/fixtures/snarkjs/groth16-bn128');
    const good = encode(key, signals, proof);
    expect(await raw(good)).toBe(1);
    // The layout: curve (1), count (4), alpha: flag (1) then x and y (32 each).
    const xOfAlpha = 1 + 4 + 1;
    const offCurve = good.slice();
    offCurve[xOfAlpha + 63] = offCurve[xOfAlpha + 63]! ^ 1;
    expect(await raw(offCurve)).toBe(-3);
    const notField = good.slice();
    notField.fill(0xff, xOfAlpha, xOfAlpha + 32);
    expect(await raw(notField)).toBe(-2);
    expect(await raw(good.subarray(0, good.length - 1))).toBe(-1);
    expect(await raw(new Uint8Array([...good, 0]))).toBe(-1);
    const otherCurve = good.slice();
    otherCurve[0] = 9;
    expect(await raw(otherCurve)).toBe(-1);
    // A public input at or above the scalar field's modulus is not a field element.
    const r = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
    expect(await arkGroth16Engine.verify(key, [r.toString(), ...signals.slice(1)], proof)).toBe(false);
    // Through the engine, any of these is a rejection.
    expect(await arkGroth16Engine.verify(key, signals, { ...proof, pi_a: ['1', '3', '1'] })).toBe(false);
    expect(await arkGroth16Engine.verify(key, signals, { ...proof, pi_a: ['1', '2', '7'] })).toBe(false);
    expect(await arkGroth16Engine.verify(key, [...signals, '1'], proof)).toBe(false);
  });

  it('turns a disagreement or a module that will not load into an error, never a verdict', async () => {
    const { key, proof, signals } = files('tests/fixtures/snarkjs/groth16-bn128');
    const yes = { identity: snarkjsEngine.identity, verify: async () => true };
    const no = { identity: snarkjsEngine.identity, verify: async () => false };
    await expect(crossCheckedGroth16(yes, arkGroth16Engine).verify(key, [...signals.slice(0, -1), '5'], proof)).rejects.toBeInstanceOf(VerifiersDisagree);
    await expect(crossCheckedGroth16(no, arkGroth16Engine).verify(key, signals, proof)).rejects.toThrow('the two Groth16 verifiers disagree: snarkjs rejects the proof and ark-groth16 accepts it');
    const disagreeing = crossCheckedSupplied({ ...snarkjsSuppliedKeyEngine, verify: async () => false }, arkGroth16Engine);
    const inputs = { proof: read('tests/fixtures/snarkjs/groth16-bn128.proof.json'), publicInputs: read('tests/fixtures/snarkjs/groth16-bn128.public.json'), verificationKey: read('tests/fixtures/snarkjs/groth16-bn128.key.json') };
    expect(await verifySuppliedKey(inputs, disagreeing)).toMatchObject({ status: 'error', message: expect.stringContaining('disagree') });
    const altered = arkGroth16(async () => new Uint8Array([...wasm, 0]));
    await expect(altered.verify(key, signals, proof)).rejects.toThrow('the arkworks verifier module has SHA-256');
    expect(await verifySuppliedKey(inputs, crossCheckedSupplied(snarkjsSuppliedKeyEngine, altered))).toMatchObject({ status: 'error' });
  });

  it('tries loading the module again after a failed load', async () => {
    // Found in review: a failed load was kept, so a long-running tool server would fail every later check.
    const { key, proof, signals } = files('tests/fixtures/snarkjs/groth16-bn128');
    let calls = 0;
    const flaky = arkGroth16(async () => {
      calls += 1;
      if (calls === 1) throw new Error('could not read');
      return new Uint8Array(wasm);
    });
    await expect(flaky.verify(key, signals, proof)).rejects.toThrow('could not read');
    expect(await flaky.verify(key, signals, proof)).toBe(true);
    expect(calls).toBe(2);
  });

  it('leaves PLONK and FFLONK to snarkjs alone, and says so', async () => {
    for (const system of ['plonk-bn128', 'fflonk-bn128']) {
      const base = `tests/fixtures/snarkjs/${system}`;
      const report = await scan({ proof: read(`${base}.proof.json`), publicInputs: read(`${base}.public.json`), verificationKey: read(`${base}.key.json`) }, scanning);
      if (report.outcome !== 'valid') throw new Error(system);
      expect(report.verification.verifier).toEqual({ name: 'snarkjs', version: '0.7.6' });
    }
  });
});
