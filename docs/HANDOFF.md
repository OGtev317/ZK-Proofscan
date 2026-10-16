# LumenLenz handoff

## Product-lenses worktree (2026-10-15)

On `feat/product-lenses`, based on `fdb0525`: transaction stories, a narrow
Soroswap-compatible decoder, provider retention reporting and opt-in archive
fallback, profiles/directory derived from the pinned key registry, and local
unsigned-XDR inspection with separately consented read-only simulation.
See [Product lenses](PRODUCT_LENSES.md) for exact coverage, SDK/CLI use,
trust/privacy boundaries and validation. These additions are local development
work, not part of the deployed site or the published 0.1.0 package.
No signing, submission, new paid service, push or deployment is authorized by
the worktree request. No explanation has gained a qualified review.

The original repository was moved during this work to a nested local folder
inside the new worktree; Git's worktree path metadata was repaired without
moving/deleting any files. Unrelated nested project directories must remain
untracked and must never be staged with this feature.

## Prototype (2026-10-11)

Build steps 1 to 3 are written: strict import and verification, explanation
binding, and the readable report with export and rerun, on the command line
and in a browser page. Read
[the prototype notes](VERIFICATION_PROTOTYPE.md) for what exists, what was
measured and what is untested. 257 unit tests and 48 browser tests pass.

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
  scenarios, joined to the server. Read [the agent notes](LOCAL_AGENT.md). Nothing is installed: no client
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
`basis` field and `reportVersion` is 3 (raised on 2026-10-15, when reports began naming a second verifier, so a rerun of an older export shows the difference as a version change). Read [the formats](FORMATS.md) for
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

- The project was renamed and refocused to LumenLenz on the owner's
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
  `lumenlenz lookup` and the `lookup_transaction` tool are built for that.
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
  calls to Nethermind's UltraHonk verifier contract and to Stellar Private
  Payments pools; two real testnet proofs of each passed. Read [the lookup notes](LOOKUP.md).
- 2026-10-15: the same read-only lookup on Stellar's main network, through
  an RPC the operator names in `STELLAR_MAINNET_RPC_URL` (there is no
  public one from the Stellar Development Foundation, and the tool picks
  none). Tested on the main network; no proof has been found there.
- 2026-10-15: Barretenberg 0.87.0 stays, now in the page as well, as part
  of a plan the owner approved: it is the version Nethermind's UltraHonk
  verifier for Stellar checks. It is still the verifier with the most
  faults found; each is refused before it runs.
