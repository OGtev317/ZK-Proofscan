# Proof formats

Written 2026-10-11. The owner asked for the idea to cover as many proof
formats as possible. This file records what is supported, the rule every
format follows, and what each further format would need.

## Four bases for a result

Every `valid` or `invalid` report carries a `basis`, because a pass means
very different things in each case.

| Basis | What the tool has | What a pass says |
| --- | --- | --- |
| `bundled-circuit` | Verification keys pinned by hash, and an explanation written for that one circuit | The circuit's claim, in the adapter's wording |
| `recorded-circuit` | The user's key is an exact match to a recorded key, and an explanation is bound to that key | The circuit's claim, in the adapter's wording, with the key's provenance stated |
| `supplied-key` | Only the key the user gave with the proof | The proof fits that key. No explanation is applied, so nothing about meaning |
| `cairo-program` | A proof about a program known only by its hash; there is no key | A program with that hash ran and wrote that output. Nothing about what the program does |

A supplied key is never used for a bundled format, so it cannot stand in for
the pinned keys. A program reading reports must check `basis` before
treating `valid` as a statement about any claim.

## Supported now

| Format | Basis | Files | Verifier |
| --- | --- | --- | --- |
| Semaphore v4 membership proof | `bundled-circuit` | Proof | snarkjs 0.7.6, Groth16 on BN254 |
| ZK Email "Proof of Twitter" demonstration | `recorded-circuit` | Proof, public inputs, and the published verification key | snarkjs 0.7.6, Groth16 on BN254 |
| snarkjs Groth16 on BN254 or BLS12-381 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| snarkjs PLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| snarkjs FFLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| Cairo STARK proof (Stone prover layout) | `cairo-program` | Proof | `swiftness` 1.0.0. Command line and tool server only |
| Noir (UltraHonk on BN254, written by Barretenberg) | `supplied-key` | `proof`, `public_inputs`, `vk`, all binary | `@aztec/bb.js` 5.2.1. Command line and tool server only |

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
a `starknet` proof); no audit status is confirmed for this version; the
browser page does not check Noir proofs.

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
  Stone version. The browser page does not check Cairo proofs.

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
| RISC Zero receipts | Rust crate; receipts can also be wrapped in Groth16 | Whether the wrapped form can use the verifier already here, and how the program is bound |
| SP1 proofs | Succinct's verifier; offers STARK, Groth16 and PLONK forms | The same |
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
