# Proof formats

Written 2026-10-11. The owner asked for the idea to cover as many proof
formats as possible. This file records what is supported, the rule every
format follows, and what each further format would need.

## Five bases for a result

Every `valid` or `invalid` report carries a `basis`, because a pass means
very different things in each case.

| Basis | What the tool has | What a pass says |
| --- | --- | --- |
| `bundled-circuit` | Verification keys pinned by hash, and an explanation written for that one circuit | The circuit's claim, in the adapter's wording |
| `recorded-circuit` | The user's key is an exact match to a recorded key, and an explanation is bound to that key | The circuit's claim, in the adapter's wording, with the key's provenance stated |
| `supplied-key` | Only the key the user gave with the proof | The proof fits that key. No explanation is applied, so nothing about meaning |
| `cairo-program` | A proof about a program known only by its hash; there is no key | A program with that hash ran and wrote that output. Nothing about what the program does |
| `risc-zero-program` | RISC Zero's verifier parameters pinned by hash; the program is known only by its image ID | A program with that image ID ran and wrote a journal with that hash. Nothing about what the program does or what the journal says |

A supplied key is never used for a bundled format, so it cannot stand in for
the pinned keys. A program reading reports must check `basis` before
treating `valid` as a statement about any claim.

## Supported now

| Format | Basis | Files | Verifier |
| --- | --- | --- | --- |
| Semaphore v4 membership proof | `bundled-circuit` | Proof | snarkjs 0.7.6 and arkworks `ark-groth16` 0.6.0, Groth16 on BN254 |
| ZK Email "Proof of Twitter" demonstration | `recorded-circuit` | Proof, public inputs, and the published verification key | snarkjs 0.7.6 and `ark-groth16` 0.6.0, Groth16 on BN254 |
| snarkjs Groth16 on BN254 or BLS12-381 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 and `ark-groth16` 0.6.0 |
| snarkjs PLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| snarkjs FFLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| Cairo STARK proof (Stone prover layout) | `cairo-program` | Proof | `swiftness` 1.0.0 |
| Noir (UltraHonk on BN254, written by Barretenberg) | `supplied-key` | `proof`, `public_inputs`, `vk`, all binary | `@aztec/bb.js` 5.2.1 |
| Noir, as Barretenberg 0.87.0 wrote it with the Keccak transcript | `supplied-key` | The same three files | `@aztec/bb.js` 0.87.0 |
| RISC Zero Groth16 receipt, verifier parameters 3.0.0 | `risc-zero-program` | One file: three lines of hex | snarkjs 0.7.6 and `ark-groth16` 0.6.0, Groth16 on BN254 |

**Every Groth16 proof is checked twice, since 2026-10-14:** by snarkjs and
by arkworks' `ark-groth16` 0.6.0, two implementations written separately,
in JavaScript and in Rust. A result stands only when both give the same
answer, and the report names both. If they disagree the proof is reported
as not checked, never as passed or failed. arkworks also refuses any
number that is not a field element and any point that is off its curve or
outside its prime-order subgroup, so a proof or key that relies on one
verifier skipping such a check cannot pass. PLONK and FFLONK proofs have
no second verifier here and say so by naming snarkjs alone. arkworks runs
as WebAssembly built from `verifiers/ark-groth16` (see
`artifacts/ark-groth16/README.md`); no audit of `ark-groth16` 0.6.0 was
found. Found while adding it: points written without their third
coordinate, as Semaphore's proofs are, were first refused by the new
encoder, and the disagreement was reported as not checked, as intended.

```sh
node dist/cli.js check proof.json --public public.json --key verification_key.json
```

The browser page and the tool server take the same three files, and exports
carry all three so another person can repeat the check.

A supplied-key report says, in fixed wording that no qualified person has
reviewed: whoever made the proof knew private inputs satisfying the circuit
the key was made for; the tool does not know what that circuit checks; and
the result means something only if the key, or its SHA-256, came from a
source trusted separately from the proof. It lists the public inputs as
numbers with no meaning attached.

