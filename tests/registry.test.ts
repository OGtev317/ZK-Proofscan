import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { rerunExport, writeExport } from '../src/export.js';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { bundledSemaphoreV4Keys } from '../src/node/keys.js';
import { KEY_REGISTRY_SHA256, keyContentSha256, loadKeyRegistry, RegistryError } from '../src/registry.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';
import { SEMAPHORE_V4_KEYS_SHA256 } from '../src/semaphore-v4/artifact.js';
import { importSemaphoreV4 } from '../src/semaphore-v4/importer.js';
import { publicSignals } from '../src/semaphore-v4/verify.js';
import { sha256Hex, utf8 } from '../src/sha256.js';
import { stopSnarkjs } from '../src/snarkjs-engine.js';
import { validText } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixture = (name: string): string => readFileSync(join(root, 'tests/fixtures/snarkjs', name), 'utf8');
const registryBytes = readFileSync(join(root, 'registry/keys.json'));
const scanning = await bundledScanning();
const keys = await bundledSemaphoreV4Keys();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopSnarkjs);

/** The Semaphore fixture as the three files snarkjs itself would write. */
const semaphore: Required<ProofInputs> = {
  proof: fixture('semaphore-v4-depth3.proof.json'),
  publicInputs: fixture('semaphore-v4-depth3.public.json'),
  verificationKey: fixture('semaphore-v4-depth3.key.json'),
};
const supplied = (report: Report) => {
  if ((report.outcome !== 'valid' && report.outcome !== 'invalid') || report.basis !== 'supplied-key') throw new Error(JSON.stringify(report).slice(0, 200));
  return report;
};

describe('key registry', () => {
  it('records each Semaphore v4 key separately from the file that holds all 32', () => {
    const registry = loadKeyRegistry(registryBytes);
    expect(registry.sha256).toBe(KEY_REGISTRY_SHA256);
    const [artifact] = registry.artifacts;
    expect(registry.artifacts.map((entry) => entry.id).slice(0, 2)).toEqual(['semaphore-v4-verification-keys', 'zk-email-proof-of-twitter-verification-key']);
    expect(artifact!.provenance.sha256).toBe(SEMAPHORE_V4_KEYS_SHA256);
    expect(artifact!.explanationAdapter).toBe(scanning.semaphoreV4.adapter.manifest.id);
    expect(artifact!.circuit.source).toBe(scanning.semaphoreV4.adapter.manifest.circuit.source);
    // Every recorded key is derived here again from the pinned file.
    expect(artifact!.keys).toEqual(Array.from({ length: 32 }, (_, i) => ({ label: `tree depth ${i + 1}`, contentSha256: keyContentSha256(keys.keyForDepth(i + 1)) })));
    expect(new Set(artifact!.keys.map((key) => key.contentSha256)).size).toBe(32);
    // The hash of the whole file is not a key, and is not found as one.
    expect(registry.find(SEMAPHORE_V4_KEYS_SHA256)).toBeUndefined();
    expect(registry.find(keyContentSha256(JSON.parse(readFileSync(join(root, 'artifacts/semaphore-v4/verification-keys.json'), 'utf8'))))).toBeUndefined();
  });

  it('refuses a registry file that is not the one this build was made with', () => {
    const text = registryBytes.toString();
    expect(() => loadKeyRegistry(utf8(text.replace('"unreviewed"', '"reviewed"')))).toThrow(/expected/);
    expect(() => loadKeyRegistry(utf8(`${text} `))).toThrow(RegistryError);
  });

  it('refuses a registry that is malformed, even under a matching hash', () => {
    const good = JSON.parse(registryBytes.toString());
    const load = (change: (registry: any) => void): (() => unknown) => () => {
      const copy = structuredClone(good);
      change(copy);
      const bytes = utf8(JSON.stringify(copy));
      return loadKeyRegistry(bytes, sha256Hex(bytes));
    };
    expect(load(() => {})).not.toThrow();
    for (const bad of [
      (r: any) => { r.artifacts[0].keys[1].contentSha256 = r.artifacts[0].keys[0].contentSha256; },
      (r: any) => { r.artifacts.push(r.artifacts[0]); },
      (r: any) => { r.artifacts[1].keys[0].contentSha256 = r.artifacts[0].keys[0].contentSha256; },
      (r: any) => { r.artifacts[0].entryReview = { status: 'reviewed', note: 'Looks fine.' }; },
      (r: any) => { r.artifacts[0].entryReview = { status: 'unreviewed', note: 'x', reviewer: 'A', date: '2026-10-11' }; },
      (r: any) => { r.artifacts[0].circuitLink.status = 'certain'; },
      (r: any) => { r.artifacts[0].keys[0].contentSha256 = 'ABC'; },
      (r: any) => { r.artifacts[0].endorsed = true; },
      (r: any) => { delete r.artifacts[0].provenance.url; },
      (r: any) => { r.registryVersion = 2; },
      (r: any) => { r.artifacts = []; },
    ]) expect(load(bad)).toThrow(RegistryError);
  });
});

