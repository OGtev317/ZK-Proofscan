# LumenLenz

*Formerly ZK-Proofscan; renamed on 2026-10-15. The repository keeps the
name ZK-Proofscan.*

An open-source Stellar proof-verification tool that turns supported
transactions into readable reports, separating what the network data says,
this tool's own check of the proof, and settlement. It also turns a
supported zero-knowledge proof file into a readable, checkable evidence
report. Instead of `0x7a2f…3b1c — Verified`, a report states:

- **Claim:** what the proof establishes, in plain language.
- **Hidden:** what the prover did not reveal.
- **Public:** the public inputs and what each one refers to.
- **Verification:** which verifier and verifying key were used, and the result.
- **Limits:** what the proof does not establish.

**Status: prototype.** A command-line tool, a browser page and a local tool
server for AI agents check proofs and show the report above. The page is published at
<https://akashi.zatrix.xyz/> with GitHub Pages, from each commit on `main` that
passes the tests. On the page, paste a transaction hash or a block explorer
link from Ethereum or Stellar and press Enter: it finds the proof, checks it
on your device, and says what happened, whether the proof passed, what it
proves and what remains unknown, with a link to share the result. A
transaction with no proof the tool can read is described instead (who sent
it, what it did, whether it succeeded, and on Ethereum chains the tokens it
moved and any allowance it granted, flagging unlimited ones). The code is
unaudited. Version 0.2.0 is an **experimental release** for developers to
try: its reports and interfaces may change, and no result from it should
be relied on for a decision with real value at stake.

Every Groth16 proof is checked by two independent verifiers, snarkjs and
arkworks, and a result stands only when they agree.

| Proof | Checked against | Explained | Where |
| --- | --- | --- | --- |
| Semaphore v4 membership | Keys bundled with this tool | Yes, draft wording | Command line, page, tool server |
| Groth16, PLONK, FFLONK written by snarkjs | A key the user supplies | ZK Email's Proof of Twitter demonstration and Stellar Private Payments' blocklist pool, draft wording | Command line, page, tool server |
| UltraHonk written by Barretenberg for a Noir program (5.2.1, or 0.87.0 with the Keccak transcript) | A key the user supplies | No | Command line, page, tool server |
| RISC Zero Groth16 receipt | RISC Zero's version 3.0.0 verifier parameters, pinned in this tool | No; the program is known by its image ID | Command line, page, tool server |
| Cairo STARK, the kind Starknet uses, in the Stone prover's layout | No key; the program is known by its hash | No | Command line, page, tool server |

"Explained" means the report says what the proof establishes. Without an
explanation a pass says only that the proof fits the key, or that a program
with a given hash ran. **No qualified person has reviewed any explanation
wording, and reports say so.** A supplied key that matches a recorded one is
named; the record holds Semaphore v4's keys, the Proof of Twitter key and
the testnet keys of Nethermind's Stellar Private Payments. See [the formats](docs/FORMATS.md) for what each kind of result does
and does not say.

Every check runs on the user's machine and can be exported as evidence
another person reruns. One command uses a network: a proof can be looked up
by transaction hash through a chain data provider and then checked locally.
It has been run against one real contract on the Sepolia test network,
and on Stellar's test network against Nethermind's UltraHonk verifier
contract and a Stellar Private Payments pool. Stellar's main network can be
read through an RPC the operator chooses; no proof has been found there yet
([lookup notes](docs/LOOKUP.md)).

Developers: install, the command line, the Stellar CLI plugin
(`stellar lumenlenz …`), the library and the agent tool server are in
[the developer guide](docs/DEVELOPERS.md). Version 0.2.0 is
on npm as an experimental release: `npm install -g lumenlenz`.

Read [the charter](docs/PROJECT_CHARTER.md), [the handoff](docs/HANDOFF.md)
and [the prototype notes](docs/VERIFICATION_PROTOTYPE.md). What blocks a
release is in [the release review](docs/RELEASE_REVIEW.md).

Instructions for an AI agent that uses the tool server are written and were
tested once on one model with throwaway proofs. They are not installed in
any client. See [the local agent notes](docs/LOCAL_AGENT.md) for the scope,
the data-sharing decision that comes first, and what the test does not show.

Licensed GPL-3.0-or-later; see `LICENSE`.

This repository was created on 2026-10-11 under another name and refocused
the same day. The earlier charter is in Git history at commit `8c0373c`.
