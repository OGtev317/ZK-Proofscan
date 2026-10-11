// Generates one real Semaphore v4 proof from identities created here and
// thrown away. Only the proof and its public fields are written; no identity
// secret is stored. Downloads the public proving artifacts on first use.
import { writeFile } from 'node:fs/promises';
import { Group } from '@semaphore-protocol/group';
import { Identity } from '@semaphore-protocol/identity';
import { generateProof } from '@semaphore-protocol/proof';

const prover = new Identity();
const others = Array.from({ length: 4 }, () => new Identity().commitment);
const group = new Group([others[0], others[1], prover.commitment, others[2], others[3]]);
const proof = await generateProof(prover, group, 'fixture message', 'fixture scope');
await writeFile(new URL('../tests/fixtures/semaphore-v4-valid.json', import.meta.url), `${JSON.stringify(proof, null, 2)}\n`);
console.log(`depth ${proof.merkleTreeDepth}, group of ${group.size}`);
await globalThis.curve_bn128?.terminate();
