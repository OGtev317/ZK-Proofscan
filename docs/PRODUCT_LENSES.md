# Product lenses

Added 2026-10-15. On the page since then; not yet in an npm release. No
wallet, signing, or submission. Two parts of the first draft were removed by
the owner's decision before release: an archive provider built into the page,
and simulation of unsigned transactions.

## 1. Transaction story

Stellar transaction results now carry JSON-safe structured movements beside
the existing sentences. Ethereum results have none yet, so the page shows no
story for them, and `transactionStory` gives an Ethereum transaction its action
and any allowance sentences rather than a count of decoded movements. The page shows assets and amounts, a movement flow
with expandable full addresses, fee charged, contracts, spending permissions,
and limits. `transactionStory(facts)` exposes the same view to developers.
Failed transactions never display requested token effects as committed.
The story is not a complete wallet balance calculation. Missing/truncated
events are labelled. A proof does not reveal its private witness.

## 2. Swap decoder

One deliberately narrow adapter: direct, two-token Soroswap-compatible
`swap_exact_tokens_for_tokens` / `swap_tokens_for_exact_tokens` calls.
It requires all of the following:

- A called contract's hash-bound code and self-declared function interface.
- A matching `SoroswapRouter` / `swap` committed event from that contract.
- Matching path, recipient, input/output limits, and positive amounts.
- Exact matching token transfer events, through the same pool, from/to the
  router call's recipient. Failed/truncated/ambiguous data is refused.

The decoder labels the format **Soroswap-compatible**, never an official
deployment or an independently authenticated execution. Contracts can copy
interfaces and events; token labels can be false. Multi-hop swaps, exchange
rate correctness and economic guarantees are not supported. Positive and
adversarial tests use synthetic public data, not an independently confirmed
live Soroswap transaction. No deployment allowlist is invented.

Source read and pinned for the format:
[router events](https://github.com/soroswap/core/blob/6eade008ee6794075ad941609e0fef0d1124d3eb/contracts/router/src/event.rs),
[router calls](https://github.com/soroswap/core/blob/6eade008ee6794075ad941609e0fef0d1124d3eb/contracts/router/src/lib.rs).

## 3. Availability, and an archive provider the operator chooses

Live Stellar lookups now query `getHealth` and display a validated,
provider-reported ledger retention range. `NOT_FOUND` is not an invalid proof,
and a hash alone cannot establish that a transaction expired from retention.
Network checks and local transaction-hash checks remain in effect.

The page asks no provider beyond those it already names. On the command line
the operator can name a second provider to try when the first has no record
of the transaction or does not answer:

```sh
STELLAR_ARCHIVE_RPC_URL=https://operator-chosen-testnet-provider.example
STELLAR_MAINNET_ARCHIVE_RPC_URL=https://operator-chosen-mainnet-provider.example
```

The entire lookup is repeated against the fallback: no mixing one provider's
envelope with another's storage, events or keys. Each attempt is reported.
Never put credential-bearing provider URLs in public output.

**Important:** [Stellar's provider directory](https://developers.stellar.org/docs/data/apis/rpc/providers)
says archive support may apply only to `getLedgers`. It does not guarantee
`getTransaction(hash)` or historical contract/key storage. This implementation
tries the explicitly chosen provider without claiming those guarantees.

## 4. Proof profiles and directory

The page's circuit directory is derived from the existing SHA-256-pinned
registry, loaded only when opened. A checked proof gets a profile with its
known purpose (if any), public-input meanings, verifier/version, limits,
registry-entry review, explanation review, and deployment/code hash where
available. The SDK exports `proofProfile` and `circuitDirectory`.

No registry entry, explanation, security audit, or deployment was promoted to
reviewed by this work. An actual qualified review still requires a person.
Missing reviewer/date never produces a reviewed label. Even a recorded
review is distinguished from authentication of reviewer qualifications.
Invalid proofs do not get a successful claim; unknown circuits stay unknown.

## 5. Before you sign

Local inspection accepts a bounded, canonical, base64 Stellar transaction
envelope, with an explicitly selected testnet/mainnet passphrase. XDR itself
does not identify the network. It shows requested operations, account/fee
payer, maximum fee in stroops, signature presence, and bounded nested
authorization trees. Other operation kinds remain explicitly undecoded.
No transaction is written to browser storage, URL parameters or an export,
and nothing is sent anywhere: there is no simulation, on the page, the
command line or in the library.

```sh
lumenlenz inspect unsigned.xdr --chain stellar-testnet
lumenlenz inspect unsigned.xdr --chain stellar-testnet --json
```

SDK: `inspectStellarTransaction(xdrText, network)`, offline. No new verifier
library, provider subscription or hosted server.

Primary references:
[getHealth](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth),
[getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction).

## Validation and boundaries

Unit tests cover stories, positive/negative swap evidence, retention-window
validation, fallback provenance/error redaction, unsigned inspection,
signature notices, authorization recursion and profile review boundaries.
Browser tests cover offline inspection, saved proof stories/profiles, the pinned directory and mobile width,
on Chromium and WebKit. Existing proof verification/export tests still run.
The package's existing production-dependency audit and packaging check also
run. No real swap, qualified review, phone-device
validation, deployment, push or npm publication is implied by these tests.

The first draft passed type checking, 304 unit tests and 74 browser tests on
2026-10-15. A review then found that the story said "0 decoded spending
permissions" for an Ethereum transaction granting an unlimited allowance; it
was fixed, with a test, before release.
