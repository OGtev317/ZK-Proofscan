// Generates real proofs for a tiny test circuit, one per proof system that
// snarkjs verifies, with every setup made here from fresh randomness and
// thrown away. The witness (a = 3, b = 11) is a test value, not a secret.
// Needs the circom compiler on PATH. Uses no network.
//
//   node scripts/make-snarkjs-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as snarkjs from 'snarkjs';

const circuit = fileURLToPath(new URL('./circuits/multiplier.circom', import.meta.url));
const out = fileURLToPath(new URL('../tests/fixtures/snarkjs/', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'zk-proofscan-fixtures-'));
const entropy = () => randomBytes(32).toString('hex');
const save = (name, value) => writeFileSync(join(out, name), `${JSON.stringify(value, null, 1)}\n`, { flag: 'wx' });

for (const [curveName, prime] of [['bn128', 'bn128'], ['bls12381', 'bls12381']]) {
  const dir = join(work, curveName);
  mkdirSync(dir);
  execFileSync('circom', [circuit, '--r1cs', '--wasm', '--prime', prime, '-o', dir], { stdio: 'ignore' });
  const r1cs = join(dir, 'multiplier.r1cs');
  const wasm = join(dir, 'multiplier_js/multiplier.wasm');
  const curve = await snarkjs.curves.getCurveFromName(curveName);
  await snarkjs.powersOfTau.newAccumulator(curve, 10, join(dir, 'p0.ptau'));
  await snarkjs.powersOfTau.contribute(join(dir, 'p0.ptau'), join(dir, 'p1.ptau'), 'fixture', entropy());
  await snarkjs.powersOfTau.preparePhase2(join(dir, 'p1.ptau'), join(dir, 'final.ptau'));
  const ptau = join(dir, 'final.ptau');
  const input = { a: '3', b: '11' };

  const systems = { groth16: join(dir, 'groth16.zkey') };
  await snarkjs.zKey.newZKey(r1cs, ptau, join(dir, 'groth16-0.zkey'));
  await snarkjs.zKey.contribute(join(dir, 'groth16-0.zkey'), systems.groth16, 'fixture', entropy());
  // snarkjs offers PLONK and FFLONK on BN254 only.
  if (curveName === 'bn128') {
    systems.plonk = join(dir, 'plonk.zkey');
    await snarkjs.plonk.setup(r1cs, ptau, systems.plonk);
    systems.fflonk = join(dir, 'fflonk.zkey');
    await snarkjs.fflonk.setup(r1cs, ptau, systems.fflonk);
  }
  for (const [system, zkey] of Object.entries(systems)) {
    const { proof, publicSignals } = await snarkjs[system].fullProve(input, wasm, zkey);
    const key = await snarkjs.zKey.exportVerificationKey(zkey);
    if (!(await snarkjs[system].verify(key, publicSignals, proof))) throw new Error(`${system} on ${curveName} did not verify`);
    const stem = `${system}-${curveName}`;
    save(`${stem}.proof.json`, proof);
    save(`${stem}.public.json`, publicSignals);
    save(`${stem}.key.json`, key);
    console.log(stem);
  }
  await curve.terminate();
}