describe('a supplied key that is on record', () => {
  it('uses fixture files that are exactly the Semaphore fixture and its depth-3 key', () => {
    const imported = importSemaphoreV4(validText);
    if (!imported.ok) throw new Error(imported.reason);
    const p = imported.proof.points.map(String);
    expect(JSON.parse(semaphore.proof)).toEqual({ pi_a: [p[0], p[1], '1'], pi_b: [[p[3], p[2]], [p[5], p[4]], ['1', '0']], pi_c: [p[6], p[7], '1'], protocol: 'groth16', curve: 'bn128' });
    expect(JSON.parse(semaphore.publicInputs)).toEqual(publicSignals(imported.proof));
    expect(JSON.parse(semaphore.verificationKey)).toEqual(keys.keyForDepth(3));
  });

  it('names the key and answers each question about it separately', async () => {
    const report = supplied(await check(semaphore));
    expect(report.outcome).toBe('valid');
    expect(report.keyRecognition).toMatchObject({
      match: 'exact',
      key: 'tree depth 3',
      registry: { revision: 4, sha256: KEY_REGISTRY_SHA256 },
      artifact: { id: 'semaphore-v4-verification-keys', circuitLink: { status: 'partly-established' }, entryReview: { status: 'unreviewed' } },
      explanation: { adapter: 'semaphore-v4', review: { status: 'unreviewed' }, applied: false },
    });
    const shown = renderReport(report);
    for (const line of [
      'Verification key: Recognised: an exact match to a recorded key (Semaphore v4 Groth16 verification keys, one for each Merkle tree depth from 1 to 32; tree depth 3).',
      'Where the recorded key came from: Semaphore (Privacy and Scaling Explorations), package @semaphore-protocol/proof 4.14.3',
      'Tied to that circuit source: Partly established.',
      'This record: NOT REVIEWED.',
      'Explanation of the circuit: this tool has one (adapter semaphore-v4), which this report does not apply. NOT REVIEWED.',
      'Cryptographic verification: PASSED',
      'the match adds nothing to them',
    ]) expect(shown).toContain(line);
    // Recognising the key does not bring in the circuit's explanation.
    expect(shown).toContain('This report does not explain what that circuit checks.');
    expect(shown).not.toMatch(/membership|nullifier|group root|Application checks/);
    expect(shown).not.toContain('A key can be made for a circuit that accepts anything.');
    expect(report.publicInputs).toHaveLength(4);
  });

  it('recognises the key however its file is laid out', async () => {
    const key = JSON.parse(semaphore.verificationKey);
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(key).reverse()));
    const [plain, other] = [supplied(await check(semaphore)), supplied(await check({ ...semaphore, verificationKey: reordered }))];
    expect(other.keyRecognition).toEqual(plain.keyRecognition);
    expect(other.verification.verificationKeyContentSha256).toBe(plain.verification.verificationKeyContentSha256);
    expect(other.verification.verificationKeySha256).not.toBe(plain.verification.verificationKeySha256);
  });

  it('does not recognise a key that differs anywhere', async () => {
    const key = JSON.parse(semaphore.verificationKey);
    // A value the verifier does not read: the proof still passes, the key is still unknown.
    const unread = structuredClone(key);
    unread.vk_alphabeta_12[0][0][0] = (BigInt(unread.vk_alphabeta_12[0][0][0]) + 1n).toString();
    const passed = supplied(await check({ ...semaphore, verificationKey: JSON.stringify(unread) }));
    expect(passed).toMatchObject({ outcome: 'valid', keyRecognition: { match: 'none' } });
    expect(renderReport(passed)).toContain('Verification key: Not recognised.');
    expect(renderReport(passed)).toContain('A key can be made for a circuit that accepts anything.');
    // A value it does read.
    const reorderedPoints = { ...key, IC: [key.IC[0], key.IC[2], key.IC[1], key.IC[3], key.IC[4]] };
    expect(supplied(await check({ ...semaphore, verificationKey: JSON.stringify(reorderedPoints) }))).toMatchObject({ outcome: 'invalid', keyRecognition: { match: 'none' } });
  });

  it('reports a recorded key as recorded even when the proof fails under it', async () => {
    const report = supplied(await check({ ...semaphore, verificationKey: JSON.stringify(keys.keyForDepth(4)) }));
    expect(report).toMatchObject({ outcome: 'invalid', keyRecognition: { match: 'exact', key: 'tree depth 4' } });
    const shown = renderReport(report);
    expect(shown).toMatch(/^Claim: None/);
    expect(shown).toContain('Cryptographic verification: FAILED');
    expect(shown).toContain('tree depth 4');
  });

  it('leaves an unknown key unknown', async () => {
    for (const system of ['groth16-bn128', 'groth16-bls12381', 'plonk-bn128', 'fflonk-bn128']) {
      const report = supplied(await check({ proof: fixture(`${system}.proof.json`), publicInputs: fixture(`${system}.public.json`), verificationKey: fixture(`${system}.key.json`) }));
      expect(report).toMatchObject({ outcome: 'valid', keyRecognition: { match: 'none' } });
      expect(renderReport(report)).toContain('This tool does not know what that circuit checks.');
    }
    // The file holding all 32 keys is not itself a key.
    expect(await check({ ...semaphore, verificationKey: readFileSync(join(root, 'artifacts/semaphore-v4/verification-keys.json'), 'utf8') })).toMatchObject({ outcome: 'unsupported' });
  });

  it('gives the same result on the command line and through an export', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumenlenz-registry-'));
    // A file name that claims a circuit changes nothing.
    const at = { proof: join(dir, 'age-over-18.proof.json'), publicInputs: join(dir, 'public.json'), verificationKey: join(dir, 'official-passport-key.json') };
    writeFileSync(at.proof, semaphore.proof);
    writeFileSync(at.publicInputs, semaphore.publicInputs);
    writeFileSync(at.verificationKey, semaphore.verificationKey);
    const exported = join(dir, 'evidence.json');
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 60_000 });
    const done = cli('check', at.proof, '--public', at.publicInputs, '--key', at.verificationKey, '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout.trimEnd()).toBe(renderReport(await check(semaphore)));
    expect(done.stdout).not.toMatch(/passport|over-18/);
    expect(cli('rerun', exported).stdout).toMatch(/^REPRODUCED/);

    const forged = JSON.parse(writeExport(semaphore, await check(semaphore)));
    forged.report.keyRecognition.artifact.entryReview = { status: 'reviewed', reviewer: 'A. Auditor', date: '2026-10-11', note: 'Checked.' };
    forged.report.keyRecognition.artifact.circuitLink.status = 'established';
    expect(await rerunExport(JSON.stringify(forged), check)).toMatchObject({ reproduced: false, kind: 'different', fields: ['keyRecognition'] });
  });
});
