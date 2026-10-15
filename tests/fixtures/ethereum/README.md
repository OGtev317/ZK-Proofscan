# An Ethereum transaction that grants an unlimited allowance

`unlimited-approval.json` holds what Alchemy answered on 2026-10-15 for
transaction `0x0bea91f4e8de791ce3a0e77596a35df1bcfe28f88d3086c90b4fa50b42038428`
on Ethereum mainnet: the transaction, its receipt with its one Approval
event, and the token contract's answers to `symbol()` and `decimals()`
(under `eth_call`, by call data). It is an ordinary public `approve` call
for the maximum amount, found by scanning recent blocks; the browser test
replays it to check how an unlimited allowance is described. The key used
to fetch it is not in this file.
