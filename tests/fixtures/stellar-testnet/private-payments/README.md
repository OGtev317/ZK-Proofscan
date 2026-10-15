# A Stellar Private Payments pool transaction, as a provider described it

`answers.json` holds what the Stellar Development Foundation's public
testnet RPC answered on 2026-10-14, recorded again on 2026-10-15 with the result and the events its execution emitted, to each read request a lookup of
transaction `cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc`
makes: `getNetwork`, `getTransaction`, and `getLedgerEntries` for the pool's
storage, its verifier's storage and the verifier's code, recorded by the
key asked for. Only the fields this tool reads are kept.

The transaction calls `transact` on the pool contract
`CA73PEBSX2GXZSMMVL46PTCXY424AIMPXKI7WWUMYJXV22AVY2DXC6DQ`, which
Nethermind's Stellar Private Payments repository lists as deployed on
testnet at ledger 5190086 (`deployments/testnet/deployments.json`). It is
public data on a test network: the proof hides its private inputs, and no
key that can sign was copied.
