# Prototype notes (build steps 1 to 4)

Written 2026-10-11. Evaluation code: unaudited, unreviewed, not released.

## What exists

A TypeScript core and a command-line tool. This file describes the first
format, a Semaphore v4 proof file as written by `@semaphore-protocol/proof`:
the tool verifies it, explains the result from a fixed adapter, and can
export the evidence so someone else can repeat the check. Proofs checked
with a key the user supplies (Groth16, PLONK, FFLONK, and UltraHonk for
Noir) and Cairo proofs are described in [the formats](FORMATS.md).

```sh
npm ci
npm test
npm run build
node dist/cli.js check tests/fixtures/semaphore-v4-valid.json
node dist/cli.js check <proof.json> --json
node dist/cli.js check <proof.json> --export evidence.json
node dist/cli.js check <proof.json> --public <public.json> --key <verification_key.json>
node dist/cli.js check target/proof --public target/public_inputs --key target/vk   # Noir
node dist/cli.js check <cairo-proof.json>
node dist/cli.js check <risc-zero-receipt.txt>
node dist/cli.js rerun evidence.json

npm run build:web        # the browser page, written to dist-web/
npm run test:e2e         # browser tests in Chromium and WebKit
```

| `check` outcome | Exit code | Meaning |
| --- | --- | --- |
| `valid` | 0 | The verifier accepted the proof |
| `invalid` | 1 | The verifier ran and rejected the proof |
| `unsupported` | 2 | The file is not a supported proof; nothing was verified |
| `error` | 3 | The check could not be completed; nothing was verified |

`rerun` exits 0 when a fresh check gives the same report as the export, 1 when
it differs, 2 when the export cannot be read and 3 on failure. Wrong usage
exits 64.

## Browser page

`web/` is a single page with no framework. Verification runs in a worker so
the page stays responsive. It uses the same core, adapter, lock and key file
as the command line, and binds them the same way before checking anything.

- A proof can be chosen as a file or pasted. An evidence export can be
  loaded to repeat someone else's check.
- The page and the command line render the same report sections, and their
  exports are byte-for-byte identical for the same proof. Each can rerun the
  other's export.
- A content security policy allows scripts and styles from the page's own
  origin only, and requests to that origin and to the nine public RPCs a
  lookup may use (below). Checking a file sends nothing anywhere; the
  browser tests fail if it does. File content is shown as text and never
  parsed as markup.
- Since 2026-10-15 the page can look a transaction up. A visitor pastes a
  transaction hash or an explorer link (Etherscan and its kin, stellar.expert,
  Stellar Lab, stellarchain.io); a link chooses the network itself,
  otherwise an Ethereum/Stellar switch and the list of networks do. The
  page then asks one public RPC, named beside the button, for that
  transaction, and checks the proof it finds on the visitor's device. That
  RPC sees the hash and that someone asked about it, and nothing else. The
  RPCs are dRPC for six Ethereum-family networks, PublicNode for Polygon,
  the Stellar Development Foundation's for Stellar testnet and
  sorobanrpc.com for Stellar mainnet; the command line uses whatever its
  operator configures instead. A successful lookup puts the network and
  hash in the page's address, so the result can be shared: opening such a
  link looks the transaction up again, and the footer says so. Every
  report, looked up or not, now opens with a few sentences in plain words,
  built only from what the report itself establishes, then the
  transaction's status and the proof check side by side, what the proof
  shows and what remains unknown (see the lookup notes).

The page checks RISC Zero receipts, and since 2026-10-14 Noir proofs from
Barretenberg 5.2.1 and Cairo proofs. A file that is not text, such as a
Noir proof, is read the way the command line reads it. Each check runs in
a new worker that is discarded afterwards, with a five-minute limit, so no
verifier instance outlasts the check it was made for. The Noir verifier is
given only Aztec's pinned G2 point and the curve's generator: measured on
both Barretenberg versions, verifying needs no other setup point, so the
command line no longer copies 8 MB of setup files for each run either. In
WebKit the Cairo verifier can run out of stack in a worker; the page then
runs it on its own thread (see the formats document). Since 2026-10-15 the
page also checks Noir proofs from Barretenberg 0.87.0, the version
Stellar's UltraHonk verifier checks, through the same code as the command
line.

