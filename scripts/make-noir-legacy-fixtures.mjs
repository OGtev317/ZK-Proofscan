// Generates real UltraHonk proofs with Barretenberg 0.87.0 and Noir
// 1.0.0-beta.9, the versions Nethermind's UltraHonk verifier for Stellar is
// built for, for the same tiny test circuit as make-noir-fixtures.mjs. The
// witness (a = 3, b = 11) is a test value, not a secret.
//
// Unlike checking, this downloads: proving needs setup points that this
// version of the library fetches from crs.aztec.network into a temporary
// folder. Refuses to overwrite existing fixtures.
//
//   node scripts/make-noir-legacy-fixtures.mjs [output folder]
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { UltraHonkBackend } from 'aztec-bb-js-0-87-0';
import { Noir } from 'noir-js-1-0-0-beta-9';
import { compile, createFileManager } from 'noir-wasm-1-0-0-beta-9';

const out = process.argv[2] === undefined ? fileURLToPath(new URL('../tests/fixtures/noir-legacy/', import.meta.url)) : resolve(process.argv[2]);
const { program } = await compile(createFileManager(fileURLToPath(new URL('./circuits/noir-multiplier/', import.meta.url))));
const { witness } = await new Noir(program).execute({ a: '3', b: '11' });

const crs = mkdtempSync(join(tmpdir(), 'lumenlenz-legacy-crs-'));
const backend = new UltraHonkBackend(program.bytecode, { threads: 1, crsPath: crs });
// "poseidon" is this version's default transcript. This tool does not check it; the fixture shows that it is refused and not failed.
for (const [name, options] of [['keccak', { keccak: true }], ['keccak-zk', { keccakZK: true }], ['poseidon', {}]]) {
  const { proof, publicInputs } = await backend.generateProof(witness, options);
  const key = await backend.getVerificationKey(options);
  if (!(await backend.verifyProof({ proof, publicInputs }, options))) throw new Error(`${name} did not verify`);
  const save = (kind, bytes) => writeFileSync(join(out, `multiplier-${name}.${kind}`), bytes, { flag: 'wx' });
  save('proof', proof);
  save('public_inputs', Buffer.concat(publicInputs.map((value) => Buffer.from(value.slice(2).padStart(64, '0'), 'hex'))));
  save('vk', key);
  console.log(name, proof.length, 'proof bytes,', key.length, 'key bytes, noir', program.noir_version);
}
await backend.destroy();
rmSync(crs, { recursive: true, force: true });
