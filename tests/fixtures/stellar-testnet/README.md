# A Stellar testnet transaction, as a provider described it

`answers.json` holds what the Stellar Development Foundation's public
testnet RPC (`https://soroban-testnet.stellar.org`) answered on 2026-10-14, recorded again on 2026-10-15 with the result and the events its execution emitted,
to the three read requests a lookup makes, for transaction
`10dd8ab5bcfbc8395030144cdfc5cb200ce61d38e7fad533e18e3aee89bbb3b2`:
`getNetwork`, `getTransaction` and `getLedgerEntries`. Only the fields this
tool reads are kept, with the transaction's hash, ledger and time.

The transaction was sent by the nightly testnet run of Nethermind's
`rs-soroban-ultrahonk` repository (GitHub Actions run 38500487863, on
2026-10-14). It calls `verify_proof` on the UltraHonk verifier contract
`CAXUVZHJNVW7BDZUOYYEDHAVSHPM5HSPRX74BZUCJ4DVHDHKKJMHKOOJ`, which that run
deployed, with a Barretenberg 0.87.0 Keccak proof whose one public input
is 2. It is public data on a test network; nothing here was made with a
secret, and no key that can sign was copied.
