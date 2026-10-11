import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { AdapterError } from '../src/adapter.js';
import { rerunExport, writeExport } from '../src/export.js';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { bindRecordedCircuit } from '../src/recorded/bind.js';
import { readPublicInput } from '../src/recorded/reading.js';
import { keyContentSha256, loadKeyRegistry } from '../src/registry.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';
import { sha256Hex, utf8 } from '../src/sha256.js';
import { snarkjsSuppliedKeyEngine, stopSnarkjs } from '../src/snarkjs-engine.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (path: string): string => readFileSync(join(root, path), 'utf8');
const at = {
  proof: join(root, 'tests/fixtures/snarkjs/proof-of-twitter.proof.json'),
  publicInputs: join(root, 'tests/fixtures/snarkjs/proof-of-twitter.public.json'),
  verificationKey: join(root, 'artifacts/zk-email-proof-of-twitter/verification-key.json'),
};
const good: Required<ProofInputs> = { proof: readFileSync(at.proof, 'utf8'), publicInputs: readFileSync(at.publicInputs, 'utf8'), verificationKey: readFileSync(at.verificationKey, 'utf8') };
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopSnarkjs);

const adapterBytes = readFileSync(join(root, 'adapters/zk-email-proof-of-twitter/adapter.json'));
const lock = JSON.parse(read('adapters/zk-email-proof-of-twitter/lock.json'));
const registryBytes = readFileSync(join(root, 'registry/keys.json'));
const parts = () => ({ adapterBytes, lock, registry: loadKeyRegistry(registryBytes), verifier: snarkjsSuppliedKeyEngine.identity });

