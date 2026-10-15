import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { rerunExport, writeExport } from '../src/export.js';
import { BASE_FIELD } from '../src/field.js';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { stopEngines } from '../src/node/stop.js';
import { renderReport, type Report } from '../src/report.js';
import { loadRiscZeroParameters, RISC_ZERO_PARAMETERS_SHA256, RiscZeroParametersError } from '../src/risc-zero/parameters.js';
import { claimDigest, verifyRiscZero } from '../src/risc-zero/verify.js';
import { scan } from '../src/scan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const receiptPath = join(root, 'tests/fixtures/risc-zero/nethermind-test-receipt.txt');
const receipt = readFileSync(receiptPath, 'utf8');
const [seal, imageId, journalSha256] = receipt.trimEnd().split('\n') as [string, string, string];
const parametersBytes = readFileSync(join(root, 'artifacts/risc-zero-groth16/parameters-3.0.0.json'));
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopEngines);

const lines = (...parts: string[]): string => `${parts.join('\n')}\n`;
/** Replaces one hex digit with another. */
const changed = (hex: string, at: number): string => `${hex.slice(0, at)}${hex[at] === '0' ? '1' : '0'}${hex.slice(at + 1)}`;
const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('RISC Zero Groth16 receipts', () => {
  it('pins the verifier parameters and refuses any other file', () => {
    expect(createHash('sha256').update(parametersBytes).digest('hex')).toBe(RISC_ZERO_PARAMETERS_SHA256);
    const parameters = loadRiscZeroParameters(parametersBytes);
    expect(parameters).toMatchObject({ version: '3.0.0', selector: '73c457ba', key: { protocol: 'groth16', curve: 'bn128', nPublic: 5 } });
    expect((parameters.key.IC as unknown[]).length).toBe(6);
    expect(() => loadRiscZeroParameters(Buffer.from(parametersBytes.toString().replace('3.0.0', '3.0.1')))).toThrow(RiscZeroParametersError);
    expect(() => loadRiscZeroParameters(Buffer.from(`${parametersBytes.toString()} `))).toThrow(/expected/);
    // The record of comparing the file with RISC Zero's own contracts is for this file.
    const record = JSON.parse(readFileSync(join(root, 'artifacts/risc-zero-groth16/parameters-check.json'), 'utf8'));
    expect(record).toMatchObject({ file: { sha256: RISC_ZERO_PARAMETERS_SHA256 }, copiedFrom: { identicalBytes: true }, comparedWith: { keyConstantsCompared: 26, keyConstantsDiffering: [], controlRootEqual: true, bn254ControlIdEqual: true } });
  });

  it('builds the statement the way RISC Zero does, with every part of it counted', () => {
    const id = Buffer.from(imageId, 'hex');
    const journal = Buffer.from(journalSha256, 'hex');
    // The journal of the test receipt is the four bytes 01 00 00 78.
    expect(createHash('sha256').update(Buffer.from('01000078', 'hex')).digest('hex')).toBe(journalSha256);
    const digest = hex(claimDigest(id, journal));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(hex(claimDigest(journal, id))).not.toBe(digest);
    for (let at = 0; at < 64; at += 7) {
      expect(hex(claimDigest(Buffer.from(changed(imageId, at), 'hex'), journal))).not.toBe(digest);
      expect(hex(claimDigest(id, Buffer.from(changed(journalSha256, at), 'hex')))).not.toBe(digest);
    }
  });

  it('accepts a real receipt and says only that a program with this image ID ran', async () => {
    const report = await check({ proof: receipt });
    if (report.outcome !== 'valid' || report.basis !== 'risc-zero-program') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.program).toEqual({ imageId });
    expect(report.journal).toEqual({ sha256: journalSha256 });
    expect(report.verification).toEqual({
      result: 'passed',
      verifier: { name: 'snarkjs', version: '0.7.6', alsoCheckedBy: { name: 'ark-groth16', version: '0.6.0' } },
      proofSystem: { name: 'risc-zero-groth16', parametersVersion: '3.0.0', selector: '73c457ba', parametersSha256: RISC_ZERO_PARAMETERS_SHA256 },
    });
    expect(report.input.sha256).toBe(createHash('sha256').update(readFileSync(receiptPath)).digest('hex'));
    const shown = renderReport(report);
    for (const line of [
      'Claim: A program with the image ID shown ran in the RISC Zero virtual machine, stopped normally, and wrote a journal with the SHA-256 shown. This tool does not know what that program does.',
      `  - image ID of the program: ${imageId}`,
      `  - SHA-256 of the journal: ${journalSha256}`,
      'PASSED using snarkjs 0.7.6 and ark-groth16 0.6.0, two independent verifiers that agree (RISC Zero Groth16 receipt, verifier parameters version 3.0.0).',
      'NOT REVIEWED',
      'This tool did not see the journal.',
      'This is not a statement about Stellar or any other network.',
      'Only receipts made for version 3.0.0',
    ]) expect(shown).toContain(line);
    // The same receipt without its last line break is the same receipt, and a different file.
    const bare = await check({ proof: receipt.trimEnd() });
    expect(bare).toMatchObject({ outcome: 'valid', program: { imageId } });
    expect(bare.input.sha256).not.toBe(report.input.sha256);
  });

  it('rejects a receipt after a change to the seal, the image ID or the journal hash', async () => {
    for (let at = 8; at < 520; at += 13) {
      const report = await check({ proof: lines(changed(seal, at), imageId, journalSha256) });
      // A changed point can also stop being a number in the field, which is refused before the verifier runs.
      expect(['invalid', 'unsupported'], `seal digit ${at}`).toContain(report.outcome);
      expect(report, `seal digit ${at}`).not.toHaveProperty('claim');
    }
    for (let at = 0; at < 64; at += 3) {
      for (const text of [lines(seal, changed(imageId, at), journalSha256), lines(seal, imageId, changed(journalSha256, at))]) {
        const report = await check({ proof: text });
        expect(report, `digit ${at}`).toMatchObject({ outcome: 'invalid', basis: 'risc-zero-program', verification: { result: 'failed' } });
        expect(report).not.toHaveProperty('claim');
        expect(report).not.toHaveProperty('program');
      }
    }
    expect((await check({ proof: lines(seal, journalSha256, imageId) })).outcome).toBe('invalid');
    expect(renderReport(await check({ proof: lines(seal, changed(imageId, 0), journalSha256) }))).toMatch(/^Claim: None/);
  }, 120_000);

  it('refuses files it cannot read one way, without calling them invalid', async () => {
    const outside = (BASE_FIELD + 5n).toString(16).padStart(64, '0');
    for (const [text, reason] of [
      [lines(`00000000${seal.slice(8)}`, imageId, journalSha256), /other verifier parameters than version 3\.0\.0/],
      [lines(`${seal.slice(0, 8)}${outside}${seal.slice(72)}`, imageId, journalSha256), /outside the field/],
    ] as [string, RegExp][]) {
      expect(await check({ proof: text })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(reason) });
    }
    // Anything that is not exactly three lines of lower-case hex is not read as a receipt at all.
    for (const text of [lines(seal.toUpperCase(), imageId, journalSha256), lines(`0x${seal}`, imageId, journalSha256), lines(seal, imageId), lines(seal, imageId, journalSha256, ''), `${seal}\r\n${imageId}\r\n${journalSha256}\r\n`, ` ${receipt}`, lines(seal.slice(2), imageId, journalSha256)]) {
      const report = await check({ proof: text });
      expect(report.outcome, JSON.stringify(text.slice(0, 20))).toBe('unsupported');
      expect(await verifyRiscZero(text, scanning.riscZero)).toMatchObject({ status: 'unsupported' });
    }
    // A receipt takes no key: with one, it is not read as a receipt.
    expect(await check({ proof: receipt, publicInputs: '[]', verificationKey: '{}' })).toMatchObject({ outcome: 'unsupported' });
  });

  it('reports a verifier that fails as an error, never as a rejected receipt', async () => {
    const withEngine = (verify: () => Promise<boolean>) => verifyRiscZero(receipt, { parameters: scanning.riscZero.parameters, engine: { identity: scanning.riscZero.engine.identity, verify } });
    expect(await withEngine(async () => { throw new Error('boom'); })).toEqual({ status: 'error', message: 'boom' });
    expect(await withEngine(async () => 'yes' as unknown as boolean)).toMatchObject({ status: 'error' });
    expect(await withEngine(async () => false)).toMatchObject({ status: 'invalid' });
  });

  it('checks, exports and reruns from the command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lumenlenz-risc-zero-'));
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120_000 });
    const exported = join(dir, 'evidence.json');
    const done = cli('check', receiptPath, '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout.trimEnd()).toBe(renderReport(await check({ proof: receipt })));
    expect(cli('rerun', exported).stdout).toMatch(/^REPRODUCED/);
    expect(JSON.parse(cli('check', receiptPath, '--json').stdout)).toMatchObject({ outcome: 'valid', basis: 'risc-zero-program' });

    const forged = JSON.parse(writeExport({ proof: receipt }, await check({ proof: receipt })));
    forged.report.claim = 'This proves a payment was made on Stellar.';
    forged.report.program.imageId = '00'.repeat(32);
    expect(await rerunExport(JSON.stringify(forged), check)).toMatchObject({ reproduced: false, fields: ['claim', 'program'] });
  }, 120_000);
});
