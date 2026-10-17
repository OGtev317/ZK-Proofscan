# LumenLenz integrations

Experimental and unaudited. No qualified review of these explanations is recorded.
These integrations do not connect wallets, sign, simulate, submit transactions,
recover private witnesses, or authorize a transaction. A local review is not a safety verdict.

## Display a report in any frontend

The `lumenlenz/browser` and `lumenlenz/review` subpaths are in version 0.2.0 and
later (`npm install lumenlenz`; Node >=22.12). Version 0.1.0 does not have them.

```ts
import { defineLumenLenzReport } from 'lumenlenz/browser';
import type { LumenLenzReportElement } from 'lumenlenz/browser';
defineLumenLenzReport(); // call in the browser, not during server rendering
const card = document.createElement('lumenlenz-report') as LumenLenzReportElement;
document.querySelector('#report')!.append(card);
card.result = { report, source, facts }; // from a checker you trust
// Or: card.result = { facts }; for a transaction with no supported proof.
// Clear stale state whenever the selected transaction changes:
card.clear();
```

This is a display-only custom element (~15 kB uncompressed). It makes no network
requests, accesses no storage, invokes no wallets, and renders outside text using
`textContent`. Importing the module is safe during SSR; registration requires a DOM.
It uses light DOM, inherits your CSS and adds no inline styles. The result is
supplied by the host, not verified by the component. It is mutable in-memory data,
not an attestation. Untrusted reports must never control a signing decision.

The `/integrations/` demo runs the existing checker separately in a worker against
saved provider answers, then feeds the resulting report to this component. Its CSP
permits same-origin fetches only. Clearing the report cancels the worker; it clears
on page exit too. A captured provider answer remains provider-reported evidence,
not a newly authenticated view of the network.

## Scaffold Stellar, Freighter and Stellar Wallets Kit

Copy `examples/scaffold-stellar/review.ts` into an existing Scaffold Stellar frontend
after installing the locally packed build. It is a framework-neutral TypeScript
adapter: present `review.preview` and its warning, and require a user acknowledgement.
Its callback returns false if the exact envelope or explicit network changed while
the review dialog was open. A React app can call it from an event handler; render
the report element with a ref/effect after mounting. Never register custom elements
or access `document` in a server-rendering phase.

`prepareWalletReview(xdr, network)` accepts only canonical unsigned envelopes with
no embedded authorization signatures, including V2/delegated credentials. It
returns a bounded structural inspection and a digest of the *whole* envelope.
`matchesWalletReview(ticket, currentXdr, currentNetwork)` detects any change,
including appended signatures that would not change the transaction hash.

This is an integration point **before the host application's existing, separately
approved wallet flow**, not a Freighter/Wallets Kit provider or signing wrapper.
Neither wallet library is loaded or invoked here. Tickets are forgeable ordinary JS
objects and confer no authority; do not persist them, expose sensitive XDR in URLs,
or treat a true return value as approval to move funds. Re-review after simulation,
fee/sequence changes, authorization changes, or transaction rebuilding by the host.

## Stellar Lab