### Recognising a supplied key

Every supplied-key report has a "Verification key" section. The key is
looked up in [the key registry](../registry/README.md) by the hash of its
content. A match shows which published key it is and nothing more, so the
section gives one line for each separate question: where the recorded file
came from, how far it is tied to circuit source, whether a maintainer
checked the record, and whether this tool holds an explanation, with that
explanation's own review status. The explanation is not applied to the
report. An unmatched key is reported as not recognised, which is not a
fault.

The registry holds the 32 Semaphore v4 keys, each recorded separately from
the file that holds them all. Its entry is marked as not reviewed by a
maintainer, and the link to circuit source as partly established. The
registry file is pinned by hash in the code, and a changed file is refused.

Tested: a real Semaphore proof written as three snarkjs files is recognised
at its tree depth; the same key in another layout is recognised; a key
differing in one value, including a value the verifier does not read, is
not; a recorded key is still named when the proof fails under it; the
file of all 32 keys is not accepted as a key; a forged export claiming a
reviewed record is noticed; the command line, the tool server and the page
give the same text.

### A recorded key with an explanation: Proof of Twitter

One recorded key has an explanation bound to it: ZK Email's Proof of
Twitter demonstration, at commit `b6d9c2d` of `zkemail/proof-of-twitter`.
It is a demonstration circuit, not a blueprint from ZK Email's registry,
and "ZK Email" in general is not supported.

A report keeps four things apart, as the research asked:

| Check | Where the report states it | For this circuit today |
| --- | --- | --- |
| The mathematics | "Cryptographic verification" | Performed |
| Which circuit, and who reviewed what | "Verification key" and "Explanation" | Key recognised; link to circuit source unconfirmed; record and wording NOT REVIEWED |
| That the email's signing key belongs to the domain | "Checks not performed" | Not performed. Nothing ties the email to X until it is |
| Application rules: presenter, reuse, freshness | "Checks not performed" | Not performed |

The claim is that someone had an email with a valid signature under the
key whose hash is shown, containing "email was meant for @" and the
username shown. It is not that the email came from X, that anyone controls
the account or the mailbox, or that the person is unique. The circuit does
not look at the sender address.

Binding: a lock names the adapter file by hash; the adapter names the
published key file by hash; the registry records that file, names the
adapter for it and holds the key's content hash. With any link exchanged,
binding fails at start. A key differing in any value gets no explanation.

Tested with the proof hard-coded in that repository's own contract test:
it passes; a changed proof number, each changed public input and a
same-shaped different username are rejected with no claim; a different
key, including one differing only where the verifier does not read, gets
no explanation; nine exchanged links refuse to bind; six forged exports
are noticed; the command line, tool server and page agree.

#### Against the qualification gate

The owner's research set six requirements for an evidence package. This
demonstration meets four, and the report states the two gaps.

| Requirement | Proof of Twitter |
| --- | --- |
| 1. Exact identity: blueprint ID, version, framework, configuration | **Not met.** No blueprint ID or version. Identified by repository commit, artifact folder and circuit parameters |
| 2. Public fixture: key, proof and ordered public signals, redistributable | Met. Key published by ZK Email; proof and signals in the MIT-licensed repository's test |
| 3. Source evidence: circuit, dependency and compiler versions, signal mapping, setup provenance | **Partly.** Circuit source, dependency versions and signal order are in the repository. The compiler version used and how the setup was run are not documented |
| 4. Local results: valid passes, altered and mismatched fail | Met |
| 5. Reviewed wording, or explicitly NOT REVIEWED | Explicitly NOT REVIEWED |
| 6. Offline rerun without registry, Gmail, remote proving or chain | Met |

The first choice remains ZK Email's Succinct residency-invite blueprint
(version 3), with the Luma registration example second. Neither could be
qualified on 2026-10-11: the registry's listing and lookup returned errors.
Either would be added as registry and adapter data, with no new code.

A request the owner could send to ZK Email's maintainers (drafted here,
not sent):

