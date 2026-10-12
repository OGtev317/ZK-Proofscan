# Stellar Private Payments testnet verification keys

The sixteen `*_vk.json` files are unmodified copies of the Groth16
verification keys Nethermind publishes for the testnet deployment of
Stellar Private Payments, from `deployments/testnet/circuit_keys/` of
`NethermindEth/stellar-private-payments` at commit
`ef42a47ee6a84b5c7a289b979e2fa2526c73aabc` (circuits bundle 0.5, fetched
2026-10-11). That repository is Apache-2.0 licensed apart from its circuit
compiler; see `LICENSE` in this folder. Each file's SHA-256 is in
`registry/keys.json`, and `tests/stellar.test.ts` derives every entry again
from these files.

They are here so that a proof presented with one of these keys is reported
as using a known key. This tool has no explanation for any of the circuits.

## What the publisher says about them

- Every key was **generated locally, with no trusted ceremony**
  (`deployments/testnet/circuits.json` records `"setup": "local"`, and the
  folder's README says so). Whoever generated a key can make proofs of
  false statements that pass under it.
- They are for testnet only. The project is a work in progress and has not
  been audited.
- The keys change: the folder was replaced on 2026-09-01, 2026-09-14 and
  2026-10-05. A proof made with an earlier or later key will not match
  these, and will be reported as an unrecognised key.

## What was not checked

- That any key was built from the circuit source the registry names. No
  circuit was compiled here.
- No valid proof was available: the repository holds no test proof, and
  making one needs the project's prover and a pool's state. The tests show
  that each key is read, named, and rejects a proof made for another
  circuit. They do not show a proof passing under any of these keys.
- No Stellar network was contacted. Whether these keys are the ones the
  deployed testnet contracts hold was not checked.
