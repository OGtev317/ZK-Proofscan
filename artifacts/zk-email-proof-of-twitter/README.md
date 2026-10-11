# ZK Email "Proof of Twitter" verification key

`verification-key.json` is an unmodified copy of the Groth16 verification
key ZK Email publishes for its Proof of Twitter demonstration at
`https://storage.googleapis.com/proof-of-twitter-artifacts/87f1f79/twitter.vkey.json`,
the address the demonstration's own app is configured with. The repository
`zkemail/proof-of-twitter` is MIT licensed; see `LICENSE` in this folder.

SHA-256 of the file:
`ef3da479d57c513d66c589efbc9da8e091a30fd95e90ca3e23954c4db8dd5ebd`

## What was checked

`node scripts/check-proof-of-twitter-key.mjs` repeats this and writes
`key-check.json`. On 2026-10-11, against commit
`b6d9c2d6a8c99563411992ae3610ecf2afba1ee5` of that repository:

- the published file is byte-for-byte this file;
- its values are the 22 key constants in `packages/contracts/src/Verifier.sol`;
- every number of the proof and public inputs in
  `tests/fixtures/snarkjs/proof-of-twitter.*.json` is in that repository's
  `packages/contracts/test/TestTwitter.t.sol`, which says the proof was made
  from the sample email in the repository. That proof passes under this key.

## What was not checked

- That the key was built from `packages/circuits/src/twitter.circom`. The
  circuit was not compiled here, and the proving key was not examined.
  Circuit source alone cannot recreate a Groth16 key; the setup files are
  needed.
- How the setup was run. Nothing documents it. The repository's own setup
  script does a single-party setup, which would mean trusting whoever ran it.
- The email-verification library the circuit includes, `@zk-email/circuits`
  6.1.3, was not read.
- This is a demonstration, not a blueprint from ZK Email's registry, and it
  has no blueprint ID or version.