> Please provide a version-pinned Circom/Groth16 blueprint with a
> redistributable verification key, a matching public proof and public
> signals, the generated circuit source, dependency versions and setup
> provenance. We need offline verification fixtures only: no private email
> or witness.

"Reproducible" means the same proof verifies again. Proving is randomised,
so a newly made proof has different bytes.

### Noir proofs

Added 2026-10-11 after the owner approved adding verifier libraries. A Noir
program is proved by a backend, and this reads the usual one: UltraHonk
proofs written by Barretenberg. The verifier is Aztec's `@aztec/bb.js`
5.2.1 (MIT), in its WebAssembly build.

```sh
node dist/cli.js check target/proof --public target/public_inputs --key target/vk
```

- **Four ways of making a proof are tried**: `evm`, `evm-no-zk`,
  `noir-recursive` and `noir-recursive-no-zk`. They differ in the hash used
  and in whether the proof hides its witness. The files do not say which
  they are, each is a complete verification, and the report names the one
  that passed. A key serves one hash family, with and without hiding.
- **No network.** The library downloads its setup files on first use. The
  files are instead stored in `artifacts/aztec-crs`, pinned by hash, and a
  test fails if anything is fetched during a check. The package also ships a
  native program that fetches its own files; it is never used.
- **One verification, one instance.** Measured: an instance fed thousands
  of malformed inputs eventually fails with a memory error. Every
  verification therefore runs in a new instance, so no input can affect the
  check of another. It costs about 0.1 s.
- **Unread key bytes are refused.** Measured by flipping every byte of a
  key: the verifier ignores the first 24 bytes of each of a key's three
  opening numbers. A key with anything but zero there is refused. Flipping
  a sample of proof bytes found none that went unnoticed.
- **Files are binary**, so they travel as bytes: the report's hashes are of
  the files' exact bytes, and an export carries them in base64.

Not tested or not done: one tiny circuit; the fixtures were made with
`bb.js`, and files written by the `bb` command-line program were not
tried; proofs are tied to the Barretenberg version, and a proof from
another version may fail here without being wrong; the `starknet` and
rollup variants are not checked (this build of the library refused to make
a `starknet` proof); no audit status is confirmed for this version. The
browser page checks 5.2.1 proofs with the library's browser build, given
its WebAssembly as a file of the page's own. Since 2026-10-15 it checks
0.87.0 proofs the same way: both the page and the command line call
0.87.0 through its in-thread API, which starts no workers of its own. That
API offers the Keccak verifier with hiding but not without, so both are
called by their entry point in the library's WebAssembly
(`acir_verify_ultra_keccak_honk`, `acir_verify_ultra_keccak_zk_honk`), with
the arguments laid out as the library lays them out. Every measured fault
of that version is still refused before it runs, and its tests pass
unchanged through this path. Its 2.5 MB of compressed WebAssembly is
fetched only when a proof of that version is checked.

### Cairo proofs (the Starknet proof system)

Added 2026-10-11. Cairo is the language Starknet runs, and a Cairo proof
shows that a program ran. This reads proofs in the JSON layout of the Stone
prover, with the verifier `swiftness` 1.0.0 (Apache-2.0), a Rust port of
StarkWare's Cairo verifier compiled to WebAssembly.

```sh
node dist/cli.js check proof.json
```

A STARK needs no trusted setup, so there is no key file. The report gives
the program's hash and its output, and says the tool does not know what the
program does. It is **not a statement about Starknet**: it does not show
that anything happened on the network.

- **A security floor of 80 bits, enforced here.** A STARK proof chooses its
  own parameters, and this verifier library accepts whatever a proof
  declares. Without a floor, a proof made with trivial parameters would
  pass. The tool reads the declared figure (queries × log of cosets +
  proof-of-work bits), refuses anything under 80 without running the
  verifier, and prints the figure in every report. 80 is this project's
  choice of a conventional minimum, not a standard anyone set for it.
