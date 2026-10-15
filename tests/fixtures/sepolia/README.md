# A Sepolia transaction, as a provider described it

`proof-of-twitter-mint.json` holds what `https://sepolia.drpc.org` answered
on 2026-10-15 to the three read requests a lookup of transaction
`0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787` makes:
`eth_chainId`, `eth_getTransactionByHash` and `eth_getTransactionReceipt`.
Only the fields this tool reads are kept. The transaction is a `mint` call
to ZK Email's Proof of Twitter demonstration contract on Sepolia, a public
test network; the browser tests answer the page's requests with it, so they
contact no network.
