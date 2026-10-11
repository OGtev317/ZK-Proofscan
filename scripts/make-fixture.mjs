// Generates one real Semaphore v4 proof from identities created here and
// thrown away. Only the proof and its public fields are written; no identity
// secret is stored. Downloads the public proving artifacts on first use.
//
//   node scripts/make-fixture.mjs <group size> <file name in tests/fixtures> [message]
//
// The message is at most 31 characters of plain text.
import { writeFile } from 'node:fs/promises';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';

const size = Number(process.argv[2] ?? 5);
const name = process.argv[3] ?? 'semaphore-v4-valid.json';
const message = process.argv[4] ?? 'fixture message';
if (!Number.isInteger(size) || size < 2 || !/^[a-z0-9-]+\.json$/.test(name) || !/^[\x20-\x7e]{1,31}$/.test(message)) throw new Error('usage: make-fixture.mjs <group size> <name.json> [message]');

const prover = new Identity();
const members = Array.from({ length: size - 1 }, () => new Identity().commitment);
members.splice(Math.floor(size / 2), 0, prover.commitment);
const group = new Group(members);
const proof = await generateProof(prover, group, message, 'fixture scope');
await writeFile(new URL(`../tests/fixtures/${name}`, import.meta.url), `${JSON.stringify(proof, null, 2)}\n`, { flag: 'wx' });
console.log(`depth ${proof.merkleTreeDepth}, group of ${group.size}`);
await globalThis.curve_bn128?.terminate();