- **The declared figure cannot be inflated.** Tested: raising any of the
  three numbers in a real 70-bit proof, so that it claims 80 or more, makes
  verification fail, and a true proof fails when its numbers are misstated.
  Each parameter must be named exactly once in the file.
- **Two Stone layouts are tried**, since a file does not say which it is.
- **Each verification runs in its own worker thread**, which is stopped
  afterwards and after two minutes at most.
- **Unread part of the file.** Measured: the verifier reads the proof from
  the file's `annotations` and does not read `proof_hex`. A file with a
  changed `proof_hex` passes. A test pins this.

Tested with two unmodified example proofs from the Swiftness repository: a
96-bit proof passes; a 70-bit proof, which the library itself accepts, is
refused; a changed output, program word, step count or transcript
commitment is not accepted; export and rerun reproduce.

Not tested or not done:

- **The library is the weakest dependency here.** Its last release was in
  January 2025, this tool knows of no audit of it, and its packaged build
  has no downloads to speak of. Treat a pass as weaker evidence than a pass
  from the other verifiers.
- **Stone is the older prover.** StarkWare's newer S-two prover writes a
  different layout, which this does not read. No verifier for it that runs
  in JavaScript was found.
- The security figure is conjectured, not proven, as for STARKs generally.
- No program is recognised by its hash. A registry of known programs would
  be the counterpart of the key registry.
- Proofs fetched from Starknet, facts registered on Ethereum, and storage
  proofs are different things and are not read.
- The package is about 145 MB installed: one build per layout, hash and
  Stone version. The browser page ships every build and fetches only the
  one a proof needs, about 2.5 to 3.5 MB.
- Measured on WebKit: a worker's stack is too small for the verifier with
  some proofs, including the test proof here, while the page's own thread
  is not. The page runs the verifier in its worker and, if that runs out of
  stack, runs it again on the page's own thread. Running out of stack or
  memory is never read as an answer about the proof: before this was found
  it made the verifier's rejection under the other Stone layout show as
  FAILED for a valid proof.
- Each run on the page's own thread loads a fresh copy of the verifier,
  which the browser keeps until the page is closed: measured at about 5 MB
  of memory per run, plus the compiled code. Many Cairo checks in one
  WebKit session use memory that is only returned by reloading the page.

### Stellar: three candidates reviewed on 2026-10-11

The owner forwarded three candidates for proofs used on Stellar and asked
for the libraries to be added. Each was read at a pinned commit. Two needed
no new library. Since 2026-10-14 the tool also reads proofs from Stellar's
test network: `lookup --chain stellar-testnet` reads a call to the
UltraHonk verifier contract and the key that contract stores (see the
lookup notes).

| Candidate | New library | What is built | What is not |
| --- | --- | --- | --- |
| Nethermind Stellar Private Payments (circom, Groth16) | None: snarkjs reads its keys | Its 16 testnet keys are recognised; two real testnet proofs pass | The blocklist pool's circuit is explained (draft, unreviewed); the other 15 are not |
| Nethermind Stellar RISC Zero verifier | None: the seal is a Groth16 proof | Receipts are verified, with a new basis | Nothing says what a program does |
| Soroban UltraHonk verifier (Noir) | `@aztec/bb.js` 0.87.0, beside 5.2.1 | Proofs of the version that verifier is built for are checked | The Stellar verifier itself is Rust and is not run here |

#### Stellar Private Payments keys

`NethermindEth/stellar-private-payments` at commit `ef42a47` publishes 16
Groth16 verification keys for its testnet deployment, in the layout
snarkjs reads. They are copied to `artifacts/stellar-private-payments/` and
recorded in the registry, each as its own entry, so a proof presented with
one is reported as using a known key.

- **Every key was generated locally with no trusted ceremony**, as the
  publisher states. Whoever generated one can make passing proofs of false
  statements. The registry entry says so, and the link to circuit source
  is recorded as unconfirmed.
- The publisher calls the project a work in progress, unaudited, for
  testnet only. Its keys were replaced three times in six weeks; a proof
  for an earlier or later key is reported as an unrecognised key.
