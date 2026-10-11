# ZK-Proofscan

Turns a supported zero-knowledge proof into a readable, checkable evidence
report. Instead of `0x7a2f…3b1c — Verified`, a report states:

- **Claim:** what the proof establishes, in plain language.
- **Hidden:** what the prover did not reveal.
- **Public:** the public inputs and what each one refers to.
- **Verification:** which verifier and verifying key were used, and the result.
- **Limits:** what the proof does not establish.

**Status: verification prototype.** A command-line tool checks one supported
format, Semaphore v4 proofs, and reports the result. The explanation sections
above are not built yet. The code is unaudited and unreleased. Read
[the charter](docs/PROJECT_CHARTER.md), [the handoff](docs/HANDOFF.md) and
[the prototype notes](docs/VERIFICATION_PROTOTYPE.md).

Licensed GPL-3.0-or-later; see `LICENSE`.

This repository was created on 2026-10-11 as "OtakuCoin" and refocused the same
day. The earlier charter is in Git history at commit `8c0373c`.
