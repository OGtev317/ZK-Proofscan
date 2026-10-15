# A Stellar testnet transaction with no proof in it

`answers.json` holds what the Stellar Development Foundation's public
testnet RPC answered on 2026-10-15 to `getNetwork` and `getTransaction` for
transaction `294424f4b8818140ecf48e587bac0d9185ee3638f4a769de84dd3a49de1044bb`,
which created the UltraHonk verifier contract in the night's test run of
Nethermind's `rs-soroban-ultrahonk` repository. It holds no proof; the tests
use it to check that such a transaction is described rather than reported
as an error. Public data on a test network.