- **Explanation, since 2026-10-15, for the blocklist pool's key only**
  (`policy_tx_2_2_B`, `adapters/stellar-private-payments-blocklist`),
  written from the circuit source at commit `ef42a47` and marked NOT
  REVIEWED. It states the mathematical statement alone: for each of two
  inputs, knowledge of a key, amount and blinding value giving the
  nullifier shown, membership of the tree with the root shown for any
  input with a non-zero amount, absence of each input's owner key from the
  blocklist tree with the root shown, knowledge of each output's note,
  distinct nullifiers, conservation of value with the public amount, and
  binding to the external data hash. What the application claims beyond
  that (a known root, unspent nullifiers, the current blocklist, matching
  external data and payment) is the pool contract's check, listed as such
  and not performed here. It also says that a zero-amount input is not
  checked against the tree, and that a blocklist root of 0 is the empty
  tree, as in both real testnet proofs. The Merkle, sparse Merkle and
  Poseidon2 circuits it includes were not read. The other fifteen keys
  have no explanation.
- Found while adding it: a rejected proof under a key with an explanation
  was recorded as having that explanation "applied", though nothing from
  it was used. That is now said only of a proof that passed; the same
  applied to Proof of Twitter.
- **Real proofs, since 2026-10-14.** The repository holds no test proof,
  but `lookup --chain stellar-testnet` reads the deployed pools' `transact`
  calls, and the two found on testnet that day pass under `policy_tx_2_2_B`.
  The public inputs are put in the order the pool's code passes them,
  read at commit `0471e6b`; a later change to that order would make real
  proofs fail here without being wrong. No proof has passed under the
  other fifteen keys.
- Found on the way: the keys were refused at first, because they leave out
  `vk_alphabeta_12`. The verifier does not read that value and only snarkjs
  writes it, so a Groth16 key may now come with or without it.

#### RISC Zero receipts

A RISC Zero Groth16 receipt is a 260-byte seal, the image ID of the program
and the journal the program wrote. The seal is a Groth16 proof with five
public inputs, so snarkjs verifies it. The file read here is the one
Nethermind's guide has a prover write: three lines of lower-case hex, the
seal, the image ID and the SHA-256 of the journal.

```sh
node dist/cli.js check proof.txt
```

- The verifier parameters (key, control root, control ID) are pinned by
  hash in `artifacts/risc-zero-groth16/`. They are Nethermind's file byte
  for byte, and all 26 key numbers, the control root and the control ID
  equal RISC Zero's own Ethereum contracts at `v3.0.0`
  (`scripts/check-risc-zero-parameters.mjs`). These parameters are not
  specific to Stellar.
- Only seals that begin with the selector `73c457ba`, version 3.0.0, are
  checked. Any other is reported as not checked.
- The statement a seal is checked against is built here from the image ID
  and journal hash, in the layout RISC Zero's contracts use: the program
  ran with no declared input, stopped normally with exit code zero, and
  relies on no other unproven receipt. That layout is fixed-width, and the
  real receipt passes only if it is right.
- The report does not see the journal, only its hash.
- **One real receipt was available**, from Nethermind's contract tests. A
  changed seal, image ID or journal hash is rejected.
- Works on the command line, the page and the tool server.

#### Barretenberg 0.87.0, for the Soroban UltraHonk verifier

`NethermindEth/rs-soroban-ultrahonk` verifies Noir proofs made with
Barretenberg 0.87.0 and the Keccak transcript, without hiding. Version
5.2.1 does not read those proofs or keys, so `@aztec/bb.js` 0.87.0 is
installed beside it under the name `aztec-bb-js-0-87-0`. A key says which
version wrote it: an 0.87.0 key is 1,760 bytes and opens with the circuit
size, where a 5.2.1 key opens with 24 zero bytes.

Proofs with the Keccak transcript are checked, with or without hiding. The
version's default transcript and its Starknet one are not; such a proof is
reported as not checked.

