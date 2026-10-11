# ZK-Proofscan

Turns a supported zero-knowledge proof into a readable, checkable evidence
report. Instead of `0x7a2f…3b1c — Verified`, a report states:

- **Claim:** what the proof establishes, in plain language.
- **Hidden:** what the prover did not reveal.
- **Public:** the public inputs and what each one refers to.
- **Verification:** which verifier and verifying key were used, and the result.
- **Limits:** what the proof does not establish.

**Status: prototype.** A command-line tool and a browser page check
Semaphore v4 proofs against bundled keys, and Groth16, PLONK and FFLONK
proofs written by snarkjs against a key the user supplies. They show the
report above and export evidence another person can rerun. See
[the formats](docs/FORMATS.md) for what each kind of result does and does
not say. A local tool server lets an AI agent run
the same check. Nothing is hosted. The explanation wording is a draft that no
qualified person has reviewed, and reports say so. The code is unaudited and unreleased. Read
[the charter](docs/PROJECT_CHARTER.md), [the handoff](docs/HANDOFF.md) and
[the prototype notes](docs/VERIFICATION_PROTOTYPE.md). What blocks a release
is in [the release review](docs/RELEASE_REVIEW.md).

Instructions for an AI agent that uses the tool server are written but not
activated, and no agent has been tested with them. See
[the local agent notes](docs/LOCAL_AGENT.md) for the scope, the data-sharing
decision that comes first, and the pending evaluations.

Licensed GPL-3.0-or-later; see `LICENSE`.

This repository was created on 2026-10-11 as "OtakuCoin" and refocused the same
day. The earlier charter is in Git history at commit `8c0373c`.
