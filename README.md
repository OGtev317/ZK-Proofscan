# ZK-Proofscan

Turns a supported zero-knowledge proof into a readable, checkable evidence
report. Instead of `0x7a2f…3b1c — Verified`, a report states:

- **Claim:** what the proof establishes, in plain language.
- **Hidden:** what the prover did not reveal.
- **Public:** the public inputs and what each one refers to.
- **Verification:** which verifier and verifying key were used, and the result.
- **Limits:** what the proof does not establish.

**Status: prototype.** A command-line tool and a browser page check one
supported format, Semaphore v4 proofs, show the report above, and export
evidence another person can rerun. A local tool server lets an AI agent run
the same check. Nothing is hosted. The explanation wording is a draft that no
qualified person has reviewed, and reports say so. The code is unaudited and unreleased. Read
[the charter](docs/PROJECT_CHARTER.md), [the handoff](docs/HANDOFF.md) and
[the prototype notes](docs/VERIFICATION_PROTOTYPE.md). What blocks a release
is in [the release review](docs/RELEASE_REVIEW.md).

Local agent instructions and a deterministic presentation seam are prepared,
but no MCP server or agent client is connected. See
[the local agent handoff](docs/LOCAL_AGENT.md) for the scope, privacy gate,
and pending live behavior evaluations.

Licensed GPL-3.0-or-later; see `LICENSE`.

This repository was created on 2026-10-11 as "OtakuCoin" and refocused the same
day. The earlier charter is in Git history at commit `8c0373c`.