**This is an old verifier, and testing it found faults that the current one
does not have.** Each is pinned in a test as the library behaves, and each
is refused by this tool before the verifier runs:

| Measured on 0.87.0 | What this tool does |
| --- | --- |
| A key whose points are all zero accepts an all-zero proof, for any public inputs | A key holding a point at infinity is not read. The key of the real circuit examined holds none |
| A number in a proof written as itself plus the field size still verifies | Every 32-byte value of a proof must be inside the field |
| The last point of a proof still verifies with its halves split another way, or with unread high bytes set | The last point must be written the one way a prover writes it |
| The key's opening numbers are not compared with each other, and four bytes are not read | Circuit size, its logarithm and the public-input count must agree |

Every byte of a proof without hiding and of one with hiding was changed in
turn, and every byte of a key: no other single change was accepted. The
same sweep of a 5.2.1 proof of the `evm` kind found no accepted change at
all; the other three kinds were not swept in full.

What this does not give:

- **A pass is not the Stellar verifier's answer.** That verifier is
  separate Rust code with stricter rules, audited by OpenZeppelin in August
  2026 according to its repository. It is not run here.
- Fixes made to Barretenberg after 0.87.0 are not in it. No audit status is
  confirmed for this version of `@aztec/bb.js`.
- The setup points are given to the library directly: the generator, and
  the same pinned second-group point 5.2.1 uses. Its own downloader is
  never called, and a test fails if anything is fetched.
- Fixtures were made with the library's JavaScript interface, not the `bb`
  program. Making them downloads setup points; checking does not. The
  fixture without hiding was also accepted by Nethermind's verifier, run
  locally from its source at commit `9aae958` on 2026-10-12, so the two
  agree on that one real proof. The fixture with hiding is a kind that
  verifier does not check. Two real proofs that the deployed contract
  accepted on Stellar's test network on 2026-10-14 also pass here.
- The guard against keys with a point at infinity is a judgement from one
  real key. A real circuit whose key holds such a point would be reported
  as not checked, not as invalid.

### How the three files are read

- Each file must be JSON that can be read only one way: no escapes, no
  repeated field, numbers written plainly. The test is that writing the
  parsed value back gives the same text apart from spacing.
- A proof and a key must have exactly the fields of their proof system.
- Every number must be a plain decimal inside its field, so a value and
  the same value plus the field size are never both accepted.
- Proof, key and public inputs must agree on the proof system, the curve
  and the number of public inputs. snarkjs does not itself compare the
  number of Groth16 public inputs with the key.

### Measured: values the verifier does not read

Changing each number in each real proof and key, one at a time, showed that
snarkjs 0.7.6 ignores three things. Tests pin all three, so a verifier
version that behaves differently fails a test.

| Where | Value | Consequence |
| --- | --- | --- |
| FFLONK proof | `evaluations.inv` | A proof with any `inv` passes here. A verifier that uses `inv`, such as the Solidity contract snarkjs generates, may reject it. FFLONK reports say so. Not tested against a contract |
| Groth16 key | `vk_alphabeta_12` | Two key files differing only there verify the same and have different SHA-256 |
| PLONK key | `w` | The same |

The two key cases err on the safe side for someone comparing a key's
SHA-256 with a trusted one: a changed file does not match.

### Tested

Real proofs for a small multiplication circuit in all four systems, made by
`scripts/make-snarkjs-fixtures.mjs` from setups created and discarded on
this machine (it needs the `circom` compiler). Each proof passes; a changed
public input is rejected; other spellings of a number, a wrong count,
repeated or extra fields, another system's key and a reordered key are
refused or rejected; 300 seeded random one-character changes gave no false
pass. Exports reproduce on the command line and in Chromium and WebKit, and
the page and command line write identical exports. The BLS12-381 field
sizes equal the verifier's own.

### Not tested or not done

- One tiny circuit with two public inputs. No large key, no circuit with
  zero public inputs, no proof made by another prover such as rapidsnark.
