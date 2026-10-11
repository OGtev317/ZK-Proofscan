// Generates real UltraHonk proofs for a tiny Noir test circuit, one for each
// way of making a proof that this tool checks. The witness (a = 3, b = 11)
// is a test value, not a secret. The circuit is compiled and proved in
// JavaScript, with the setup files in artifacts/aztec-crs. Uses no network.
//
//   node scripts/make-noir-fixtures.mjs
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendType, Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import { Noir } from '@noir-lang/noir_js';
import { compile, createFileManager } from '@noir-lang/noir_wasm';

const out = fileURLToPath(new URL('../tests/fixtures/noir/', import.meta.url));
const { program } = await compile(createFileManager(fileURLToPath(new URL('./circuits/noir-multiplier/', import.meta.url))));
const { witness } = await new Noir(program).execute({ a: '3', b: '11' });

const crs = mkdtempSync(join(tmpdir(), 'zk-proofscan-fixture-crs-'));
cpSync(fileURLToPath(new URL('../artifacts/aztec-crs/', import.meta.url)), crs, { recursive: true });
const api = await Barretenberg.new({ threads: 1, crsPath: crs, srsSize: 2 ** 17, backend: BackendType.Wasm });
const backend = new UltraHonkBackend(program.bytecode, api);
for (const variant of ['evm', 'evm-no-zk', 'noir-recursive', 'noir-recursive-no-zk']) {
  const { proof, publicInputs } = await backend.generateProof(witness, { verifierTarget: variant });
  const key = await backend.getVerificationKey({ verifierTarget: variant });
  if (!(await backend.verifyProof({ proof, publicInputs }, { verifierTarget: variant }))) throw new Error(`${variant} did not verify`);
  // The three files as Barretenberg's own program names them, all binary.
  const save = (name, bytes) => writeFileSync(join(out, `multiplier-${variant}.${name}`), bytes, { flag: 'wx' });
  save('proof', proof);
  save('public_inputs', Buffer.concat(publicInputs.map((value) => Buffer.from(value.slice(2).padStart(64, '0'), 'hex'))));
  save('vk', key);
  console.log(variant, proof.length, 'proof bytes,', key.length, 'key bytes, noir', program.noir_version);
}
await api.destroy();
rmSync(crs, { recursive: true, force: true });