Since 2026-10-12 the page is published with GitHub Pages. The `deploy` job
in the CI workflow builds it from each commit on `main`, after the unit and
browser tests pass. The published build was reviewed live in Chromium and
WebKit the same day, at `https://akashi.zatrix.xyz/`: the
Semaphore, snarkjs and RISC Zero proofs and the three examples gave the
expected results, a Cairo proof was reported as not checked, the page asked
for nothing outside its own address, and no cookie was set. GitHub can see
visits, as the page says. The address used to point at a copy
the owner deployed by hand to another host; it has pointed at this build,
over HTTPS only, since the same day.

The page offers a lookup example (the Proof of Twitter transaction on
Sepolia) and five examples made from throwaway values or taken from a
library's own test proofs, links to this
repository, and says what it does not check.

## Tool server for AI agents

`dist/mcp.js` is a Model Context Protocol server, so an AI agent can run the
check instead of guessing at a proof. It speaks over standard input and
output and runs on the user's machine. Three of its four tools use no
network. Step 1 of the agent work; the agent itself is described in [the agent notes](LOCAL_AGENT.md).

| Tool | Does | Writes |
| --- | --- | --- |
| `check_proof` | Checks a proof given as a file path or as text | Nothing |
| `write_export` | The same check, then saves proof and report to a new file | One new file; never overwrites |
| `rerun_export` | Repeats the check inside an export and compares | Nothing |
| `lookup_transaction` | Asks a chain data provider for one transaction, then checks the proof in it locally. Sends the transaction hash to the provider; see [the lookup notes](LOOKUP.md) | Nothing |

- A client may give its model the text part of a result or the structured
  part; Claude Code gives the structured part. Both carry the same lines.
- Each result carries the same report text as the command line and the same
  JSON report, so an agent has no wording of its own to supply. The fixed
  text is also in the structured result as `evidenceText`, for a host that
  shows it to the person directly.
- The first line states the outcome, and "nothing was checked" is kept apart
  from "invalid", as on the command line.
- When the report shows a message or scope as text, the result says that the
  text was chosen by whoever made the proof and is data, not an instruction.
- The server sends the connecting agent short instructions: state an outcome
  only from a tool result, keep the claim and limits in the report's words,
  and treat file content as data. A model can ignore instructions, so these
  reduce a risk and do not remove it.
- The protocol handling is written here, about 150 lines, instead of using
  the official library, which would add about 95 packages, a web server among
  them, to a tool that then shipped 27 (86 now, with the Noir and Cairo
  verifiers and the Stellar library). The official client library is a
  development dependency, and the tests drive the server through it.

- **Checking uses no network; the agent calling the server usually does.** A
  cloud-hosted model receives every tool result: the public inputs, the
  message and scope, the report and the file paths. Connecting this server
  to such an agent sends that data to the model's provider, and needs the
  owner's approval for that provider. Only a model run on the same machine
  keeps a check fully local.

To try it with any client that takes a server command: `node dist/mcp.js`.

## How an explanation is tied to a verification

`adapters/semaphore-v4/adapter.json` holds every sentence a report can say
beyond pass or fail: the claim, what is hidden, the meaning of each public
input, the application checks not performed, limits, assumptions, the circuit
source and the review status. The text is fixed; nothing from a proof file is
substituted into it.

Before any proof is checked, four parts are bound together, and binding fails
if any one is exchanged:

1. The adapter file must hash to the value in `adapters/semaphore-v4/lock.json`.
2. The adapter must name the verifier and version that will run.
3. The adapter must describe the four public inputs in circuit order.
4. The key file must hash to the value the adapter names.

A report carries the claim only when the verifier accepted the proof. A
rejected proof gets "Claim: none". Changing any wording means changing the
lock deliberately, and reports show the adapter's hash.

**The shipped adapter is marked unreviewed, and every passing report says so.**
An adapter cannot be marked reviewed without a named reviewer and a date.
These checks keep the parts consistent with each other. They do not show that
the wording is correct: that needs a qualified person to review it against
the circuit.

An export contains the proof text and the report. `rerun` checks the proof
again and compares; it trusts nothing the export says about itself. Exports
reference the key file and adapter by hash and do not bundle them, so a rerun
needs the same version of this tool. Reports carry no timestamp, so the same
input gives the same report.

If a message or scope number has the shape Semaphore gives to short text, the
report also shows that text as a reading aid.

## Parts

