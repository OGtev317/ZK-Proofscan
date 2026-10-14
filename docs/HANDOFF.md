# ZK-Proofscan handoff

## Prototype (2026-10-11)

Build steps 1 to 3 are written: strict import and verification, explanation
binding, and the readable report with export and rerun, on the command line
and in a browser page. Read
[the prototype notes](VERIFICATION_PROTOTYPE.md) for what exists, what was
measured and what is untested. 187 unit tests and 32 browser tests pass.

Owner decisions taken: GPL-3.0-or-later; TypeScript, Semaphore v4 and snarkjs
for the first version. The main checkout holds the core, command line and
tests. Adapter wording and source research belong
to the other session, in its own checkout. One session per checkout.

The adapter wording in `adapters/semaphore-v4/adapter.json` is a draft taken
from the owner's illustrative report so the machinery could be built and
tested. Whoever changes it must update `lock.json` with the new SHA-256 and
raise the revision. It is at revision 2.

Step 4, release review, is recorded in [the release review](RELEASE_REVIEW.md).
Everything that can be done without other people is done. What remains needs
a qualified reviewer for the adapter wording, an independent security review,
real-device browser checks and owner decisions on hosting and publishing.
Nothing is released. With the owner's approval, the page has been published with GitHub
Pages from `main` since 2026-10-12, by the `deploy` job in the CI workflow.

## Agent work (2026-10-11)

The owner approved building an AI agent as a way to use the tool, on the
condition that the agent never verifies and never supplies the claim wording.

- Step 1, the local tool server (`src/mcp.ts`), is on `main`; see "Tool
  server for AI agents" in the prototype notes.
- Step 2, the agent instructions, fixed presentation and evaluation
  scenarios, was written by the Codex session and joined to the server here.
  Read [the agent notes](LOCAL_AGENT.md). Nothing is installed: no client
  configuration is committed.
- Step 3, scenarios against a real model: eleven were run once each on
  2026-10-11 and all behaved as required; the run also exposed a defect in
  the server's results, since fixed. No model has used the transaction
  lookup or checked a Noir, Cairo or RISC Zero proof. The owner approved Anthropic, through
  Claude Code, for the throwaway fixtures only. No provider is approved for
  real proofs, and one run on one model is not a guarantee.

A hosted chat version is not approved.

## More formats (2026-10-11)

The owner asked for as many proof formats as possible. Built and on `main`: Groth16 (BN254, BLS12-381), PLONK and FFLONK
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
verifier library.
The mechanism for that is built (`src/recorded/`): an explanation bound to
one recorded key is applied when a proof comes with exactly that key
(`basis: recorded-circuit`). Its first subject is ZK Email's Proof of
Twitter demonstration, the only candidate that could be checked end to end
on 2026-10-11. It meets four of the six requirements the owner's research
set; the formats document has the scorecard and a request to ZK Email's
maintainers, drafted and not sent. The Succinct residency-invite blueprint
stays the first choice once its registry data can be read; adding it needs
a registry entry, an adapter and fixtures, not new code.

## State on 2026-10-11

- The project was renamed and refocused to ZK-Proofscan on the owner's
  instruction. Remote: `https://github.com/OGtev317/ZK-Proofscan`, made
  public on 2026-10-12 by the owner's decision.
- An older local folder from before the rename holds another session's
  uncommitted work. It is to be left alone until that work is inventoried
  and a recoverable copy is confirmed.
- At the rename the repository held only guidance and a charter. There is no
  hosted service.
- Nothing was copied from any other project.
- The earlier charter is in Git history at commit `8c0373c`. It is not part
  of this project's direction.

## Approvals given, and their limits

- 2026-10-11: read-only chain lookups through Alchemy, on any chain.
  `zk-proofscan lookup` and the `lookup_transaction` tool are built for that.
  On 2026-10-12 the owner put a key in a local `.env` and the lookup was run
  on Sepolia: 16 real transactions, all verified. Read [the lookup
  notes](LOOKUP.md). Wallet
  actions, signing, transactions, deployment and paid infrastructure are
  not approved.
- 2026-10-12: publishing the page with GitHub Pages, from `main`, at the
  owner's own domain. No other hosted service is approved.
- 2026-10-14: read-only requests to a public Stellar RPC, testnet first, to
  look a proof up by Stellar transaction. No wallet, signing or
  transactions. Built the same day: `lookup --chain stellar-testnet` reads
  calls to Nethermind's UltraHonk verifier contract, and two real testnet
  proofs passed. Read [the lookup notes](LOOKUP.md).
- 2026-10-11: verifier libraries so that the first test release covers four
  kinds of proof: snarkjs, Groth16, Noir and Starknet. Noir is built with
  `@aztec/bb.js` 5.2.1, and Cairo proofs (the proof system Starknet uses)
  with `swiftness` 1.0.0, both on the command line and tool server only.
  Read "Noir proofs" and "Cairo proofs" in the formats document, including
  why the Cairo verifier is the weakest dependency and why this tool
  enforces its own security floor.

- 2026-10-11: libraries for three Stellar candidates the owner forwarded.
  Read "Stellar: three candidates" in the formats document. Two needed no
  library: the testnet keys of Stellar Private Payments are recognised, and
  RISC Zero Groth16 receipts are verified with snarkjs. For the Soroban
  UltraHonk verifier, `@aztec/bb.js` 0.87.0 is installed beside 5.2.1.
  Testing that older version found four faults, each now refused before it
  runs. No Stellar network was contacted; reading Stellar transactions or
  contracts is not built and not approved.

## Review on 2026-10-11

A read of the whole codebase after Noir and Cairo were added found one
fault in a verdict, fixed with a regression test: when the Noir verifier
could not start (for example with no writable temporary folder), a good
proof was reported as rejected. A verifier that cannot run is now an error,
and only the verifier's own refusal is "invalid". The Cairo engine got the
same separation, and a Cairo file containing a backslash is refused.

That commit (`3b47ecf`) also cut this file down to its last sections by
mistake. The lost part was restored from `01d2144` in the next change.

## Next, for the owner

- Name who reviews the explanation wording and the registry entries. Until
  then every explanation says NOT REVIEWED.
- Choose which Noir circuits, Cairo programs or RISC Zero programs, if any,
  should get an explanation. Today those formats verify and are not
  explained. For Stellar Private Payments an explanation also needs a real
  proof to test with, which the project does not publish.
- Decide whether Barretenberg 0.87.0 stays. It is there for one Stellar
  verifier, and it is the verifier in this tool with the most faults found.
- Decide whether to send the request to ZK Email's maintainers drafted in
  the formats document. It has not been sent.
- The release questions in [the release review](RELEASE_REVIEW.md),
  including whether the name "ZK-Proofscan" is already used by another
  product, which has not been checked.
