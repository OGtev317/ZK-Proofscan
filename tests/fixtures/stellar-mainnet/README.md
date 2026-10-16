# Stellar mainnet public records

## A Stellar mainnet payment in an issued asset

`usdc-payment.json` holds what `https://mainnet.sorobanrpc.com` answered on
2026-10-15 for transaction
`2316f304739d2304c481296efd03012b5f8e8b375afdafcfe00363ffcf50ba25`, a
payment of 10 USDC issued by Circle's account
`GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`, and for that
issuer's account entry, which names its home domain. Public data; the
tests use it to check how an issued asset is described.

## Public Soroswap replay

`soroswap.json` contains recorded responses to six read-only RPC requests to
`mainnet.sorobanrpc.com`. UTC capture date is in the file. Transaction:
`203d14cb109f442a96e26a5bba9a2c5b8aa5770dabe29e0b5f46e310a2003e3a`,
ledger 64962309. This is an existing public mainnet swap, not a transaction
created by LumenLenz. No wallet or signing was involved in capture.

It records `getNetwork`, `getTransaction`, and keyed `getLedgerEntries` for
the router's interface/code and token metadata. Replay recomputes the requested
transaction hash and fetched WASM hash. Events, inclusion, execution outcome and
token identities remain provider-reported data, not consensus verification.
The router address/code match the pinned Soroswap deployment manifest in
`src/chain/deployments.ts`; that is not a security audit, historical-state proof,
economic guarantee, or ZK proof check. This transaction has no supported ZK proof.

Tests never call a live RPC. `node scripts/capture-soroswap.mjs` is an explicit
read-only capture operation after building and refuses to overwrite this file.
No private witnesses, secret keys, API credentials or disposable accounts belong
in fixtures. Recapture cannot guarantee the public provider retains the record.