The root page's Before you sign panel imports a base64 `.xdr`/`.txt` envelope file
up to 256 KiB, entirely locally. Network must be selected explicitly. Editing the
input or network clears the previous inspection. A manual Lab link contains **no
XDR**; nothing is sent to Lab, put in query parameters or saved in browser storage.
In [Stellar Lab](https://lab.stellar.org/), choose XDR to JSON and paste manually if
you want an independent view. This does not imply Lab verified the transaction.

## Soroswap deployment adapter and a real mainnet fixture

The decoder requires a matching call/interface, successful router event, and
consistent recorded transfers. It additionally labels `published-address-and-code`
only for the exact mainnet router **and** hash-bound WASM hash from the pinned
[Soroswap deployment manifest](https://github.com/soroswap/core/blob/6eade008ee6794075ad941609e0fef0d1124d3eb/public/mainnet.contracts.json).
Wrong network/address/code does not receive that label. The manifest is a published
identity reference, not a security audit or economic guarantee. Runtime execution
and current code still come from an RPC provider; this is not historical-state or
consensus verification. Deployments may change, so update the pin only after review.

Saved public mainnet transaction:
`203d14cb109f442a96e26a5bba9a2c5b8aa5770dabe29e0b5f46e310a2003e3a`,
ledger 64962309. Recorded transfer amounts are 1000000 and 927076 base units.
`tests/fixtures/stellar-mainnet/soroswap.json` replays through the real lookup path
without network access. It contains no ZK proof. No trade was made to create it.
`scripts/capture-soroswap.mjs` is an explicit read-only recapture tool and refuses
to overwrite its fixture. It is not run by builds, tests or CI.

The [Soroswap SDK](https://github.com/soroswap/sdk) may supply a router address to
a host application. An address or quote alone is never identity evidence for this
decoder. No Soroswap quote API, API credential, SDK trading methods or fee service
has been integrated; the small deployment adapter avoids those dependencies.

## OpenZeppelin-compatible contract control events

Control-event explanations use the emitter's interface read from hash-bound WASM,
successful committed events, exact field names/counts, and expected runtime types.
Layouts are pinned to [OpenZeppelin Stellar Contracts](https://github.com/OpenZeppelin/stellar-contracts/tree/33b665bccb4f38c54f1bb3c5700d950b76e32e0b/packages).
Coverage: RoleGranted, RoleRevoked, RoleAdminChanged, AdminTransferCompleted,
OwnershipTransferCompleted, OwnershipRenounced, Paused and Unpaused.
Unknown or mismatched layouts remain generic events. Decoding is bounded by the
lookup's existing 3-contract/10-other-event limits, not a complete control history.
Upgrade execution, pending transfer semantics, audit identity and current role
membership are not established. Tests use synthetic emitted events; no real
OpenZeppelin deployment has been certified. A contract can copy these interfaces:
the label is always **compatible**, never “audited”, “authorized”, or “safe”.

## Reusable GitHub Actions check

Pin the action to the reviewed **40-character commit SHA containing this file**:

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@v5
  - uses: OGtev317/ZK-Proofscan/.github/actions/lumenlenz-check@<PINNED_COMMIT_SHA>
    with:
      fixture: tests/public-proof.json
      public-fixture: 'true'
      mode: proof
      expected: valid
```

Replace the placeholder; it is not a release tag. The action installs/builds its
own pinned source with npm lifecycle scripts disabled during installation. Use
normal pull_request workflows, not pull_request_target with untrusted checkout.
Installation downloads dependencies; the check itself is offline. Runner inputs
are environment values, never interpolated into shell commands. Fixtures must be
regular files <=5 MB whose resolved real paths stay inside the caller workspace;
absolute paths and escaping symlinks are refused. Logs contain fixed outcome
labels, not raw reports, XDR, proofs or user paths. Do not pass secrets or private
witnesses. Public inputs / verification key files may be passed together with
`public-inputs` and `verification-key` (public keys only).

For unsigned structural inspection use `mode: inspect`, `expected: inspected`, and
explicit `network: stellar-testnet` or `stellar-mainnet`. Signed envelopes and
embedded auth signatures are refused. Success means parseable unsigned structure,
not a safety check, proof verdict, valid signature, fresh sequence, or permission
to submit. Only proof mode supports expected valid/invalid/unsupported/error.
Checking a valid proof with an unknown key says nothing about circuit trust.

## SDK migration boundary

This source moves from deprecated standalone `@stellar/stellar-base` to
`@stellar/stellar-sdk` **16.3.1**, preserving the accessor-based XDR API while adding
V2/delegated auth inspection. It is not the newest SDK major: 17.x requires a
separate whole-codebase XDR representation migration. Axios is overridden to
1.20.0 to avoid advisories in 16.x's dependency range. Production dependencies pass
the current audit; development dependencies still have known advisories. That is
not an audit of LumenLenz or its contracts.

No simulation or built-in secondary archive provider has been reintroduced.
No npm publication, external review, partnership, wallet action or contract
deployment is part of this integration work.