describe('Proof of Twitter: a recorded key with an explanation bound to it', () => {
  it('records the published key file and the key inside it', () => {
    const entry = loadKeyRegistry(registryBytes).artifacts.find((artifact) => artifact.id === 'zk-email-proof-of-twitter-verification-key')!;
    expect(entry.provenance.sha256).toBe(sha256Hex(utf8(good.verificationKey)));
    expect(entry.keys).toEqual([{ label: "the circuit's only key", contentSha256: keyContentSha256(JSON.parse(good.verificationKey)) }]);
    expect(entry.circuitLink.status).toBe('unconfirmed');
    expect(JSON.parse(read('artifacts/zk-email-proof-of-twitter/key-check.json'))).toMatchObject({
      publishedKey: { sha256: entry.provenance.sha256, equalsBundledFile: true },
      verifierContract: { keyValuesEqualConstants: true },
      contractTest: { holdsEveryFixtureNumber: true },
    });
  });

  it('accepts the publisher\'s own test proof and states each check separately', async () => {
    const report = await check(good);
    if (report.outcome !== 'valid' || report.basis !== 'recorded-circuit') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.public).toMatchObject([{ name: 'signing key hash' }, { name: 'username', valueIfText: 'zktestemail' }, { name: 'address', valueAsAddress: '0xcbcac0388501e5317304d7da1ee3a082df67336d' }]);
    expect(report.public[0]).not.toHaveProperty('valueIfText');
    expect(report.keyRecognition).toMatchObject({ match: 'exact', artifact: { circuitLink: { status: 'unconfirmed' }, entryReview: { status: 'unreviewed' } }, explanation: { adapter: 'zk-email-proof-of-twitter', applied: true, review: { status: 'unreviewed' } } });
    expect(report.explanation).toMatchObject({ adapter: { id: 'zk-email-proof-of-twitter', revision: 1, sha256: sha256Hex(adapterBytes) }, review: { status: 'unreviewed' } });
    expect(report.applicationChecks.map((entry) => [entry.id, entry.status])).toEqual([
      ['dkim-key-authentication', 'not-performed'], ['address-belongs-to-presenter', 'not-performed'], ['proof-unused', 'not-performed'], ['email-freshness', 'not-performed'],
    ]);
    const shown = renderReport(report);
    // 1. Mathematical verification. 2. Which circuit, and its review. 3. The signing key. 4. Application checks.
    for (const line of [
      'Cryptographic verification: PASSED using snarkjs 0.7.6',
      'Verification key: Recognised: an exact match to a recorded key',
      'Tied to that circuit source: Unconfirmed.',
      'This record: NOT REVIEWED.',
      'Explanation: NOT REVIEWED.',
      'Checks not performed:',
      '  - Whether the signing key belongs to x.com or to any other domain.',
      '  - Whether this proof, or another proof made from the same email, has been presented before.',
      'This does not establish that the email came from X.',
      'It shows that someone had a copy of such an email.',
      'This does not establish unique personhood',
      'not a blueprint from its registry',
      'This tool has no record of how it was run.',
    ]) expect(shown).toContain(line);
  });

  it('claims nothing the circuit does not enforce', async () => {
    const report = await check(good);
    if (report.outcome !== 'valid' || report.basis !== 'recorded-circuit') throw new Error(report.outcome);
    const fixed = [report.claim, ...report.hidden, ...report.limits, ...report.assumptions].join(' ');
    // No value from the proof, and no word of ownership, identity or authenticity, in the fixed wording.
    expect(fixed).not.toMatch(/zktestemail|0xcbca|[0-9]{12}/);
    expect(report.claim).not.toMatch(/\b(owns?|controls?|account holder|verified|authentic|from X|from Twitter|x\.com|is the user)\b/i);
    expect(report.claim).toMatch(/^Someone had an email/);
  });

  it('rejects the proof when any number in it or any public input changes', async () => {
    const proof = JSON.parse(good.proof);
    for (const change of [
      (p: any) => { p.pi_a[0] = (BigInt(p.pi_a[0]) + 1n).toString(); },
      (p: any) => { p.pi_b[1][0] = (BigInt(p.pi_b[1][0]) + 1n).toString(); },
      (p: any) => { [p.pi_a, p.pi_c] = [p.pi_c, p.pi_a]; },
    ]) {
      const copy = structuredClone(proof);
      change(copy);
      const report = await check({ ...good, proof: JSON.stringify(copy) });
      expect(report.outcome).toBe('invalid');
      expect(report).not.toHaveProperty('claim');
    }
    const signals = JSON.parse(good.publicInputs) as string[];
    for (let i = 0; i < signals.length; i++) {
      const other = signals.map((signal, at) => (at === i ? (BigInt(signal) + 1n).toString() : signal));
      const report = await check({ ...good, publicInputs: JSON.stringify(other) });
      // Still the recorded key, so it is named; the proof establishes nothing.
      expect(report).toMatchObject({ outcome: 'invalid', basis: 'supplied-key', keyRecognition: { match: 'exact' } });
      expect(renderReport(report)).toMatch(/^Claim: None/);
      expect(renderReport(report)).not.toMatch(/Someone had an email|Checks not performed/);
    }
    // Another username of the same shape: a different statement, so not this proof.
    const swapped = [signals[0], '131061634216091175196322683', signals[2]];
    expect((await check({ ...good, publicInputs: JSON.stringify(swapped) })).outcome).toBe('invalid');
  });

  it('never shows this explanation for another key', async () => {
    const key = JSON.parse(good.verificationKey);
    // A different key under which the proof fails.
    const reordered = JSON.stringify({ ...key, IC: [key.IC[0], key.IC[2], key.IC[1], key.IC[3]] });
    expect(await check({ ...good, verificationKey: reordered })).toMatchObject({ outcome: 'invalid', keyRecognition: { match: 'none' } });
    // A different key under which the proof still passes, because the verifier does not read the changed value.
    const unread = structuredClone(key);
    unread.vk_alphabeta_12[1][2][1] = (BigInt(unread.vk_alphabeta_12[1][2][1]) + 1n).toString();
    const passed = await check({ ...good, verificationKey: JSON.stringify(unread) });
    expect(passed).toMatchObject({ outcome: 'valid', basis: 'supplied-key', keyRecognition: { match: 'none' } });
    expect(renderReport(passed)).not.toMatch(/Someone had an email|username|x\.com/);
    // Another circuit's key and proof are not explained with this wording either.
    const other = (kind: string): string => read(`tests/fixtures/snarkjs/groth16-bn128.${kind}.json`);
    expect(await check({ proof: other('proof'), publicInputs: other('public'), verificationKey: other('key') })).toMatchObject({ outcome: 'valid', basis: 'supplied-key' });
    expect(await check({ ...good, verificationKey: other('key') })).toMatchObject({ outcome: 'unsupported' });
    // The same key in another file layout is the same key.
    expect(await check({ ...good, verificationKey: JSON.stringify(key) })).toMatchObject({ outcome: 'valid', basis: 'recorded-circuit' });
  });

  it('refuses to bind when any link between explanation, key file and registry is exchanged', () => {
    expect(bindRecordedCircuit(parts())).toMatchObject({ artifactId: 'zk-email-proof-of-twitter-verification-key', keyContentSha256: keyContentSha256(JSON.parse(good.verificationKey)) });
    const edited = (change: (manifest: any) => void) => {
      const manifest = JSON.parse(adapterBytes.toString());
      change(manifest);
      const bytes = utf8(JSON.stringify(manifest));
      return { bytes, sha256: sha256Hex(bytes) };
    };
    // Changed wording under the old lock.
    const bolder = edited((m) => { m.explanation.claim = 'The holder controls this X account.'; });
    expect(() => bindRecordedCircuit({ ...parts(), adapterBytes: bolder.bytes })).toThrow(AdapterError);
    // Each remaining case re-locks the edited file, so only the named link is wrong.
    for (const change of [
      (m: any) => { m.artifacts[0].sha256 = 'd96ec60593b6fc2334f1f04e008e07425d5536d7777f6ac21d996fc80779b3c9'; },
      (m: any) => { m.circuit.source = 'https://example.org/another.circom'; },
      (m: any) => { m.format = 'semaphore-v4'; },
      (m: any) => { m.verifier.version = '0.7.5'; },
      (m: any) => { m.artifacts.push({ ...m.artifacts[0] }); },
      (m: any) => { m.id = 'semaphore-v4'; },
      (m: any) => { m.id = 'unlisted'; },
      (m: any) => { m.publicFields[1].reading = 'html'; },
      (m: any) => { m.review = { status: 'reviewed', note: 'Fine.' }; },
    ]) {
      const next = edited(change);
      const manifest = JSON.parse(new TextDecoder().decode(next.bytes));
      expect(() => bindRecordedCircuit({ ...parts(), adapterBytes: next.bytes, lock: { id: manifest.id, revision: manifest.revision, sha256: next.sha256 } })).toThrow(AdapterError);
    }
  });

  it('shows a reading aid only when the number has that shape', () => {
    expect(readPublicInput('131061634216091175196322682', 'packed-ascii')).toEqual({ kind: 'text', value: 'zktestemail' });
    expect(readPublicInput('0', 'packed-ascii')).toBeUndefined();
    expect(readPublicInput('10', 'packed-ascii')).toBeUndefined(); // a line break
    expect(readPublicInput((1n << 250n).toString(), 'packed-ascii')).toBeUndefined();
    expect(readPublicInput('1983664618407009423875829639306275185491946247764487749439145140682408188330', 'ethereum-address')).toBeUndefined();
    expect(readPublicInput('1', 'ethereum-address')).toEqual({ kind: 'address', value: '0x0000000000000000000000000000000000000001' });
  });

  it('gives the same report on the command line, and notices a forged export', async () => {
    const report = await check(good);
    const fromCli = execFileSync(process.execPath, [join(root, 'dist/cli.js'), 'check', at.proof, '--public', at.publicInputs, '--key', at.verificationKey], { encoding: 'utf8' });
    expect(fromCli.trimEnd()).toBe(renderReport(report));
    const bundle = JSON.parse(writeExport(good, report));
    expect(await rerunExport(JSON.stringify(bundle), check)).toMatchObject({ reproduced: true });
    for (const forge of [
      (r: any) => { r.claim = 'The holder controls the X account @zktestemail.'; },
      (r: any) => { r.applicationChecks = r.applicationChecks.filter((entry: any) => entry.id !== 'dkim-key-authentication'); },
      (r: any) => { r.applicationChecks[0].status = 'performed'; },
      (r: any) => { r.explanation.review = { status: 'reviewed', reviewer: 'A. Auditor', date: '2026-10-11', note: 'Checked.' }; },
      (r: any) => { r.keyRecognition.artifact.circuitLink.status = 'established'; },
      (r: any) => { r.public[1].valueIfText = 'elonmusk'; },
    ]) {
      const forged = structuredClone(bundle);
      forge(forged.report);
      expect(await rerunExport(JSON.stringify(forged), check)).toMatchObject({ reproduced: false, kind: 'different' });
    }
  });
});
