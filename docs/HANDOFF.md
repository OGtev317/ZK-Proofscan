# ZK-Proofscan handoff

## Verification prototype (2026-10-11)

Build step 1 is written on branch `feat/verification-prototype` in the
checkout `/Users/tevdev/Desktop/ZK-Proofscan`. Read
[the prototype notes](VERIFICATION_PROTOTYPE.md) for what exists, what was
measured and what is untested. 27 tests pass.

Owner decisions taken: GPL-3.0-or-later; TypeScript, Semaphore v4 and snarkjs
for the first version; this checkout holds the core, command line and tests.
Adapter text and source research belong to the other session, in its own
checkout. One session per checkout.

Next is build step 2, explanation binding: approved templates tied to exact
artifacts, with tests that reject swapped metadata or verifier artifacts. It
depends on the adapter text and on naming a human reviewer.

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
