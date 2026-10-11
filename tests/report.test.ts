import { afterAll, describe, expect, it } from 'vitest';
import { rerunExport, writeExport } from '../src/export.js';
import { bundledSemaphoreV4 } from '../src/node/bundled.js';
import { stopSnarkjs } from '../src/snarkjs-engine.js';
import { renderReport, type Report } from '../src/report.js';
import { scanSemaphoreV4 } from '../src/semaphore-v4/scan.js';
import { asPaddedAscii } from '../src/semaphore-v4/text.js';
import { plus, text, validText } from './helpers.js';

const bound = await bundledSemaphoreV4();
const scan = (input: string | { proof: string }): Promise<Report> => scanSemaphoreV4(typeof input === 'string' ? input : input.proof, bound);
const claim = bound.adapter.manifest.explanation.claim;
afterAll(stopSnarkjs);

describe('evidence report', () => {
  it('states the claim, what is hidden, what is public, the check and the limits for a valid proof', async () => {
    const report = await scan(validText);
    if (report.outcome !== 'valid' || report.basis !== 'bundled-circuit') throw new Error(report.outcome);
    expect(report.claim).toBe(claim);
    expect(report.public.map((field) => field.name)).toEqual(['group root', 'nullifier', 'hashed message', 'hashed scope']);
    expect(report.verification).toEqual({ result: 'passed', verifier: { name: 'snarkjs', version: '0.7.6' }, verificationKeysSha256: bound.keys.sha256 });
    expect(report.explanation.adapter).toEqual({ id: 'semaphore-v4', revision: bound.adapter.manifest.revision, sha256: bound.adapter.sha256 });
    expect(report.proofFile).toMatchObject({ messageIfText: 'fixture message', scopeIfText: 'fixture scope', merkleTreeDepth: 3 });
    const shown = renderReport(report);
    for (const heading of ['Claim:', 'Hidden by the proof:', 'Public:', 'Cryptographic verification: PASSED', 'Explanation:', 'Application checks not performed:', 'Limits:', 'This result assumes:']) {
      expect(shown).toContain(heading);
    }
    expect(shown).toContain('Explanation: NOT REVIEWED.');
    expect(shown).toContain('Whether this nullifier has been used before.');
    expect(shown).toContain('if this number encodes text, it reads: "fixture message"');
  });

  it('states the unperformed application checks and the limits in JSON as well as in text', async () => {
    const report = JSON.parse(JSON.stringify(await scan(validText))) as Record<string, any>;
    expect(report.applicationChecks).toEqual([
      { id: 'group-root-accepted', status: 'not-performed', description: expect.stringMatching(/accepts this group root/) },
      { id: 'nullifier-unused', status: 'not-performed', description: expect.stringMatching(/nullifier has been used before/) },
    ]);
    expect(report.limits.length).toBeGreaterThan(0);
    expect(report.assumptions.length).toBeGreaterThan(0);
    expect(report.explanation.review.status).toBe('unreviewed');
  });

  it('carries no claim, hidden list or explanation unless the proof passed', async () => {
    const reports = [
      await scan(text((raw) => { raw.nullifier = plus(raw.nullifier, 1n); })),
      await scan('{"proof":"0x7a2f"}'),
      await scanSemaphoreV4(validText, { ...bound, engine: { ...bound.engine, verify: async () => { throw new Error('boom'); } } }),
    ];
    expect(reports.map((report) => report.outcome)).toEqual(['invalid', 'unsupported', 'error']);
    for (const report of reports) {
      expect(report).not.toHaveProperty('claim');
      expect(report).not.toHaveProperty('hidden');
      expect(report).not.toHaveProperty('explanation');
      expect(renderReport(report)).not.toContain(claim);
      expect(renderReport(report)).not.toContain('PASSED');
    }
    expect(renderReport(reports[0]!)).toContain('Claim: None.');
    expect(renderReport(reports[1]!)).toContain('says nothing about whether a proof is valid');
    expect(renderReport(reports[2]!)).toContain('says nothing about whether a proof is valid');
  });

  it('never puts text from the proof file into the explanation', async () => {
    const report = await scan(validText);
    if (report.outcome !== 'valid' || report.basis !== 'bundled-circuit') throw new Error(report.outcome);
    for (const sentence of [report.claim, ...report.hidden, ...report.limits, ...report.assumptions, ...report.applicationChecks.map((check) => check.description)]) {
      expect(sentence).not.toMatch(/[0-9]{10}|fixture/);
    }
  });

  it('gives the same report for the same input every time', async () => {
    expect(JSON.stringify(await scan(validText))).toBe(JSON.stringify(await scan(validText)));
  });
});

