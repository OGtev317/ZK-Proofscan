// Generates one real Semaphore v4 proof from identities created here and
// thrown away. Only the proof and its public fields are written; no identity
// secret is stored. Downloads the public proving artifacts on first use.
//
//   node scripts/make-fixture.mjs <group size> <file name in tests/fixtures>
import { writeFile } from 'node:fs/promises';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';

const size = Number(process.argv[2] ?? 5);
const name = process.argv[3] ?? 'semaphore-v4-valid.json';
if (!Number.isInteger(size) || size < 2 || !/^[a-z0-9-]+\.json$/.test(name)) throw new Error('usage: make-fixture.mjs <group size> <name.json>');

const prover = new Identity();
const members = Array.from({ length: size - 1 }, () => new Identity().commitment);
members.splice(Math.floor(size / 2), 0, prover.commitment);
const group = new Group(members);
const proof = await generateProof(prover, group, 'fixture message', 'fixture scope');
await writeFile(new URL(`../tests/fixtures/${name}`, import.meta.url), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
console.log(`depth ${proof.merkleTreeDepth}, group of ${group.size}`);
await globalThis.curve_bn128?.terminate();