- 2026-10-15: transaction lookup on the page, for Ethereum and Stellar,
  through public RPCs the page names (dRPC, PublicNode, the Stellar
  Development Foundation's testnet RPC and sorobanrpc.com), with links that
  share a result. The page now contacts those, and only when a visitor
  looks something up or opens a shared link. Read [the lookup notes](LOOKUP.md).
- 2026-10-14: arkworks, from a list of libraries the owner gave. It is a
  second, independent verifier for every Groth16 proof. Of the same list,
  Circom and snarkjs were already here; o1js (for Mina, under Mina zkML) was
  chosen to follow, then deferred by the owner on 2026-10-15; libZK (Google's Longfellow) was left for later as the
  largest job; libsnark and zksk were not added, being unmaintained with no
  standard proof file.
- 2026-10-11: verifier libraries so that the first test release covers four
  kinds of proof: snarkjs, Groth16, Noir and Starknet. Noir is built with
  `@aztec/bb.js` 5.2.1, and Cairo proofs (the proof system Starknet uses)
  with `swiftness` 1.0.0; since 2026-10-14 both also in the page.
  Read "Noir proofs" and "Cairo proofs" in the formats document, including
  why the Cairo verifier is the weakest dependency and why this tool
  enforces its own security floor.

- 2026-10-11: libraries for three Stellar candidates the owner forwarded.
  Read "Stellar: three candidates" in the formats document. Two needed no
  library: the testnet keys of Stellar Private Payments are recognised, and
  RISC Zero Groth16 receipts are verified with snarkjs. For the Soroban
  UltraHonk verifier, `@aztec/bb.js` 0.87.0 is installed beside 5.2.1.
  Testing that older version found four faults, each now refused before it
  runs. At the time no Stellar network was contacted; reading Stellar
  test-network transactions was approved and built on 2026-10-14 (below).

## Review on 2026-10-11

A read of the whole codebase after Noir and Cairo were added found one
fault in a verdict, fixed with a regression test: when the Noir verifier
could not start (for example with no writable temporary folder), a good
proof was reported as rejected. A verifier that cannot run is now an error,
and only the verifier's own refusal is "invalid". The Cairo engine got the
same separation, and a Cairo file containing a backslash is refused.

That commit (`3b47ecf`) also cut this file down to its last sections by
mistake. The lost part was restored from `01d2144` in the next change.

## Built on 2026-10-15, after an outside review

- Readable Stellar facts (fee, memo, operation outcomes, token movements
  from committed events), typed Soroban arguments and events from contract
  interfaces, contract build provenance (SEP-55), explorer links, and a
  draft, unreviewed explanation of Stellar Private Payments' blocklist
  pool. See the lookup notes and the formats document.
- A developer release, prepared and not published: version 0.1.0, a
  library entry point, a `stellar-lumenlenz` binary that the Stellar
  CLI runs as `stellar lumenlenz` (tested with stellar-cli 28.0.0), and
  [the developer guide](DEVELOPERS.md). A packed tarball installed into a
  fresh project worked as a library and as a command. Published to npm
  on 2026-10-15 as `lumenlenz` 0.1.0, an experimental release, from commit
  3344022 (tag `v0.1.0`); `npm run release:check` (also run in CI) passed
  first, and the package installed from npm was tried as a library, a
  command and a Stellar CLI plugin.
- Mainnet RISC Zero, left open: no mainnet contract address is published
  by Boundless (`boundless-xyz/stellar-risc0-verifier`, its deployment
  notes) or Nethermind (`deployment.toml` has blank addresses), and the
  testnet verifier named in the Stellar Foundation's article
  (`CBY3GOBG…`) no longer exists on testnet. No reader was built without a
  real transaction to check it against.
- Local regression transactions, with the owner's approval for a local
  network only: six transactions on a Quickstart network with throwaway
  keys, recorded and replayed in `tests/stellar-local.test.ts`. They found
  that the asset contract's `approve` names its last parameter
  `live_until_ledger`, now fixed. Nothing was sent to testnet or mainnet.
- Renamed from ZK-Proofscan to LumenLenz on 2026-10-15, by the owner's
  decision, before the first npm release: the package, the commands
  (`lumenlenz`, `lumenlenz-mcp`, `stellar-lumenlenz`), the name in reports
  and the tool server, the page and the documentation, and the
  environment variables (`LUMENLENZ_RPC_URL` and the `LUMENLENZ_…=off`
  switches). Kept: the GitHub repository's address, the arkworks
  module's crate name (renaming it would change the committed WebAssembly,
  which CI rebuilds byte for byte), and the recorded agent evaluation
  results, which are records of past runs.
- A review packet for the Stellar Private Payments explanation is in
  [docs/review](review/stellar-private-payments.md), not yet sent.

## Next, for the owner

- Name who reviews the explanation wording and the registry entries. Until
  then every explanation says NOT REVIEWED.
- Choose which Noir circuits, Cairo programs or RISC Zero programs, if any,
  should get an explanation. Today those formats verify and are not
  explained. Stellar Private Payments' blocklist pool has a draft
  explanation (2026-10-15); decide whether to offer it to Nethermind for
  review, which is what would lift NOT REVIEWED.
- Decide whether to send the request to ZK Email's maintainers drafted in
  the formats document. It has not been sent.
- The release questions in [the release review](RELEASE_REVIEW.md),
  including whether the name "LumenLenz" is already used by another
  product, which has not been checked.
