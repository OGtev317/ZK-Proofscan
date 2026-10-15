import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';
import { afterAll, describe, expect, it } from 'vitest';
import { rerunExport, writeExport } from '../src/export.js';
import { BLS12_381_BASE_FIELD, BLS12_381_SCALAR_FIELD, SCALAR_FIELD } from '../src/field.js';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';
import { stopSnarkjs } from '../src/snarkjs-engine.js';
import { validText } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixtures = join(root, 'tests/fixtures/snarkjs');
const SYSTEMS = ['groth16-bn128', 'groth16-bls12381', 'plonk-bn128', 'fflonk-bn128'] as const;
type System = (typeof SYSTEMS)[number];
const paths = (system: System) => ({ proof: join(fixtures, `${system}.proof.json`), publicInputs: join(fixtures, `${system}.public.json`), verificationKey: join(fixtures, `${system}.key.json`) });
const load = (system: System): Required<ProofInputs> => {
  const at = paths(system);
  return { proof: readFileSync(at.proof, 'utf8'), publicInputs: readFileSync(at.publicInputs, 'utf8'), verificationKey: readFileSync(at.verificationKey, 'utf8') };
};

const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopSnarkjs);

/** Every decimal string in a JSON value, as a path that can be written back. */
function numbers(value: unknown, path: (string | number)[] = []): (string | number)[][] {
  if (typeof value === 'string') return /^[0-9]+$/.test(value) ? [path] : [];
  if (Array.isArray(value)) return value.flatMap((inner, i) => numbers(inner, [...path, i]));
  if (typeof value === 'object' && value !== null) return Object.entries(value).flatMap(([key, inner]) => numbers(inner, [...path, key]));
  return [];
}
function changed(text: string, path: (string | number)[], to: (value: string) => unknown): string {
  const parsed = JSON.parse(text);
  let at = parsed;
  for (const step of path.slice(0, -1)) at = at[step];
  const last = path.at(-1)!;
  at[last] = to(at[last]);
  return JSON.stringify(parsed);
}
const plusOne = (value: string): string => (BigInt(value) + 1n).toString();

// Measured on snarkjs 0.7.6: values the verifier never reads. Changing one
// leaves the result the same. Each is pinned here so that a different
// verifier version, or a new unread value, fails a test.
const UNREAD_IN_PROOF: Record<System, string[]> = { 'groth16-bn128': [], 'groth16-bls12381': [], 'plonk-bn128': [], 'fflonk-bn128': ['evaluations.inv'] };
const UNREAD_IN_KEY: Record<System, RegExp | undefined> = { 'groth16-bn128': /^vk_alphabeta_12\./, 'groth16-bls12381': /^vk_alphabeta_12\./, 'plonk-bn128': /^w$/, 'fflonk-bn128': undefined };

