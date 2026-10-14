import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { CairoRejected, CairoUnreadable, MINIMUM_SECURITY_BITS, readCairoParameters, verifyCairo, type CairoEngine } from '../src/cairo/verify.js';
import { rerunExport, writeExport } from '../src/export.js';
import type { ProofInputs } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { swiftnessFailure } from '../src/cairo/swiftness.js';
import { SWIFTNESS_VERSION, swiftnessEngine } from '../src/node/cairo-engine.js';
import { stopEngines } from '../src/node/stop.js';
import { renderReport, type Report } from '../src/report.js';
import { scan } from '../src/scan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = (name: string): string => join(root, 'tests/fixtures/cairo', name);
const strong = readFileSync(path('dynamic-stone6-96-bits.json'), 'utf8');
const weak = readFileSync(path('starknet-stone5-70-bits.json'), 'utf8');
const scanning = await bundledScanning();
const check = (inputs: ProofInputs): Promise<Report> => scan(inputs, scanning);
afterAll(stopEngines);

/** Replaces one number where a parameter is written, leaving the rest of the file as it was. */
const withParameter = (text: string, name: string, value: number): string => {
  const pattern = new RegExp(`"${name}"\\s*:\\s*[0-9]+`);
  if (!pattern.test(text)) throw new Error(`no ${name}`);
  return text.replace(pattern, `"${name}": ${value}`);
};
const HASH = '0x5bfa89872e1bf7630bedb115afcaa176e9570b13e055a416a90e4f53b6e1468';

