# ZK-Proofscan handoff

## Prototype (2026-10-11)

Build steps 1 to 3 are written: strict import and verification, explanation
binding, and the readable report with export and rerun. Read
[the prototype notes](VERIFICATION_PROTOTYPE.md) for what exists, what was
measured and what is untested. 48 tests pass.

Owner decisions taken: GPL-3.0-or-later; TypeScript, Semaphore v4 and snarkjs
for the first version. The checkout `/Users/tevdev/Desktop/ZK-Proofscan` holds
the core, command line and tests. Adapter wording and source research belong
to the other session, in its own checkout. One session per checkout.

The adapter wording in `adapters/semaphore-v4/adapter.json` is a draft taken
from the owner's illustrative report so the machinery could be built and
tested. Whoever changes it must update `lock.json` with the new SHA-256 and
raise the revision.

Open, in order of importance:

1. A named, qualified reviewer for the adapter wording. Until then it stays
   marked unreviewed.
2. Evidence linking the key file to the circuit source and trusted setup.
3. Step 4, release review, and the browser interface with a verification
   worker. Neither is started.

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
