// Repeats the evidence for the recorded "Proof of Twitter" key: the file in
// this repository is the one ZK Email publishes, its values are the constants
// in the repository's Solidity verifier at the pinned commit, and the proof
// hard-coded in that repository's contract test is the fixture used here.
// Downloads three small public files.
//
//   node scripts/check-proof-of-twitter-key.mjs            # writes the record
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const COMMIT = 'b6d9c2d6a8c99563411992ae3610ecf2afba1ee5';
const RAW = `https://raw.githubusercontent.com/zkemail/proof-of-twitter/${COMMIT}`;
const KEY_URL = 'https://storage.googleapis.com/proof-of-twitter-artifacts/87f1f79/twitter.vkey.json';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const get = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};
const text = (bytes) => new TextDecoder().decode(bytes);
const local = (path) => readFile(new URL(`../${path}`, import.meta.url));

const bundled = await local('artifacts/zk-email-proof-of-twitter/verification-key.json');
const published = await get(KEY_URL);
const verifier = await get(`${RAW}/packages/contracts/src/Verifier.sol`);
const test = await get(`${RAW}/packages/contracts/test/TestTwitter.t.sol`);

// The contract writes each G2 coordinate pair in the opposite order to snarkjs.
const key = JSON.parse(text(bundled));
const expected = [key.vk_alpha_1[0], key.vk_alpha_1[1]];
for (const name of ['vk_beta_2', 'vk_gamma_2', 'vk_delta_2']) expected.push(key[name][0][1], key[name][0][0], key[name][1][1], key[name][1][0]);
for (const point of key.IC) expected.push(point[0], point[1]);
const source = text(verifier);
const constants = source.slice(source.indexOf('function verifyingKey'), source.indexOf('function verify(uint')).match(/\b\d{60,}\b/g) ?? [];

// Every number of the fixture appears in the repository's own test.
const proof = JSON.parse(text(await local('tests/fixtures/snarkjs/proof-of-twitter.proof.json')));
const signals = JSON.parse(text(await local('tests/fixtures/snarkjs/proof-of-twitter.public.json')));
const fixtureNumbers = [proof.pi_a[0], proof.pi_a[1], ...proof.pi_b[0], ...proof.pi_b[1], proof.pi_c[0], proof.pi_c[1], ...signals];
const testText = text(test);

const record = {
  checked: new Date().toISOString().slice(0, 10),
  commit: COMMIT,
  publishedKey: { url: KEY_URL, sha256: sha256(published), equalsBundledFile: sha256(published) === sha256(bundled) },
  verifierContract: { url: `${RAW}/packages/contracts/src/Verifier.sol`, sha256: sha256(verifier), constants: constants.length, keyValuesEqualConstants: constants.length === expected.length && constants.every((value, i) => value === expected[i]) },
  contractTest: { url: `${RAW}/packages/contracts/test/TestTwitter.t.sol`, sha256: sha256(test), holdsEveryFixtureNumber: fixtureNumbers.every((value) => testText.includes(value)) },
  notChecked: 'That the key was built from the circuit source, and that its setup was run honestly.',
};
const ok = record.publishedKey.equalsBundledFile && record.verifierContract.keyValuesEqualConstants && record.contractTest.holdsEveryFixtureNumber;
await writeFile(new URL('../artifacts/zk-email-proof-of-twitter/key-check.json', import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
console.log(JSON.stringify(record, null, 2));
process.exitCode = ok ? 0 : 1;
