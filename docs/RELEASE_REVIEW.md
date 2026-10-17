# Release review (build step 4)

Written 2026-10-11. This records what was checked before any release and what
still blocks one. On 2026-10-15 the owner decided to publish version 0.1.0 to
npm as a clearly marked **experimental release** with the blockers below
still open, rather than wait for an outside review; they block a release
that asks to be relied on, not an experimental one. The repository was made
public and the page was published with GitHub Pages on 2026-10-12, both before
the blockers below were cleared; the page says it is an unaudited prototype.

## Done

| Item | Result |
| --- | --- |
| Licence | GPL-3.0-or-later, decided by the owner. `LICENSE` holds the text. |
| Dependency licences | 121 production packages (38 came with the Stellar library on 2026-10-14, 34 with viem and 1 with smol-toml on 2026-10-15): MIT, GPL-3.0, Apache-2.0, ISC, BSD-3-Clause, 0BSD, "MIT AND Zlib" and "MIT AND BSD-3-Clause", as each declares; `swiftness` declares only "see LICENSE", and its licence file is Apache-2.0. Listed in `THIRD_PARTY_NOTICES.md`; CI fails if the list is out of date. |
| Known vulnerabilities | `npm audit --omit=dev` reports none; CI runs it on every push. |
| Verifier version | snarkjs 0.7.6, pinned exactly. Compared with 0.7.5 on aliased public inputs: no difference found for Groth16. |
| Keys and proving keys | All 32 bundled verification keys equal those inside Semaphore's published proving keys. See `artifacts/semaphore-v4/README.md`. |
| Claim mapping, mechanical part | The claim appears only for an accepted proof; adapter, lock, verifier version and keys are bound by hash; forged exports are detected. Covered by tests. |
| Browsers | Chromium and WebKit through Playwright, on macOS and in CI on Linux. |
| Continuous integration | Unit tests on Node 22 and 24, browser tests, audit and notices check. |
| Package release check | `npm run release:check` (added 2026-10-15) builds from clean, runs the type check and tests, checks the versions agree and the notices are current, checks what `npm pack` would publish (no tests, sources, scripts, environment files, keys, large reference strings or local paths), then installs the packed tarball into an empty folder and checks a Semaphore and two Noir proofs through the library and all three commands. CI runs it on every push. |
| Local regression transactions | Six transactions on a local Stellar network, recorded and replayed in tests; see [the lookup notes](LOOKUP.md). They found one fault (an allowance parameter's name), now fixed. |
| Review of earlier commits | Two findings on `231c545` (escaped duplicate field, limits missing from JSON) fixed with regression tests. |

## Blocks a release

1. **No qualified person has reviewed the explanation wording against the
   circuit.** The adapter is marked unreviewed and every passing report says
   so. This is the main thing a user relies on.
2. **No independent security review** of this code. The author and the tests
   are not independent of each other.
3. **The audit status of snarkjs 0.7.6 is not confirmed.** Semaphore's
   published audit covers a named Semaphore v4 beta, not this verifier
   version and not this tool. Since 2026-10-14 every Groth16 result must
   also be given by arkworks' `ark-groth16` 0.6.0, which lessens but does
   not remove this: no audit of that version was found either.
4. **Proving keys are not tied to the circuit source or the trusted setup.**
5. **Not opened in real Safari** on a Mac or iPhone, in Firefox, or on Windows.
6. **The name has not been checked** against existing products.
7. **Supplied-key proofs (added after this review).** Their fixed wording
   has had no qualified review; PLONK and FFLONK verification in snarkjs has
   had less scrutiny than Groth16; and one value in an FFLONK proof is not
   read by the verifier. The Proof of Twitter explanation is an unreviewed
   draft for a demonstration circuit whose setup is undocumented, and the
   registry entries have had no maintainer review. See
   [the formats](FORMATS.md).
8. **Noir verification (added after this review).** No audit status is
   confirmed for `@aztec/bb.js` 5.2.1; its setup files are as Aztec's server
   sent them and were not compared with the ceremony's record; and files
   written by the `bb` command-line program were not tried.
9. **Cairo verification (added after this review).** `swiftness` 1.0.0 has
   no known audit and no release since January 2025, and it accepts the
   security level a proof declares; this tool adds its own floor. It reads
   the older Stone layout only.
10. **Transaction lookup (added after this review)** has been run
    against one real contract only, on Sepolia, on 2026-10-12. Three of
    the seven Alchemy network names are unconfirmed, and no rejected or
    reverted case has been met on a real chain. The Stellar lookup has
    checked real proofs on the test network only (the main network is read
    but no proof was found there), and trusts the provider for the
    contracts' storage.
11. **The browser page has not been tried on real Safari, Firefox or a
    phone**; Playwright's WebKit is the nearest tested. (It checks Noir
    proofs from both Barretenberg versions and Cairo proofs since
    2026-10-14 and 2026-10-15.)
12. **Barretenberg 0.87.0 (added after this review)** is an old verifier
    with no confirmed audit status. Testing found it accepts an all-zero
    proof under an all-zero key and several rewritten forms of a proof.
    This tool refuses each before the verifier runs, but faults that were
    not looked for may remain. See [the formats](FORMATS.md).
13. **RISC Zero receipts and Stellar keys (added after this review).** One
    real receipt was available; the statement layout is written here and
    has had no review. The Stellar Private Payments keys have no trusted
    setup; two real testnet proofs pass under one of them.

## Owner decisions still open

- Who reviews the adapter, and what evidence a review must leave behind.
- Decided 2026-10-15: version 0.1.0 is published to npm as an experimental
  release, as `lumenlenz` (published 2026-10-15). A review of the Stellar Private Payments explanation has been
  prepared for its authors ([the review packet](review/stellar-private-payments.md))
  and is not yet sent.
- Decided 2026-10-16: version 0.2.0 is published to npm as an experimental
  release (tag `v0.2.0`). The blockers above still apply to it.
- Whether exports should bundle the key file and adapter so a rerun does not
  depend on having the same version of the tool.
- Which further circuits or programs get an explanation. Each one needs its
  own adapter and review.