- PLONK and FFLONK in snarkjs have had less scrutiny than Groth16. No audit
  status is confirmed for any of the three in 0.7.6.
- Whether snarkjs checks that points lie in the right subgroup was not
  examined, for either curve.
- The supplied-key wording has had no qualified review.
- An AI agent was run once on two supplied-key scenarios and one
  email-proof scenario (see [the agent notes](LOCAL_AGENT.md)); that is not
  a measure of reliability.
- For Proof of Twitter: the circuit was not compiled, the proving key was
  not examined, and the email-verification library the circuit includes was
  not read. Checking the signing key against a domain's published keys is
  not built; it would need a network lookup, which is out of this milestone.

## What comes next, and what each needs

Nothing below is built. Library names, licences and maintenance status in
this section are from memory and **have not been checked**; each needs
checking before any decision.

### A. More known circuits on the verifier already here

The largest gain for the least new risk. Most deployed privacy proofs are
Groth16 or PLONK over circom, which snarkjs already verifies. Each known
circuit needs its published verification key pinned by hash, an adapter
with the claim, limits and application checks, and a qualified person to
review that wording. No new dependency.

The key registry is the first step and is built (see above). Its entries
still need a maintainer's review of their provenance.

**Direction taken on 2026-10-11**, from a research note the owner forwarded
and asked to be acted on: the next adapter is one pinned ZK Email blueprint,
not "ZK Email" in general, because each blueprint compiles to its own
circuit, key and public-input layout. Before any code it needs a published
blueprint and key to pin, and public test proofs that can be reproduced.
Its report must separate "a confirmation email with these properties
existed" from attendance, current ownership or control of the inbox.
Verification stays offline for this milestone, and no second verifier
library is added until a specific customer artifact calls for one.

The note also reported, and this repository has not checked: World ID is
moving off its Semaphore v3 system; Zupass is several proof types, not one;
Sui zkLogin needs checks beyond the proof (provider keys, ephemeral
signature, expiry). Those make Semaphore v3 and zkLogin later candidates.
Others: Anon Aadhaar, iden3 / Privado ID credential circuits, Rate-Limiting
Nullifier, MACI.

### B. Other proof systems

Each needs an established verifier that runs in Node and a browser, a
decision to add it as a dependency, a licence check against GPL-3.0, and
its own fixtures and input rules. This project does not write verifiers.

| System | Likely verifier | Open questions |
| --- | --- | --- |
| gnark Groth16 and PLONK | None known in JavaScript | Proof encoding differs from snarkjs; converting it is new code that needs review |
| RISC Zero receipts not wrapped in Groth16, or other parameter versions | Rust crate | Groth16 receipts for parameters 3.0.0 are read; these are not |
| SP1 proofs | Succinct's verifier; offers STARK, Groth16 and PLONK forms | Whether a wrapped form can use the verifier already here, and how the program is bound |
| Halo2 | No standard one | Proof layout is specific to each application |
| Cairo proofs from the S-two prover | None found for JavaScript | Stone-layout proofs are read; these are not |
| Bulletproofs range proofs | Rust `bulletproofs` | Not circuit proofs; the report shape needs thought |

### C. Privacy-preserving credentials that are not circuit proofs

BBS selective-disclosure signatures, SD-JWT, AnonCreds and TLSNotary
presentations fit the same report (claim, hidden, public, verification,
limits) but are signatures and protocols, not zero-knowledge circuits. They
need their own design note before any code.

## Decisions for the owner

1. Who reviews the explanation wording, and which maintainer reviews the
   registry entry.
2. Whether to send the request to ZK Email's maintainers above, and whether
   Proof of Twitter stays once a registry blueprint can be pinned.
3. Whether section C belongs in this product or a later one.

Finding a proof by its transaction is built; see [the lookup notes](LOOKUP.md).
Asking a chain about state (is a root accepted, was a nullifier used) is out
of this milestone. If added later it must name the provider, chain, contract, block
and query, be kept apart from local verification, and never turn "unused at
block B" into "cannot be replayed".