describe('Cairo proofs (Stone prover layout)', () => {
  it('pins the verifier version', () => {
    expect(JSON.parse(readFileSync(join(root, 'node_modules/swiftness/package.json'), 'utf8')).version).toBe(SWIFTNESS_VERSION);
    expect(swiftnessEngine.identity).toEqual({ name: 'swiftness', version: SWIFTNESS_VERSION });
    expect(MINIMUM_SECURITY_BITS).toBe(80);
  });

  it('accepts a real proof and says only that a program with this hash ran', async () => {
    const report = await check({ proof: strong });
    if (report.outcome !== 'valid' || report.basis !== 'cairo-program') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.program).toEqual({ hash: HASH });
    expect(report.output).toEqual(['0x1', '0x3', '0x692250f91dddc2f26a007e6d4d8199b69aef55ec132392c7be067b715c01adb', '0x2710']);
    expect(report.verification).toEqual({
      result: 'passed',
      verifier: { name: 'swiftness', version: SWIFTNESS_VERSION },
      proofSystem: { name: 'cairo-stark', proverFormat: 'stone6', layout: 'dynamic', commitmentHash: 'blake256_masked248_lsb', queries: 32, logCosets: 2, proofOfWorkBits: 32, securityBits: 96 },
    });
    expect(report.input.sha256).toBe(createHash('sha256').update(readFileSync(path('dynamic-stone6-96-bits.json'))).digest('hex'));
    const shown = renderReport(report);
    for (const line of [
      'Claim: A Cairo program with the hash shown ran from start to finish and wrote the output shown. This tool does not know what that program does.',
      `  - program hash: ${HASH}`,
      'PASSED using swiftness 1.0.0 (Cairo STARK proof, layout dynamic, Stone 6 format).',
      'Security the proof declares: 96 bits (32 queries × 2 + 32 proof-of-work bits). This tool requires at least 80.',
      'NOT REVIEWED',
      'This is not a statement about Starknet.',
      'That figure rests on a conjecture about the proof system, not on a proof.',
      'This tool knows of no audit of it.',
    ]) expect(shown).toContain(line);
    expect(shown).not.toMatch(/Fibonacci|fibonacci/);
  });

  it('refuses a proof that declares too little security, without running the verifier', async () => {
    let calls = 0;
    const counting: CairoEngine = { identity: swiftnessEngine.identity, verify: async (...args) => { calls++; return swiftnessEngine.verify(...args); } };
    expect(readCairoParameters(weak)).toMatchObject({ layout: 'starknet', queries: 10, logCosets: 4, proofOfWorkBits: 30, securityBits: 70 });
    expect(await verifyCairo(weak, counting)).toEqual({ status: 'unsupported', reason: 'the proof declares 70 bits of security, below the 80 this tool requires' });
    expect(calls).toBe(0);
    // It is a real proof: the verifier itself accepts it, which is why the floor is this tool's job.
    await expect(swiftnessEngine.verify(weak, readCairoParameters(weak) as never, 'stone5')).resolves.toMatchObject({ programHash: expect.stringMatching(/^0x/) });
    expect(await check({ proof: weak })).toMatchObject({ outcome: 'unsupported' });
    expect(renderReport(await check({ proof: weak }))).not.toMatch(/PASSED|FAILED|Claim/);
  });

  it('cannot be passed by writing a higher number than the proof was made with', async () => {
    // Each change lifts the declared security of the 70-bit proof to 80 or more.
    for (const [name, value] of [['proof_of_work_bits', 40], ['n_queries', 13], ['log_n_cosets', 5], ['n_queries', 1000]] as [string, number][]) {
      const inflated = withParameter(weak, name, value);
      const parameters = readCairoParameters(inflated);
      expect('reason' in parameters ? 0 : parameters.securityBits, name).toBeGreaterThanOrEqual(80);
      const report = await check({ proof: inflated });
      expect(report.outcome, `${name}=${value}`).not.toBe('valid');
      expect(report).not.toHaveProperty('claim');
    }
    // And a true proof stops verifying when its own parameters are misreported.
    for (const [name, value] of [['n_queries', 31], ['proof_of_work_bits', 31], ['log_n_cosets', 3]] as [string, number][]) {
      expect((await check({ proof: withParameter(strong, name, value) })).outcome, `${name}=${value}`).not.toBe('valid');
    }
  }, 240_000);

  it('rejects a proof whose statement or content is changed', async () => {
    const proof = JSON.parse(strong);
    const changed = (change: (copy: any) => void): string => {
      const copy = structuredClone(proof);
      change(copy);
      return JSON.stringify(copy);
    };
    const memory = proof.public_input.public_memory as { value: string }[];
    for (const [label, text] of [
      ['an output value', changed((p) => { p.public_input.public_memory[memory.length - 1].value = '0x2711'; })],
      ['a program word', changed((p) => { p.public_input.public_memory[0].value = '0x1'; })],
      ['the step count', changed((p) => { p.public_input.n_steps *= 2; })],
      ['a commitment in the transcript', changed((p) => { const at = p.annotations.findIndex((line: string) => /Commitment: Hash\(0x/.test(line)); p.annotations[at] = p.annotations[at].replace(/0x([0-9a-f])/, (_: string, d: string) => `0x${d === '1' ? '2' : '1'}`); })],
    ] as [string, string][]) {
      const report = await check({ proof: text });
      expect(report.outcome, label).not.toBe('valid');
      expect(report, label).not.toHaveProperty('claim');
    }
    // Measured: the verifier reads the proof from the file's annotations and does not read `proof_hex`.
    const unread = await check({ proof: changed((p) => { p.proof_hex = `${p.proof_hex.slice(0, 2000)}${p.proof_hex[2000] === '0' ? '1' : '0'}${p.proof_hex.slice(2001)}`; }) });
    expect(unread.outcome).toBe('valid');
  }, 240_000);

  it('refuses files it cannot read one way, without calling them invalid', async () => {
    for (const [text, reason] of [
      [strong.replace('"proof_parameters"', '"proof_parameters": {}, "proof_parameters"'), /exactly once/],
      [strong.replace('"n_queries"', '"n_queries": 1, "n_queries"'), /exactly once/],
      [withParameter(strong, 'n_queries', 100_000), /whole numbers in range/],
      [strong.replace('"layout": "dynamic"', '"layout": "all_cairo"'), /layout or hash this tool does not check/],
      [strong.replace('blake256_masked248_lsb', 'sha3'), /layout or hash/],
      [`${strong.slice(0, -2)}`, /not valid JSON/],
      // A second spelling of a name, which counting the plain spelling would miss.
      [strong.replace('"n_queries"', '"n_querie\\u0073": 1, "n_queries"'), /backslash/],
      ['{"proof_parameters": 1, "public_input": 2, "stark": 0, "fri": 0, "n_queries": 0, "log_n_cosets": 0, "proof_of_work_bits": 0, "layout": 0, "commitment_hash": 0}', /does not have the parts of a Cairo proof/],
    ] as [string, RegExp][]) {
      expect(await check({ proof: text })).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(reason) });
    }
    // Without the verifier, as on the browser page, the proof is not checked rather than failed.
    const { cairo: _none, ...without } = scanning;
    expect(await scan({ proof: strong }, without)).toMatchObject({ outcome: 'unsupported', reason: expect.stringMatching(/this build cannot check/) });
  });

  it('turns the verifier\'s answers into outcomes without mixing them up', async () => {
    const engine = (verify: CairoEngine['verify']): CairoEngine => ({ identity: swiftnessEngine.identity, verify });
    const good = { programHash: '0x1', output: ['0x2'] };
    expect(await verifyCairo(strong, engine(async () => { throw new CairoRejected('no'); }))).toMatchObject({ status: 'invalid' });
    expect(await verifyCairo(strong, engine(async () => { throw new CairoUnreadable('no'); }))).toMatchObject({ status: 'unsupported' });
    // One Stone layout cannot read the file and the other accepts it: accepted.
    expect(await verifyCairo(strong, engine(async (_text, _parameters, stone) => { if (stone === 'stone6') throw new CairoUnreadable('no'); return good; }))).toMatchObject({ status: 'valid', stone: 'stone5' });
    // One cannot read it and the other rejects it: rejected.
    expect(await verifyCairo(strong, engine(async (_text, _parameters, stone) => { throw stone === 'stone6' ? new CairoUnreadable('no') : new CairoRejected('no'); }))).toMatchObject({ status: 'invalid' });
    expect(await verifyCairo(strong, engine(async () => { throw new Error('the Cairo verifier stopped unexpectedly'); }))).toMatchObject({ status: 'error' });
    // A verifier build that cannot be loaded is a failure of this tool, not an unreadable proof.
    await expect(swiftnessEngine.verify(strong, { ...(readCairoParameters(strong) as object), layout: 'no_such_layout' } as never, 'stone6')).rejects.toThrow('the Cairo verifier could not be started');
    await expect(swiftnessEngine.verify('{}', readCairoParameters(strong) as never, 'stone6')).rejects.toBeInstanceOf(CairoUnreadable);
    for (const bad of [{ programHash: 'abc', output: [] }, { programHash: '0x1', output: ['<b>'] }, { programHash: '0x1' }, {}]) {
      expect(await verifyCairo(strong, engine(async () => bad as never))).toMatchObject({ status: 'error' });
    }
  });

  it('never reads the verifier running out of stack or memory as an answer', async () => {
    // Found on WebKit: one Stone layout overflowed a worker's stack, and the other layout's rejection was reported as FAILED.
    for (const message of ['Maximum call stack size exceeded.', 'RangeError: Maximum call stack size exceeded', 'unreachable', 'memory access out of bounds', 'Out of memory', '']) {
      const failure = swiftnessFailure(message);
      expect(failure, message).not.toBeInstanceOf(CairoRejected);
      expect(failure, message).not.toBeInstanceOf(CairoUnreadable);
    }
    expect(swiftnessFailure('Proof verification failed: Commit Error')).toBeInstanceOf(CairoRejected);
    expect(swiftnessFailure('Error parsing proof: missing field')).toBeInstanceOf(CairoUnreadable);
    const engine = (verify: CairoEngine['verify']): CairoEngine => ({ identity: swiftnessEngine.identity, verify });
    const overflowThenReject = engine(async (_text, _parameters, stone) => { throw swiftnessFailure(stone === 'stone6' ? 'Maximum call stack size exceeded.' : 'Proof verification failed: Commit Error'); });
    expect(await verifyCairo(strong, overflowThenReject)).toMatchObject({ status: 'error', message: 'the Cairo verifier failed while running' });
  });

  it('checks, exports and reruns from the command line', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-cairo-'));
    const cli = (...args: string[]) => spawnSync(process.execPath, [join(root, 'dist/cli.js'), ...args], { encoding: 'utf8', timeout: 120_000, maxBuffer: 32 * 1024 * 1024 });
    const exported = join(dir, 'evidence.json');
    const done = cli('check', path('dynamic-stone6-96-bits.json'), '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout.trimEnd()).toBe(renderReport(await check({ proof: strong })));
    const again = cli('rerun', exported);
    expect(again.status).toBe(0);
    expect(again.stdout).toMatch(/^REPRODUCED/);
    expect(cli('check', path('starknet-stone5-70-bits.json')).status).toBe(2);
    expect(JSON.parse(cli('check', path('dynamic-stone6-96-bits.json'), '--json').stdout)).toMatchObject({ outcome: 'valid', basis: 'cairo-program' });

    const forged = JSON.parse(writeExport({ proof: strong }, await check({ proof: strong })));
    forged.report.claim = 'This proves a Starknet transaction was included.';
    forged.report.verification.proofSystem.securityBits = 128;
    expect(await rerunExport(JSON.stringify(forged), check)).toMatchObject({ reproduced: false, fields: ['claim', 'verification'] });
  }, 240_000);
});
