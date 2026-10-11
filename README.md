# ZK-Proofscan

Turns a supported zero-knowledge proof into a readable, checkable evidence
report. Instead of `0x7a2f…3b1c — Verified`, a report states:

- **Claim:** what the proof establishes, in plain language.
- **Hidden:** what the prover did not reveal.
- **Public:** the public inputs and what each one refers to.
- **Verification:** which verifier and verifying key were used, and the result.
- **Limits:** what the proof does not establish.

**Status: project charter only.** There is no code, specification, dependency
or hosted service yet. Read [the charter](docs/PROJECT_CHARTER.md) and
[the handoff](docs/HANDOFF.md).

This repository was created on 2026-10-11 as "OtakuCoin" and refocused the same
day. The earlier charter is in Git history at commit `8c0373c`.