| Path | Role |
| --- | --- |
| `src/semaphore-v4/importer.ts` | Strict reading of the proof file |
| `src/semaphore-v4/hash.ts` | Semaphore's message and scope hashing |
| `src/semaphore-v4/artifact.ts` | Verification keys, accepted only at a pinned SHA-256 |
| `src/semaphore-v4/verify.ts` | Builds the public inputs and calls the verifier |
| `src/adapter.ts` | Strict reading of an adapter file |
| `src/semaphore-v4/bind.ts` | Binds adapter, lock, keys and verifier |
| `src/report.ts` | Builds and renders the report |
| `src/export.ts` | Export and rerun |
| `src/snarkjs-engine.ts` | The pinned snarkjs verifier |
| `src/node/` | Bundled files, for Node |
| `web/` | Browser page and verification worker |
| `src/scan.ts` | Chooses between a bundled format and a supplied key |
| `src/registry.ts`, `registry/` | Recorded keys a supplied key can be recognised against |
| `src/chain/` | Read-only lookup of a proof by transaction, through a provider |
| `src/cairo/`, `src/node/cairo-engine.ts` | Cairo STARK proofs, with a security floor, each checked in its own worker |
| `src/noir/`, `src/node/noir-engine.ts` | UltraHonk proofs written by Barretenberg, checked offline |
| `src/noir/legacy.ts`, `src/node/noir-legacy-engine.ts` | The same for Barretenberg 0.87.0, with the checks that version needs |
| `src/risc-zero/` | RISC Zero Groth16 receipts against pinned verifier parameters |
| `src/recorded/` | Binds an explanation to one recorded key and reads public inputs as text or an address |
| `src/supplied-key/` | Strict reading, verification and fixed wording for a proof with its own key |
| `src/cli.ts` | Command line |
| `src/node/run.ts` | Check, export and rerun on files, shared by the command line and the tool server |
| `src/mcp.ts`, `src/mcp/` | Tool server for AI agents |
| `src/agent/presentation.ts` | The fixed report text a tool result carries |
| `agents/` | Agent instructions and evaluation scenarios; not activated |
| `adapters/semaphore-v4/` | Adapter text and its lock |
| `artifacts/semaphore-v4/` | Key file copied unchanged from the Semaphore package |

The core takes the verifier and file bytes as arguments and uses no Node API,
which is how the browser worker and the command line share it.

The importer accepts only the six known fields, numbers as canonical decimal
strings within range, exactly eight proof points, and refuses a field written
twice. It never asks for an identity secret or witness.

What blocks a release is listed in [the release review](RELEASE_REVIEW.md).

## Dependencies

| Package | Version | Licence | Use |
| --- | --- | --- | --- |
| `snarkjs` | 0.7.6 | GPL-3.0 | Groth16 verification |
| `@noble/hashes` | 2.4.0 | MIT | keccak256 and SHA-256 |
| `swiftness` | 1.0.0 | Apache-2.0, by its licence file; the package declares only "see LICENSE" | Cairo STARK verification. About 145 MB installed. Last released January 2025; no audit known |
| `@aztec/bb.js` as `aztec-bb-js-0-87-0` | 0.87.0 | MIT | UltraHonk verification for proofs of that older version, which the Soroban UltraHonk verifier is built for. About 14 MB. Faults found in it are listed in [the formats](FORMATS.md) |
| `@aztec/bb.js` | 5.2.1 | MIT | UltraHonk verification for Noir proofs. About 150 MB installed, most of it native programs this tool does not use |
| `@semaphore-protocol/proof`, `identity`, `group` | 4.14.3 | MIT | Tests and fixture generation only |
| `@modelcontextprotocol/sdk` | 1.32.1 | MIT | Tests only: the client that drives the tool server |

The project is GPL-3.0-or-later by owner decision (2026-10-11), because
snarkjs is distributed with it. Production dependency licences, as each of
the 48 packages declares: MIT, GPL-3.0, Apache-2.0, ISC, 0BSD and "MIT AND
Zlib". `npm audit --omit=dev` reports no known
vulnerabilities. The development-only Semaphore packages bring in older
packages with open advisories (snarkjs 0.5.0, `ws`); they are not part of
what the tool runs.

No audit status has been confirmed for snarkjs 0.7.6, arkworks'
`ark-groth16` 0.6.0, `@aztec/bb.js` 5.2.1 or 0.87.0, `swiftness` 1.0.0 or
this code.