describe('reading a message as text', () => {
  const encode = (word: string): bigint => BigInt(`0x${Buffer.from(word).toString('hex').padEnd(64, '0')}`);

  it('reads zero-padded printable ASCII and nothing else', () => {
    expect(asPaddedAscii(encode('vote: yes'))).toBe('vote: yes');
    expect(asPaddedAscii(encode('a'.repeat(31)))).toBe('a'.repeat(31));
    expect(asPaddedAscii(0n)).toBeUndefined();
    expect(asPaddedAscii(1n)).toBeUndefined();
    expect(asPaddedAscii(encode('a'.repeat(32)))).toBeUndefined();
    expect(asPaddedAscii(encode('line\nbreak'))).toBeUndefined();
    expect(asPaddedAscii(encode('a\u0000b'))).toBeUndefined();
    expect(asPaddedAscii(encode('café'))).toBeUndefined();
    expect(asPaddedAscii(encode('‮gnp.exe'))).toBeUndefined();
    expect(asPaddedAscii(1n << 256n)).toBeUndefined();
  });
});

describe('export and rerun', () => {
  it('reproduces an exported report from the proof inside it', async () => {
    const exported = writeExport(validText, await scan(validText));
    expect(await rerunExport(exported, scan)).toMatchObject({ reproduced: true, report: { outcome: 'valid' } });
    const reordered = JSON.stringify(JSON.parse(exported), (_key, value: unknown) =>
      typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).reverse()) : value);
    expect(reordered).not.toBe(exported);
    expect(await rerunExport(reordered, scan)).toMatchObject({ reproduced: true });
  });

  it('reproduces exports of rejected and unsupported inputs too', async () => {
    const tampered = text((raw) => { raw.scope = plus(raw.scope, 1n); });
    expect(await rerunExport(writeExport(tampered, await scan(tampered)), scan)).toMatchObject({ reproduced: true, report: { outcome: 'invalid' } });
    expect(await rerunExport(writeExport('hello', await scan('hello')), scan)).toMatchObject({ reproduced: true, report: { outcome: 'unsupported' } });
  });

  it('does not trust what the export says about itself', async () => {
    const tampered = text((raw) => { raw.nullifier = plus(raw.nullifier, 1n); });
    const forged = JSON.parse(writeExport(validText, await scan(validText))) as { proof: string; report: Record<string, any> };

    const swappedProof = await rerunExport(JSON.stringify({ ...forged, proof: tampered }), scan);
    expect(swappedProof).toMatchObject({ reproduced: false, kind: 'different', report: { outcome: 'invalid' } });

    const strongerClaim = structuredClone(forged);
    strongerClaim.report.claim = 'This proves the holder is a unique human.';
    expect(await rerunExport(JSON.stringify(strongerClaim), scan)).toMatchObject({ reproduced: false, kind: 'different', fields: ['claim'] });

    const fewerLimits = structuredClone(forged);
    fewerLimits.report.limits = [];
    fewerLimits.report.explanation.review = { status: 'reviewed', note: 'ok', reviewer: 'X', date: '2026-10-11' };
    expect(await rerunExport(JSON.stringify(fewerLimits), scan)).toMatchObject({ reproduced: false, fields: ['explanation', 'limits'] });

    const extra = structuredClone(forged);
    extra.report.endorsedBy = 'Someone';
    expect(await rerunExport(JSON.stringify(extra), scan)).toMatchObject({ reproduced: false, fields: ['endorsedBy'] });
  });

  it('refuses exports it cannot read without running anything', async () => {
    const never = async (): Promise<Report> => { throw new Error('must not run'); };
    for (const bad of ['nope', '[]', '{}', '{"exportVersion":2,"proof":"x","report":{}}', '{"exportVersion":1,"proof":5,"report":{}}', '{"exportVersion":1,"proof":"x","report":[]}', `{"exportVersion":1,"proof":"${'x'.repeat(17_000)}","report":{}}`, '{"exportVersion":1,"proof":"x","publicInputs":5,"report":{}}', '{"exportVersion":1,"proof":"x","verificationKey":[],"report":{}}', ' '.repeat(800_000)]) {
      expect(await rerunExport(bad, never)).toMatchObject({ reproduced: false, kind: 'unreadable' });
    }
  });
});
