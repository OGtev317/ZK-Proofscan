# ZK-Proofscan handoff

## Prototype (2026-10-11)

Build steps 1 to 3 are written: strict import and verification, explanation
binding, and the readable report with export and rerun, on the command line
and in a browser page. Read
[the prototype notes](VERIFICATION_PROTOTYPE.md) for what exists, what was
measured and what is untested. 111 unit tests and 22 browser tests pass.

Owner decisions taken: GPL-3.0-or-later; TypeScript, Semaphore v4 and snarkjs
for the first version. The checkout `/Users/tevdev/Desktop/ZK-Proofscan` holds
the core, command line and tests. Adapter wording and source research belong
to the other session, in its own checkout. One session per checkout.

The adapter wording in `adapters/semaphore-v4/adapter.json` is a draft taken
from the owner's illustrative report so the machinery could be built and
tested. Whoever changes it must update `lock.json` with the new SHA-256 and
raise the revision. It is at revision 2.

Step 4, release review, is recorded in [the release review](RELEASE_REVIEW.md).
Everything that can be done without other people is done. What remains needs
a qualified reviewer for the adapter wording, an independent security review,
real-device browser checks and owner decisions on hosting and publishing.
Nothing is released or hosted.

## Agent work (2026-10-11)

The owner approved building an AI agent as a way to use the tool, on the
condition that the agent never verifies and never supplies the claim wording.

- Step 1, the local tool server (`src/mcp.ts`), is on `main`; see "Tool
  server for AI agents" in the prototype notes.
- Step 2, the agent instructions, fixed presentation and evaluation
  scenarios, was written by the Codex session and joined to the server here.
  Read [the agent notes](LOCAL_AGENT.md). Nothing is activated: no client
  configuration is committed and no model has been run with it.
- Step 3, the eight scenarios against a real model, was run once on
  2026-10-11 and all eight behaved as required; it also exposed a defect in
  the server's results, since fixed. The owner approved Anthropic, through
  Claude Code, for the throwaway fixtures only. No provider is approved for
  real proofs, and one run on one model is not a guarantee.

A hosted chat version is not approved.

## More formats (2026-10-11)

The owner asked for as many proof formats as possible. Built on the branch
`feat/supplied-key-proofs`: Groth16 (BN254, BLS12-381), PLONK and FFLONK
proofs written by snarkjs, checked against a key the user supplies, on the
command line, the page and the tool server. Such a report says the proof
fits the key and that the circuit is unknown; every report now carries a
`basis` field and `reportVersion` is 2. Read [the formats](FORMATS.md) for
the rule, the findings and what each further format needs. 
A key registry (`registry/keys.json`, `src/registry.ts`) recognises a
supplied key that is on record and reports provenance, the link to circuit
source, the record's review and the explanation's review as separate lines.
It holds the 32 Semaphore v4 keys. Next, by the direction recorded in the
formats document: one pinned ZK Email blueprint, offline, with no new
verifier library. That starts with research to pick a published blueprint
and key and to find reproducible test proofs.

## State on 2026-10-11

- The project was renamed and refocused from "OtakuCoin" to ZK-Proofscan on
  the owner's instruction. Private remote:
  `https://github.com/OGtev317/ZK-Proofscan`.
- The local checkout is still the folder `/Users/tevdev/Desktop/OtakuCoin`. It
  was not renamed because another session had uncommitted work in it.
- At the rename the repository held only guidance and a charter. There is no
  hosted service.
- Nothing was copied from any other project.
- The OtakuCoin charter (physical-encounter receipts) is in Git history at
  commit `8c0373c`. A local branch `research/exchange-receipts-2026-10-11` held
  uncommitted research for that earlier direction when the refocus was made; it
  was left untouched and is not part of this project's direction.

## Next

The owner needs to answer the "Open decisions" at the end of the charter. The
recommended first deliverable is a written report specification with one
worked example, which is documentation and needs no further approval.

Public RPC, on-chain, wallet, hosted-service and paid-infrastructure work are
not approved. Not verified: whether the name "ZK-Proofscan" or "Proofscan" is
already used by another product.
