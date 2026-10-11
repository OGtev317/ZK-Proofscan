# Verification prototype (build step 1)

Written 2026-10-11. Evaluation code: unaudited, unreviewed, not released.

## What exists

A TypeScript core and a command-line tool that check one kind of proof: a
Semaphore v4 proof file as written by `@semaphore-protocol/proof`.

```sh
npm ci
npm test
npm run build
node dist/cli.js tests/fixtures/semaphore-v4-valid.json   # add --json for JSON
```

| Result | Exit code | Meaning |
| --- | --- | --- |
| `valid` | 0 | The verifier accepted the proof |
| `invalid` | 1 | The verifier ran and rejected the proof |
| `unsupported` | 2 | The file is not a supported proof; nothing was verified |
| `error` | 3 | The check could not be completed; nothing was verified |

There are no explanation templates, registry, browser interface or report
export yet. Output states the verification result, the verifier and key hash,
the public inputs, and that the group root and nullifier use were not checked.

## Parts

| Path | Role |
| --- | --- |
| `src/semaphore-v4/importer.ts` | Strict reading of the proof file |
| `src/semaphore-v4/hash.ts` | Semaphore's message and scope hashing |
| `src/semaphore-v4/artifact.ts` | Verification keys, accepted only at a pinned SHA-256 |
| `src/semaphore-v4/verify.ts` | Builds the public inputs and calls the verifier |
| `src/node/` | The snarkjs verifier and the bundled key file, for Node |
| `src/cli.ts` | Command line |
| `artifacts/semaphore-v4/` | Key file copied unchanged from the Semaphore package |

The core takes the verifier and the key bytes as arguments and uses no Node
API, so a browser worker can supply its own later. That has not been tried.

The importer accepts only the six known fields, numbers as canonical decimal
strings within range, exactly eight proof points, and refuses a field written
twice. It never asks for an identity secret or witness.

## Dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `snarkjs` | 0.7.6 | GPL-3.0 | Groth16 verification |
| `@noble/hashes` | 2.4.0 | MIT | keccak256 and SHA-256 |
| `@semaphore-protocol/proof`, `identity`, `group` | 4.14.3 | MIT | Tests and fixture generation only |

The project is GPL-3.0-or-later by owner decision (2026-10-11), because
snarkjs is distributed with it. Production dependency licences found: MIT,
GPL-3.0, Apache-2.0 and ISC. `npm audit --omit=dev` reports no known
vulnerabilities. The development-only Semaphore packages bring in older
packages with open advisories (snarkjs 0.5.0, `ws`); they are not part of
what the tool runs.

No audit status has been confirmed for snarkjs 0.7.6 or for this code.

## Findings

- **snarkjs 0.7.5 and 0.7.6 behaved the same in every Groth16 case tested.**
  Both rejected a public input moved up or down by the field size. The 0.7.5
  source already has the upper-bound check; 0.7.6 adds a check for negative
  values. The Semaphore pin at 0.7.5 was therefore not shown to be a problem
  for verification. 0.7.6 is used here because it is the current release.
- **Both versions accept other spellings of the same number** (hexadecimal,
  leading zeros). The importer refuses them, so one proof has one accepted
  written form.
- **This code and Semaphore's own verifier agreed** on the valid proof and on
  the proof with the root, nullifier, message or scope changed.
- snarkjs does not check that the number of public inputs matches the key.
  The adapter always supplies exactly four.

## Tested

27 automated tests on macOS with Node 26.3.0: one real proof (tree depth 3,
five throwaway members), a change to each public field and each proof point,
other tree depths, swapped values, out-of-range and non-canonical values,
unknown, missing and repeated fields, a changed key file, a verifier that
throws, and the command-line exit codes.

## Not tested or not done

- Only one valid proof, at one tree depth. Depths other than 3 have no valid
  fixture.
- No fuzzing, no browser, no Safari, no Windows or Linux, no CI.
- The link between the key file and the Semaphore circuit source and trusted
  setup is not established here. The hash shows only that the file is the one
  shipped in the Semaphore package.
- The fixture script downloads Semaphore's public proving files at run time;
  those downloads are not hash-checked by this repository.