describe('proofs checked with a supplied key', () => {
  it.each(SYSTEMS)('accepts a real %s proof and says only what a supplied key supports', async (system) => {
    const report = await check(load(system));
    if (report.outcome !== 'valid' || report.basis !== 'supplied-key') throw new Error(JSON.stringify(report));
    expect(report.publicInputs).toEqual(['33', '11']);
    expect(report.verification).toMatchObject({ result: 'passed', verifier: { name: 'snarkjs', version: '0.7.6' } });
    const shown = renderReport(report);
    expect(shown).toMatch(/^Claim: Whoever made this proof knew private inputs/);
    expect(shown).toContain('This tool does not know what that circuit checks.');
    expect(shown).toContain('NOT REVIEWED');
    expect(shown).toContain('A key can be made for a circuit that accepts anything.');
    expect(shown).toContain('against the verification key supplied with the proof');
    // Nothing a bundled circuit's report would say.
    expect(shown).not.toMatch(/membership|group root|nullifier|Application checks/);
    expect(report).not.toHaveProperty('applicationChecks');
  });

  it('uses the same field sizes as the verifier for BLS12-381', async () => {
    const curve = await (snarkjs as unknown as { curves: { getCurveFromName(name: string): Promise<{ q: bigint; r: bigint }> } }).curves.getCurveFromName('bls12381');
    expect(curve.q).toBe(BLS12_381_BASE_FIELD);
    expect(curve.r).toBe(BLS12_381_SCALAR_FIELD);
  });

  it.each(SYSTEMS)('accepts a %s proof after one number changes only where the verifier is known not to read', async (system) => {
    const good = load(system);
    const stillValid = async (which: 'proof' | 'verificationKey'): Promise<string[]> => {
      const spots = numbers(JSON.parse(good[which]));
      expect(spots.length).toBeGreaterThan(5);
      const passed: string[] = [];
      for (const spot of spots) {
        if ((await check({ ...good, [which]: changed(good[which], spot, plusOne) })).outcome === 'valid') passed.push(spot.join('.'));
      }
      return passed;
    };
    expect(await stillValid('proof')).toEqual(UNREAD_IN_PROOF[system]);
    const inKey = await stillValid('verificationKey');
    const unread = UNREAD_IN_KEY[system];
    expect(inKey.filter((spot) => unread === undefined || !unread.test(spot))).toEqual([]);
    expect(inKey.length).toBe(unread === undefined ? 0 : system === 'plonk-bn128' ? 1 : 12);
  }, 240_000);

  it('says so in the report when the verifier does not read part of a proof', async () => {
    const good = load('fflonk-bn128');
    const report = await check(good);
    expect(renderReport(report)).toContain('does not read one value in an FFLONK proof, named "inv"');
    expect(renderReport(await check(load('plonk-bn128')))).not.toContain('"inv"');
    const other = await check({ ...good, proof: changed(good.proof, ['evaluations', 'inv'], plusOne) });
    expect(other.outcome).toBe('valid');
    expect(other.input.sha256).not.toBe(report.input.sha256);
  });

  it.each(SYSTEMS)('rejects a %s proof when a public input changes, and refuses another way of writing it', async (system) => {
    const good = load(system);
    const rejected = await check({ ...good, publicInputs: '["34","11"]' });
    expect(rejected).toMatchObject({ outcome: 'invalid', basis: 'supplied-key', publicInputs: ['34', '11'], verification: { result: 'failed' } });
    expect(renderReport(rejected)).toMatch(/Claim: None/);
    const field = system === 'groth16-bls12381' ? BLS12_381_SCALAR_FIELD : SCALAR_FIELD;
    for (const publicInputs of [`["${33n + field}","11"]`, '["033","11"]', '["0x21","11"]', '[33,11]', '["33"]', '["33","11","0"]', '["33","11",]', '{"0":"33","1":"11"}', '["-33","11"]', '["33 ","11"]', '']) {
      expect(await check({ ...good, publicInputs }), publicInputs.slice(0, 20)).toMatchObject({ outcome: 'unsupported' });
    }
  });

  it('refuses files that could be read more than one way', async () => {
    const good = load('groth16-bn128');
    const proof = JSON.parse(good.proof);
    const withRepeat = good.proof.replace('"protocol"', `"pi_c": ${JSON.stringify(proof.pi_a)},\n "protocol"`);
    const cases: Partial<ProofInputs>[] = [
      { proof: withRepeat },
      { proof: good.proof.replace('"pi_a"', '"pi\\u005fa"') },
      { proof: JSON.stringify({ ...proof, extra: '1' }) },
      { proof: JSON.stringify({ ...proof, pi_a: [proof.pi_a[0], proof.pi_a[1], '2'] }) },
      { proof: JSON.stringify({ ...proof, pi_a: ['0', '1', '0'] }) },
      { proof: JSON.stringify({ ...proof, curve: 'bn254' }) },
      { proof: JSON.stringify({ ...proof, protocol: 'stark' }) },
      { proof: `[${good.proof}]` },
      { verificationKey: good.verificationKey.replace('"nPublic": 2', '"nPublic": 2.0') },
      { verificationKey: good.verificationKey.replace('"nPublic": 2', '"nPublic": 1') },
      { verificationKey: good.verificationKey.replace('"nPublic": 2', '"nPublic": 3') },
      { verificationKey: JSON.stringify({ ...JSON.parse(good.verificationKey), __proto__: null, extra: [] }) },
      { verificationKey: 'null' },
    ];
    for (const change of cases) expect(await check({ ...good, ...change }), JSON.stringify(change).slice(0, 60)).toMatchObject({ outcome: 'unsupported' });
  });

  it('does not accept a proof under a different key', async () => {
    const good = load('groth16-bn128');
    const key = JSON.parse(good.verificationKey);
    // A well-formed key for a different statement: the same points in another order.
    const other = JSON.stringify({ ...key, IC: [key.IC[0], key.IC[2], key.IC[1]] });
    expect(await check({ ...good, verificationKey: other })).toMatchObject({ outcome: 'invalid', basis: 'supplied-key' });
    // A key for another proof system or curve is not tried at all.
    for (const system of ['plonk-bn128', 'fflonk-bn128', 'groth16-bls12381'] as const) {
      expect(await check({ ...good, verificationKey: load(system).verificationKey })).toMatchObject({ outcome: 'unsupported' });
    }
  });

  it('reports the hashes of the exact key and public input files', async () => {
    const good = load('plonk-bn128');
    const spaced = { ...good, verificationKey: `${good.verificationKey}\n`, publicInputs: ` ${good.publicInputs}` };
    const [a, b] = [await check(good), await check(spaced)];
    if (a.outcome !== 'valid' || b.outcome !== 'valid' || a.basis !== 'supplied-key' || b.basis !== 'supplied-key') throw new Error('expected two passes');
    expect(a.verification.verificationKeySha256).not.toBe(b.verification.verificationKeySha256);
    expect(a.verification.publicInputsSha256).not.toBe(b.verification.publicInputsSha256);
  });

  it('keeps supplied keys and bundled keys apart', async () => {
    const good = load('groth16-bn128');
    // A supplied key never stands in for the pinned Semaphore keys.
    expect(await check({ ...good, proof: validText })).toMatchObject({ outcome: 'unsupported' });
    // One extra file without the other is not a check.
    expect(await check({ proof: good.proof, publicInputs: good.publicInputs })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/needs both/) });
    expect(await check({ proof: good.proof, verificationKey: good.verificationKey })).toMatchObject({ outcome: 'unsupported' });
    // A snarkjs proof on its own says what is missing, and is not called invalid.
    expect(await check({ proof: good.proof })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/needs its own public inputs file and verification key file/) });
    // A Semaphore proof on its own is still a bundled-circuit check.
    expect(await check({ proof: validText })).toMatchObject({ outcome: 'valid', basis: 'bundled-circuit' });
  });

  it('survives 300 random one-character changes without a false pass', async () => {
    const good = load('groth16-bn128');
    const original = { proof: JSON.parse(good.proof), publicInputs: JSON.parse(good.publicInputs), verificationKey: JSON.parse(good.verificationKey) };
    let seed = 20261011;
    const next = (below: number): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed % below;
    };
    const alphabet = '0123456789"[]{},: abcx-';
    let passes = 0;
    for (let i = 0; i < 300; i++) {
      const which = (['proof', 'publicInputs', 'verificationKey'] as const)[next(3)]!;
      const text = good[which];
      const at = next(text.length);
      const mutated = text.slice(0, at) + alphabet[next(alphabet.length)] + text.slice(at + 1);
      const report = await check({ ...good, [which]: mutated });
      if (report.outcome !== 'valid') continue;
      passes++;
      // A pass is only acceptable when the file still says exactly the same thing.
      const { vk_alphabeta_12: _unread, ...read } = JSON.parse(mutated);
      const { vk_alphabeta_12: _same, ...expected } = original[which];
      expect(which === 'verificationKey' ? read : JSON.parse(mutated), `${which} at ${at}`).toEqual(which === 'verificationKey' ? expected : original[which]);
    }
    expect(passes).toBeLessThan(300);
  }, 120_000);
});

