# Looking up a proof by transaction

Written 2026-10-11. The owner approved read-only chain lookups through
Alchemy, on any chain, on that date. Nothing else on a chain is approved:
no wallet, no signing, no transactions, no deployment.

**Not yet run against a real chain.** No provider key was configured when
this was built, so every test uses a stand-in provider on this machine and
call data built from the test proofs. The first real lookup is still to do.

## What it does

```sh
cp .env.example .env        # then put the key in .env
node --env-file=.env dist/cli.js lookup <transaction hash> --chain sepolia
```

1. Asks the provider which chain it serves, for the transaction, and for
   its receipt. Three read requests. The transaction hash is the only thing
   sent that the user supplied.
2. If the transaction is a call this tool knows, reads the proof and public
   inputs out of the call data.
3. Checks that proof on this machine exactly as `check` does, and prints the
   same report under a "Source" section.

Chains: `ethereum`, `sepolia`, `base`, `base-sepolia`, `optimism`,
`arbitrum`, `polygon`. The Alchemy network names for these are from memory
and untested.

## What is trusted, and what is not

| Statement | Rests on |
| --- | --- |
| The proof is valid, and what it establishes | This tool's own check, as for any proof |
| The proof was in that transaction, in that block, sent to that contract | The provider's word. Not checked |
| The chain accepted or reverted the transaction | The provider's word, and the contract's own rules |

A provider that lies about the source cannot make a bad proof pass: the
proof is verified here. It can attach a real proof to the wrong
transaction, so the source lines always read "as reported by" the provider.
The chain's decision and the local check are reported separately and can
disagree: a contract may reject a good proof for its own reasons, or accept
a transaction whose proof this tool will not accept.

## Calls it reads

| Call | Proof | Contract on record |
| --- | --- | --- |
| `mint(uint256[8],uint256[3])` | ZK Email Proof of Twitter, checked with the recorded key | Sepolia `0xab157f13e9643f45aea693fdb1a3c22dbdb984a5`, named in the demonstration's app settings. Not checked to be live |
| `validateProof(uint256,(…))` | Semaphore v4, checked with the bundled keys | None |

A call is matched by its shape, which any contract can copy. The report
says whether the called contract is a deployment on record; if it is not,
the proof is still checked and the report says so. Only top-level calls are
read. Most applications call Semaphore from their own contract, and those
proofs are inside the transaction where this tool does not look.

## Safeguards

- The provider address comes from the environment (`ALCHEMY_API_KEY` or
  `ZK_PROOFSCAN_RPC_URL`), never from an argument, a file or an AI agent.
- HTTPS only, no redirects, a time limit and a size limit. Error messages
  and reports never contain the address, which holds the key; reports name
  the provider's host only. The provider's own error text is not repeated.
- The chain id is checked first, and the transaction and receipt must agree
  with each other and with the hash asked for.
- `check` and `rerun` never contact a provider, configured or not.
- An export of a looked-up proof records the source. A rerun cannot check
  it, shows it as "recorded in the export", and does not notice if it was
  changed. Only the proof and report are reproduced.

## Tested

With a stand-in provider: the publisher's test proof found in a `mint` call
and a Semaphore proof found in a direct call both check as they do from
files; a reverted transaction with a good proof and an accepted one with an
altered proof are each reported as what they are; wrong chain, missing,
pending, contract-creating, unknown and wrong-length transactions are
declined without being called invalid; answers that contradict each other
stop the lookup; six kinds of provider failure give fixed messages with no
key and no provider text; the command line, export, rerun and agent tool.

## Not done

- A real lookup on any chain, and confirmation that the recorded Sepolia
  contract exists and has `mint` transactions.
- Finding proofs inside nested calls, which needs transaction traces.
- Checking with the chain whether a group root is accepted or a nullifier
  used. Each is specific to one application's contract.
- Checking the provider's answers against the chain itself, which would
  need a block header trusted from elsewhere.
- The browser page has no lookup: it would have to hold the key.
- Searching for transactions. This looks up one transaction by its hash.
