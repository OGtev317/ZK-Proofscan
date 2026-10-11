# Semaphore v4 verification keys

`verification-keys.json` is an unmodified copy of
`src/verification-keys.json` from the npm package `@semaphore-protocol/proof`
version 4.14.3 (MIT; see `LICENSE` in this folder). It holds the Groth16
verification keys for tree depths 1 to 32.

SHA-256 of the file:
`d96ec60593b6fc2334f1f04e008e07425d5536d7777f6ac21d996fc80779b3c9`

The loader refuses any file whose hash differs. The hash shows the file has
not changed since it was copied.

## What links these keys to the circuit

Checked on 2026-10-11 with `node scripts/check-keys.mjs`: for every tree depth
from 1 to 32, the key in this file equals the verification key exported from
the proving key Semaphore publishes at
`https://snark-artifacts.pse.dev/semaphore/4.13.0/semaphore-<depth>.zkey`.
`proving-key-check.json` records each proving key's size and SHA-256.

Not checked: that those proving keys were produced from the Semaphore circuit
source, and that the trusted setup behind them was run honestly. Showing the
first would mean compiling the circuit and verifying each proving key against
it and the ceremony's parameters; the second rests on the ceremony's own
record. Neither has been done or reviewed in this repository.
