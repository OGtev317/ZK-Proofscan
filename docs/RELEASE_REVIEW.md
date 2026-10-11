# Release review (build step 4)

Written 2026-10-11. This records what was checked before any release and what
still blocks one. **Nothing has been released, published or hosted.**

## Done

| Item | Result |
| --- | --- |
| Licence | GPL-3.0-or-later, decided by the owner. `LICENSE` holds the text. |
| Dependency licences | 27 production packages: MIT, GPL-3.0, Apache-2.0 and ISC, as each declares. Listed in `THIRD_PARTY_NOTICES.md`; CI fails if the list is out of date. |
| Known vulnerabilities | `npm audit --omit=dev` reports none; CI runs it on every push. |
| Verifier version | snarkjs 0.7.6, pinned exactly. Compared with 0.7.5 on aliased public inputs: no difference found for Groth16. |
| Keys and proving keys | All 32 bundled verification keys equal those inside Semaphore's published proving keys. See `artifacts/semaphore-v4/README.md`. |
| Claim mapping, mechanical part | The claim appears only for an accepted proof; adapter, lock, verifier version and keys are bound by hash; forged exports are detected. Covered by tests. |
| Browsers | Chromium and WebKit through Playwright, on macOS and in CI on Linux. |
| Continuous integration | Unit tests on Node 22 and 24, browser tests, audit and notices check. |
| Review of earlier commits | Two findings on `231c545` (escaped duplicate field, limits missing from JSON) fixed with regression tests. |

## Blocks a release

1. **No qualified person has reviewed the explanation wording against the
   circuit.** The adapter is marked unreviewed and every passing report says
   so. This is the main thing a user relies on.
2. **No independent security review** of this code. The author and the tests
   are not independent of each other.
3. **The audit status of snarkjs 0.7.6 is not confirmed.** Semaphore's
   published audit covers a named Semaphore v4 beta, not this verifier
   version and not this tool.
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

## Owner decisions still open

- Who reviews the adapter, and what evidence a review must leave behind.
- Whether and where the page is hosted. Hosting needs explicit approval.
- Whether the package is published to npm. It is marked private.
- Whether exports should bundle the key file and adapter so a rerun does not
  depend on having the same version of the tool.
- Which proof format comes second. Each one needs its own adapter and review.
