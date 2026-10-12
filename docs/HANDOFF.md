## Approvals given, and their limits

- 2026-10-11: read-only chain lookups through Alchemy, on any chain.
  `zk-proofscan lookup` and the `lookup_transaction` tool are built for that
  and tested against a stand-in provider only; no key was configured, so no
  real chain has been read. Read [the lookup notes](LOOKUP.md). Wallet
  actions, signing, transactions, deployment, hosted services and paid
  infrastructure are not approved.
- 2026-10-11: verifier libraries so that the first test release covers four
  kinds of proof: snarkjs, Groth16, Noir and Starknet. Noir is built with
  `@aztec/bb.js` 5.2.1, and Cairo proofs (the proof system Starknet uses)
  with `swiftness` 1.0.0, both on the command line and tool server only.
  Read "Noir proofs" and "Cairo proofs" in the formats document, including
  why the Cairo verifier is the weakest dependency and why this tool
  enforces its own security floor.

## Review on 2026-10-11

A read of the whole codebase after Noir and Cairo were added found one
fault in a verdict, fixed with a regression test: when the Noir verifier
could not start (for example with no writable temporary folder), a good
proof was reported as rejected. A verifier that cannot run is now an error,
and only the verifier's own refusal is "invalid". The Cairo engine got the
same separation, and a Cairo file containing a backslash is refused.

## Next, for the owner

- Put an Alchemy key in a local `.env` so the first real lookup can be run
  and the recorded Sepolia contract confirmed.
- Name who reviews the explanation wording and the registry entries. Until
  then every explanation says NOT REVIEWED.
- Choose which Noir circuits or Cairo programs, if any, should get an
  explanation. Today those two formats verify and are not explained.
- Decide whether to send the request to ZK Email's maintainers drafted in
  the formats document. It has not been sent.
- The release questions in [the release review](RELEASE_REVIEW.md),
  including whether the name "ZK-Proofscan" is already used by another
  product, which has not been checked.