describe('supplied-key evidence, exported and rerun', () => {
  const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-supplied-'));
  const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 60_000 });
  const withKey = (system: System): string[] => {
    const at = paths(system);
    return [at.proof, '--public', at.publicInputs, '--key', at.verificationKey];
  };

  it.each(SYSTEMS)('checks %s on the command line and reproduces its export', (system) => {
    const exported = join(dir, `${system}.json`);
    const result = cli('check', ...withKey(system), '--export', exported);
    expect(result.status).toBe(0);
    // Groth16 proofs are checked by arkworks as well, and both must agree; PLONK and FFLONK by snarkjs alone.
    const verifiers = system.startsWith('groth16') ? 'snarkjs 0\\.7\\.6 and ark-groth16 0\\.6\\.0, two independent verifiers that agree' : 'snarkjs 0\\.7\\.6';
    expect(result.stdout).toMatch(new RegExp(`Cryptographic verification: PASSED using ${verifiers}, against the verification key supplied with the proof`));
    const bundle = JSON.parse(readFileSync(exported, 'utf8'));
    expect(Object.keys(bundle)).toEqual(['exportVersion', 'proof', 'publicInputs', 'verificationKey', 'report']);
    expect(bundle.report).toMatchObject({ reportVersion: 3, outcome: 'valid', basis: 'supplied-key' });
    const again = cli('rerun', exported);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^REPRODUCED/);
  });

  it('notices an export whose key or claim was exchanged', async () => {
    const good = load('groth16-bn128');
    const bundle = JSON.parse(writeExport(good, await check(good)));
    const key = JSON.parse(good.verificationKey);
    const otherKey = { ...bundle, verificationKey: JSON.stringify({ ...key, IC: [key.IC[0], key.IC[2], key.IC[1]] }) };
    expect(await rerunExport(JSON.stringify(otherKey), check)).toMatchObject({ reproduced: false, kind: 'different', report: { outcome: 'invalid' } });
    const bolder = structuredClone(bundle);
    bolder.report.claim = 'This proves the holder is over 18.';
    bolder.report.limits = [];
    expect(await rerunExport(JSON.stringify(bolder), check)).toMatchObject({ reproduced: false, fields: ['claim', 'limits'] });
    // Dropping the key from an export does not turn it into another kind of check.
    const { verificationKey: _dropped, ...without } = bundle;
    expect(await rerunExport(JSON.stringify(without), check)).toMatchObject({ reproduced: false, kind: 'different', report: { outcome: 'unsupported' } });
  });

  it('exits 1 for a rejected proof, 2 when a file is missing from the set, 3 when one cannot be read', () => {
    const at = paths('fflonk-bn128');
    const wrong = join(dir, 'wrong.public.json');
    writeFileSync(wrong, '["34","11"]');
    const rejected = cli('check', at.proof, '--public', wrong, '--key', at.verificationKey, '--json');
    expect(rejected.status).toBe(1);
    expect(JSON.parse(rejected.stdout)).toMatchObject({ outcome: 'invalid', basis: 'supplied-key' });
    expect(cli('check', at.proof, '--key', at.verificationKey).status).toBe(2);
    expect(cli('check', at.proof).status).toBe(2);
    const missing = cli('check', at.proof, '--public', join(dir, 'absent.json'), '--key', at.verificationKey);
    expect(missing.status).toBe(3);
    expect(missing.stdout).toMatch(/could not read the public inputs file/);
    expect(cli('rerun', at.proof, '--key', at.verificationKey).status).toBe(64);
  });
});