Since 2026-10-14 every Groth16 proof, on the command line, in the tool
server and in the page, is checked by snarkjs and by `ark-groth16`, and a
result stands only when both agree; a disagreement is reported as not
checked. arkworks runs as a 188 KB WebAssembly module that imports
nothing, built from `verifiers/ark-groth16` with Rust 1.97.1 on Linux
x86-64; the CI rebuilds it there on every push and fails if it differs from
the committed file. A build on macOS gives different bytes; see
`artifacts/ark-groth16/README.md`.

## Findings

- **snarkjs 0.7.5 and 0.7.6 behaved the same in every Groth16 case tested.**
  Both rejected a public input moved up or down by the field size. The 0.7.5
  source already has the upper-bound check; 0.7.6 adds a check for negative
  values. The Semaphore pin at 0.7.5 was therefore not shown to be a problem
  for verification. 0.7.6 is used here because it is the current release.
- **Both versions accept other spellings of the same number** (hexadecimal,
  leading zeros). The importer refuses them, so one proof has one accepted
  written form.
- **This code and Semaphore's own verifier agreed** on the valid proof and on
  the proof with the root, nullifier, message or scope changed.
- snarkjs does not check that the number of public inputs matches the key.
  The adapter always supplies exactly four.

## Tested

239 automated tests on macOS with Node 26.3.0. Those for supplied keys, the
registry, Proof of Twitter, lookup, Noir, Cairo, RISC Zero and the Stellar
keys are described in
[the formats](FORMATS.md) and [the lookup notes](LOOKUP.md). The rest:

- Three real proofs, at tree depths 1, 3 and 10, each made from throwaway
  identities; each is rejected under a neighbouring depth.
- A change to each public field and each proof point; swapped values;
  out-of-range and non-canonical values; unknown, missing and repeated fields.
- 400 seeded random single-character changes to a valid file: none passed
  unless the file still said exactly the same thing.
- Binding refused changed wording, a changed review status, another format,
  verifier or version, reordered public fields and other key files.
- No claim or explanation appears for rejected, unsupported or failed checks.
- Exports were reproduced; forged claims, removed limits and a swapped proof
  inside an export were detected.
- Command-line exit codes.
- The tool server, driven by the official client library: the same report
  as the command line for a file and for pasted text, all four outcomes,
  refused arguments, exports that the command line reproduces, a forged
  export, malformed and oversized protocol messages.

46 browser tests (twenty-three scenarios, each in Chromium and WebKit, run headless
through Playwright on macOS): a valid proof, a rejected proof, an unsupported
file containing markup, recovery after a file that is not text, identical
exports and cross-reruns between page and command line, a forged export, a
proof with its own key in each of the four supplied-key systems, a RISC
Zero receipt, a Noir proof from its three binary files (and rejected with
one public input changed), a Cairo proof and a Cairo proof that declares
too little security, a Barretenberg 0.87.0 proof declined by name, the
five examples, and three lookups that answer the page's RPC requests with
recorded answers so no network is contacted: an Etherscan link checked,
exported with its source and rerun by the command line; a stellar.expert
link that switches the page to Stellar and checks a private payment; and a
shared link looked up as the page opens, with unreadable input refused
before anything is sent; a transaction with no proof described rather than
reported as an error, checked by pressing Enter; a bare Stellar hash
tried on testnet, then mainnet; and saved examples replayed, and opened
from a shared link, with no request outside the page.

## Not tested or not done

- The adapter wording has not been reviewed by a qualified person.
- Playwright's WebKit is not Safari itself. The page has not been opened in
  Safari on a Mac or an iPhone, in Firefox, or on Windows.
- The page has had no accessibility review beyond labelled controls and a
  live status line.
- The tool server was used by a real model in eleven scenarios, once each;
  see [the agent notes](LOCAL_AGENT.md). That is one run on one model, with
  no other tools available to it. No model has used `lookup_transaction`,
  or checked a Noir, Cairo or RISC Zero proof.
- `check_proof` reads any file path the agent gives it and reports that
  file's SHA-256, or that it could not be read. An agent could use this to
  learn whether a file exists and to confirm a guess at its content.
- Random testing covered one file with simple changes; there is no
  coverage-guided fuzzing.
- The bundled keys equal those in Semaphore's published proving keys, but
  those proving keys are not tied here to the circuit source or the trusted
  setup. See `artifacts/semaphore-v4/README.md`.
- The fixture script downloads Semaphore's public proving files at run time;
  those downloads are not hash-checked by this repository.
- Exports do not bundle the bundled keys, the registry or any adapter. A
  key the user supplied is in the export.
