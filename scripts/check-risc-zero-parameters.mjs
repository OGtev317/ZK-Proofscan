// Compares the RISC Zero verifier parameters kept in
// artifacts/risc-zero-groth16 with two publishers: Nethermind's Stellar
// verifier, which the file was copied from, and RISC Zero's own Ethereum
// verifier contracts for the same version. Downloads from GitHub, and
// writes what it found beside the parameters.
//
//   node scripts/check-risc-zero-parameters.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const NETHERMIND = { repository: 'NethermindEth/stellar-risc0-verifier', commit: 'e8ff6ea202db195352c0141ecc533ff649393fe4' };
const RISC_ZERO = { repository: 'risc0/risc0-ethereum', commit: '32aa0b6f23ddd02dd93fc71717667606e5c7db86', tag: 'v3.0.0' };
const folder = new URL('../artifacts/risc-zero-groth16/', import.meta.url);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
async function download({ repository, commit }, path) {
  const response = await fetch(`https://raw.githubusercontent.com/${repository}/${commit}/${path}`);
  if (!response.ok) throw new Error(`${repository} ${path}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const local = readFileSync(new URL('parameters-3.0.0.json', folder));
const parameters = JSON.parse(local.toString('utf8'));
const published = await download(NETHERMIND, 'contracts/groth16-verifier/parameters.json');
const controlId = (await download(RISC_ZERO, 'contracts/src/groth16/ControlID.sol')).toString('utf8');
const verifier = (await download(RISC_ZERO, 'contracts/src/groth16/Groth16Verifier.sol')).toString('utf8');

const solidity = (name) => new RegExp(`uint256 constant ${name} = ([0-9]+);`).exec(verifier)?.[1];
const vk = parameters.verification_key;
const pairs = [['alphax', vk.alpha.x], ['alphay', vk.alpha.y]];
for (const point of ['beta', 'gamma', 'delta']) for (const part of ['x1', 'x2', 'y1', 'y2']) pairs.push([`${point}${part}`, vk[point][part]]);
vk.IC.forEach((point, i) => pairs.push([`IC${i}x`, point.x], [`IC${i}y`, point.y]));
const differing = pairs.filter(([name, value]) => solidity(name) !== value).map(([name]) => name);

const result = {
  checked: new Date().toISOString().slice(0, 10),
  file: { name: 'parameters-3.0.0.json', sha256: sha256(local) },
  copiedFrom: { ...NETHERMIND, path: 'contracts/groth16-verifier/parameters.json', identicalBytes: published.equals(local) },
  comparedWith: {
    ...RISC_ZERO,
    keyConstantsCompared: pairs.length,
    keyConstantsDiffering: differing,
    controlRootEqual: controlId.includes(`CONTROL_ROOT = hex"${parameters.control_root}"`),
    bn254ControlIdEqual: controlId.includes(`BN254_CONTROL_ID = hex"${parameters.bn254_control_id}"`),
  },
  notChecked: [
    'That the selector 73c457ba follows from these parameters. It was not recomputed; a seal with that selector passes under them.',
    "How the trusted setup behind the key was run, and the RISC Zero circuits the control root allows.",
  ],
};
writeFileSync(new URL('parameters-check.json', folder), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.copiedFrom.identicalBytes || differing.length > 0 || !result.comparedWith.controlRootEqual || !result.comparedWith.bn254ControlIdEqual) process.exitCode = 1;
