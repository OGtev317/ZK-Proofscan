import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { stopEngines } from '../src/node/stop.js';
import { keyContentSha256 } from '../src/registry.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const folder = join(root, 'artifacts/stellar-private-payments');
const files = readdirSync(folder).filter((name) => name.endsWith('_vk.json')).sort();
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopEngines);

// A real proof, for another circuit. No proof for these circuits was available.
const otherProof = readFileSync(join(root, 'tests/fixtures/snarkjs/groth16-bn128.proof.json'), 'utf8');
const inputsFor = (key: { nPublic: number }): string => JSON.stringify(Array.from({ length: key.nPublic }, (_, i) => String(i + 1)));

describe('Stellar Private Payments testnet keys', () => {
  it('records each published key file, derived here again from the copy in this repository', () => {
    expect(files).toHaveLength(16);
    const recorded = scanning.registry.artifacts.filter((entry) => entry.id.startsWith('stellar-private-payments-testnet-'));
    expect(recorded).toHaveLength(16);
    for (const name of files) {
      const bytes = readFileSync(join(folder, name));
      const entry = recorded.find((candidate) => candidate.provenance.file === `deployments/testnet/circuit_keys/${name}`);
      expect(entry, name).toBeDefined();
      expect(entry!.provenance.sha256, name).toBe(createHash('sha256').update(bytes).digest('hex'));
      expect(entry!.keys, name).toEqual([{ label: "the circuit's only key", contentSha256: keyContentSha256(JSON.parse(bytes.toString('utf8'))) }]);
      // Nothing is claimed for these keys beyond where they were published.
      expect(entry!.circuitLink.status).toBe('unconfirmed');
      expect(entry!.circuitLink.note).toContain('no trusted ceremony');
      // Only the blocklist pool's key has an explanation.
      expect(entry!.explanationAdapter).toBe(name === 'policy_tx_2_2_B_vk.json' ? 'stellar-private-payments-blocklist' : null);
      expect(entry!.entryReview.status).toBe('unreviewed');
      expect(entry!.provenance.url).toContain('ef42a47ee6a84b5c7a289b979e2fa2526c73aabc');
    }
  });

  it('reads every key, names it, and rejects a proof made for another circuit', async () => {
    for (const name of files) {
      const verificationKey = readFileSync(join(folder, name), 'utf8');
      const report = await check({ proof: otherProof, publicInputs: inputsFor(JSON.parse(verificationKey)), verificationKey });
      if (report.outcome !== 'invalid' || report.basis !== 'supplied-key') throw new Error(`${name}: ${JSON.stringify(report).slice(0, 200)}`);
      expect(report.keyRecognition, name).toMatchObject({ match: 'exact', artifact: { provenance: { publisher: 'Nethermind' } } });
      // A rejected proof is never explained, whether or not its key has an explanation.
      if (name !== 'policy_tx_2_2_B_vk.json') expect(report.keyRecognition, name).toMatchObject({ explanation: null });
      expect(report).not.toHaveProperty('claim');
    }
    const verificationKey = readFileSync(join(folder, 'policy_tx_2_2_B_vk.json'), 'utf8');
    const shown = renderReport(await check({ proof: otherProof, publicInputs: inputsFor(JSON.parse(verificationKey)), verificationKey }));
    for (const line of [
      'Claim: None.',
      'Recognised: an exact match to a recorded key (Stellar Private Payments (Nethermind), testnet key. Pool transaction with two inputs and two outputs, blocklist;',
      'Tied to that circuit source: Unconfirmed.',
      'whoever made it could make passing proofs of false statements',
      'This record: NOT REVIEWED.',
      'Explanation of the circuit: this tool has one (adapter stellar-private-payments-blocklist), which this report does not apply.',
    ]) expect(shown).toContain(line);
  });

  it('does not recognise a key that differs in one value, or the wrong number of inputs', async () => {
    const key = JSON.parse(readFileSync(join(folder, 'policy_tx_2_2_vk.json'), 'utf8'));
    const changed = structuredClone(key);
    changed.IC[3][0] = (BigInt(changed.IC[3][0]) + 1n).toString();
    expect(await check({ proof: otherProof, publicInputs: inputsFor(key), verificationKey: JSON.stringify(changed) })).toMatchObject({ outcome: 'invalid', keyRecognition: { match: 'none' } });
    expect(await check({ proof: otherProof, publicInputs: '["1"]', verificationKey: JSON.stringify(key) })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/number of public inputs/) });
  });

  it('accepts a Groth16 key with or without the value the verifier does not read, and nothing else missing', async () => {
    // These keys are exported without `vk_alphabeta_12`; snarkjs writes it. Found when these keys were first refused.
    const part = (kind: string): string => readFileSync(join(root, `tests/fixtures/snarkjs/groth16-bn128.${kind}.json`), 'utf8');
    const { vk_alphabeta_12: unread, ...without } = JSON.parse(part('key'));
    expect(unread).toBeDefined();
    const inputs = { proof: part('proof'), publicInputs: part('public') };
    const full = await check({ ...inputs, verificationKey: part('key') });
    const short = await check({ ...inputs, verificationKey: JSON.stringify(without) });
    expect(full.outcome).toBe('valid');
    expect(short.outcome).toBe('valid');
    // Two spellings of one key verify alike and are different files with different hashes, as the report shows.
    expect((short as { verification: { verificationKeyContentSha256: string } }).verification.verificationKeyContentSha256).not.toBe((full as { verification: { verificationKeyContentSha256: string } }).verification.verificationKeyContentSha256);
    for (const field of ['vk_alpha_1', 'vk_beta_2', 'vk_gamma_2', 'vk_delta_2', 'IC', 'nPublic']) {
      const { [field]: _gone, ...rest } = without;
      expect(await check({ ...inputs, verificationKey: JSON.stringify(rest) }), field).toMatchObject({ outcome: 'unsupported' });
    }
    expect(await check({ ...inputs, verificationKey: JSON.stringify({ ...without, vk_alphabeta_12: 'x' }) })).toMatchObject({ outcome: 'unsupported' });
  });
});
