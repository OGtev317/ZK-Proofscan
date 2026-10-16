# Product lenses (development branch)

Implemented in a separate worktree on 2026-10-15, based on `fdb0525`.
Not a deployment or a new npm release. No wallet, signing, or submission.

## 1. Transaction story

Stellar transaction results now carry JSON-safe structured movements beside
the existing sentences. The page shows assets and amounts, a movement flow
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

## 3. Availability and optional archive fallback

Live Stellar lookups now query `getHealth` and display a validated,
provider-reported ledger retention range. `NOT_FOUND` is not an invalid proof,
and a hash alone cannot establish that a transaction expired from retention.
Network checks and local transaction-hash checks remain in effect.

On the page an unchecked-by-default control permits a fallback to
`archive-rpc.lightsail.network` for mainnet only. The hash is sent there only
after consent and a missing/unavailable primary response. Saved examples
remain completely offline. For the CLI/library, the operator can configure:

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
An actual read-only `getHealth` request on 2026-10-15 to the public Lightsail
archive returned a healthy status with a 64-ledger live retention window;
that does not measure its full historical capabilities. No historical
transaction recovery is claimed from that check.

## 5. Proof profiles and directory

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

## 6. Before you sign

Local inspection accepts a bounded, canonical, base64 Stellar transaction
envelope, with an explicitly selected testnet/mainnet passphrase. XDR itself
does not identify the network. It shows requested operations, account/fee
payer, maximum fee in stroops, signature presence, and bounded nested
authorization trees. Other operation kinds remain explicitly undecoded.
No transaction is written to browser storage, URL parameters or an export.

Simulation is a separate, consent-gated action. It sends the complete unsigned
public transaction to the selected provider using `simulateTransaction` with
`authMode: record`. The provider/network is checked first. Signed envelopes
and embedded authorization signatures are refused before any RPC request.
Only one unsigned Soroban operation is supported for simulation; fee bumps
and classic transactions remain inspect-only.

The result is a **prediction**, not execution: provider, ledger, estimated
minimum resource fee (additional to inclusion fees), predicted authorization
trees, and up to 20 predicted ledger-entry change keys. State values and
balance deltas are not interpreted. Signature authorization is not enforced
in recording mode. State can change before execution. No proof, signature,
economic outcome or transaction safety is guaranteed.

```sh
lumenlenz inspect unsigned.xdr --chain stellar-testnet
lumenlenz inspect unsigned.xdr --chain stellar-testnet --json
# Explicit consent to send the unsigned XDR to the selected provider:
lumenlenz inspect unsigned.xdr --chain stellar-testnet --simulate
```

SDK: `inspectStellarTransaction(xdrText, network)` is offline;
`simulateStellarTransaction(xdrText, network, rpcClient)` is explicit online
simulation. No new verifier library, provider subscription or hosted server.

Primary references:
[getHealth](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getHealth),
[getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction),
[simulateTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/simulateTransaction).

## Validation and boundaries

Unit tests cover stories, positive/negative swap evidence, retention-window
validation, fallback provenance/error redaction, unsigned inspection,
signature refusal, authorization recursion, simulation output and profile
review boundaries. Browser tests cover offline/consent behavior, archive
opt-in, saved proof stories/profiles, the pinned directory and mobile width,
on Chromium and WebKit. Existing proof verification/export tests still run.
The package's existing production-dependency audit and packaging check also
run. No real swap, production simulation, qualified review, phone-device
validation, deployment, push or npm publication is implied by these tests.

Validated 2026-10-15: type checking; 304 unit tests; the complete 74-test
Chromium/WebKit suite, followed by a 14-test rerun of the feature suite after
the final story-copy adjustment; production browser build; fresh-install
`release:check -- --quick`; production audit (0 vulnerabilities); and
`git diff --check`. The local transaction-story page was also inspected
visually. Development-tool dependency advisories from `npm ci` were not
fixed by changing the dependency tree in this feature branch.
