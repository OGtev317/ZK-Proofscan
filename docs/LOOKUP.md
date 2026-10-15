# Looking up a proof by transaction

Written 2026-10-11. The owner approved read-only chain lookups through
Alchemy, on any chain, on that date, and read-only requests to a public
Stellar RPC: the test network on 2026-10-14, the main network on
2026-10-15 (see "Stellar" below).
Nothing else on a chain is approved: no wallet, no signing, no
transactions, no deployment.

**Run against a real chain once, on 2026-10-12** (see "Run on a real
chain" below). The automated tests still use a stand-in provider on this
machine and call data built from the test proofs, so they need no key.

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
`arbitrum`, `polygon`. On 2026-10-12 Alchemy answered with the expected
chain id for `ethereum`, `sepolia`, `base` and `base-sepolia`. The network
names for `optimism`, `arbitrum` and `polygon` are from memory and
untested: they were not enabled for the owner's key.

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
| `mint(uint256[8],uint256[3])` | ZK Email Proof of Twitter, checked with the recorded key | Sepolia `0xab157f13e9643f45aea693fdb1a3c22dbdb984a5`, named in the demonstration's app settings. Has contract code and 16 `mint` transactions, as reported by Alchemy on 2026-10-12 |
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

## Run on a real chain

On 2026-10-12, with the owner's Alchemy key in a local `.env`, every
transaction Alchemy listed as sent to the recorded Proof of Twitter
contract on Sepolia was looked up: 16 transactions, from block 7339733
back. In each, the chain had accepted the transaction, the proof was read
from the `mint` call, and it passed here against the recorded key. For
example:

```sh
node --env-file=.env dist/cli.js lookup 0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787 --chain sepolia
```

This is one contract, one call shape and one provider. No reverted
transaction, no proof this tool rejects and no Semaphore call has been met
on a real chain; those cases are covered only by the stand-in provider.
The list of transactions came from the provider and may be incomplete.

## Not done

- Finding proofs inside nested calls, which needs transaction traces.
- Checking with the chain whether a group root is accepted or a nullifier
  used. Each is specific to one application's contract.
- Checking the provider's answers against the chain itself, which would
  need a block header trusted from elsewhere.
- The browser page has no lookup: for an Ethereum chain it would have to
  hold the key.
- Searching for transactions. This looks up one transaction by its hash.

## Stellar

Built 2026-10-14. `lookup --chain stellar-testnet` reads two kinds of call:

- `verify_proof(public_inputs, proof)` on Nethermind's UltraHonk verifier
  contract (`rs-soroban-ultrahonk`). That contract checks Barretenberg
  0.87.0 Keccak proofs, so this tool checks the proof with its own copy of
  that version. The contract keeps its key in its storage under `vk`.
- `transact(proof, ext_data, sender)` on a pool of Nethermind's Stellar
  Private Payments. The proof is Groth16 on BN254, checked with snarkjs.
  The pool's storage names its verifier contract and its policy; the
  verifier has its key compiled into its code. This tool uses the one
  recorded Stellar Private Payments key every point of which appears in
  that code, and puts the public inputs in the order the pool's code
  passes them (read at commit `0471e6b`): the tree root, the amount, the
  external data hash, the nullifiers, the two output commitments, then the
  membership and non-membership roots once per nullifier when the pool's
  policy requires them.

```sh
node dist/cli.js lookup 10dd8ab5bcfbc8395030144cdfc5cb200ce61d38e7fad533e18e3aee89bbb3b2 --chain stellar-testnet
```

It makes read requests only: `getNetwork`, to confirm the provider serves
the test network; `getTransaction`; and `getLedgerEntries` for the
contracts' storage, and for a pool, its verifier's code. The verification
key is never in the transaction. The provider
is the Stellar Development Foundation's public testnet RPC unless the
operator sets `STELLAR_RPC_URL`. No key or account is needed, and nothing
is signed or sent to the network. Stellar's transaction format is read
with `@stellar/stellar-base` 15.0.0, the Foundation's own library
(Apache-2.0); it brought 38 further packages, all permissively licensed,
listed in the third-party notices.

| Statement | Rests on |
| --- | --- |
| The proof is valid, and what it establishes | This tool's own check, as for any proof |
| The transaction is the one asked for | This tool: the hash is computed here from the transaction the provider sent |
| The transaction was in that ledger, and the network accepted or failed it | The provider's word |
| The key is the one used when the transaction ran | The provider's word for the contracts' storage and when it last changed. If it last changed before the transaction's ledger, the report says so; otherwise it says the key may not be the one used |
| For a pool: the verifier uses the key found in its code | Not checked. Every point of the key appears in the code, which the provider cannot alter (code is stored under its own hash, checked here), but that the code uses those points as its key was not checked |

A public Stellar RPC keeps only about the last week of transactions. An
older one is reported as not found, which says nothing about a proof.
This tool has no record of Stellar deployments: the report names the
contract and the SHA-256 of its code, and says it is not on record.

### Run on the test network

On 2026-10-14 the two `verify_proof` transactions of that night's test run
in Nethermind's repository (`10dd8ab5…` and `50d4bc8d…`, ledgers 5184196
and 5184198) were looked up through the public testnet RPC. In each, the
network had accepted the transaction, the key had last changed at ledger
5184194, before it, and the proof passed here under Barretenberg 0.87.0. So
the contract and this tool agree on those two real proofs. The answers for
the first are kept as a test fixture, so the tests need no network.

Also on 2026-10-14, the two `transact` transactions the public RPC held
for Nethermind's blocklist pool `CA73PEBS…` (`cd1d09c9…` and `0460a0f6…`,
ledgers 5190131 and 5191591) were looked up. In each, every point of the
recorded key `policy_tx_2_2_B` was in the code of the pool's verifier
`CA66PGQD…`, the pool and verifier had last changed at ledger 5190087,
before the transaction, and the proof passed here with nine public
inputs. These are the first real proofs this tool has checked under any
Stellar Private Payments key. The answers for the first are a test fixture.

### The main network

Added 2026-10-15: `lookup --chain stellar-mainnet` reads the same two
calls. The Stellar Development Foundation runs no public RPC for the main
network, so this tool has no default: the operator names one in
`STELLAR_MAINNET_RPC_URL`, and the transaction hash goes to whoever runs
it. Public ones are listed at
<https://developers.stellar.org/docs/data/apis/rpc/providers>; Gateway,
sorobanrpc.com and Lightsail each answered for the main network on
2026-10-15.

Tested on the main network that day through sorobanrpc.com: an ordinary
recent transaction was reported as not a call this tool reads, the test
network transaction's hash as not found, and the public testnet RPC named
as a main-network RPC as not serving the main network. **No proof has been
looked up on the main network**: no deployment of either contract there
was found. The keys recorded for Stellar Private Payments are its testnet
keys, and a report says so.

### Not done on Stellar

- The Stellar Private Payments pool with an authority view key (`gvk`),
  whose call carries more fields; it had no transactions to test with.
  The RISC Zero verifier, which has no deployment on record in its
  repository; and the two example contracts in the UltraHonk repository
  (`identity`, `tornado_classic`).
- Checking the provider's answers against the network itself.

