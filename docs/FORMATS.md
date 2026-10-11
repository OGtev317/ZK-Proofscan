# Proof formats

Written 2026-10-11. The owner asked for the idea to cover as many proof
formats as possible. This file records what is supported, the rule every
format follows, and what each further format would need.

## Two bases for a result

Every `valid` or `invalid` report carries a `basis`, because a pass means
very different things in the two cases.

| Basis | What the tool has | What a pass says |
| --- | --- | --- |
| `bundled-circuit` | Verification keys pinned by hash, and an explanation written for that one circuit | The circuit's claim, in the adapter's wording |
| `supplied-key` | Only the key the user gave with the proof | The proof fits that key. The circuit is unknown, so nothing about meaning |

A supplied key is never used for a bundled format, so it cannot stand in for
the pinned keys. A program reading reports must check `basis` before
treating `valid` as a statement about any claim.

## Supported now

| Format | Basis | Files | Verifier |
| --- | --- | --- | --- |
| Semaphore v4 membership proof | `bundled-circuit` | Proof | snarkjs 0.7.6, Groth16 on BN254 |
| snarkjs Groth16 on BN254 or BLS12-381 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| snarkjs PLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |
| snarkjs FFLONK on BN254 | `supplied-key` | Proof, public inputs, verification key | snarkjs 0.7.6 |

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
- An AI agent was run once on two supplied-key scenarios (see
  [the agent notes](LOCAL_AGENT.md)); that is not a measure of reliability.

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
| Noir | Depends on the proving backend; the language does not fix a format | Which backend the customer's proofs use |
| gnark Groth16 and PLONK | None known in JavaScript | Proof encoding differs from snarkjs; converting it is new code that needs review |
| RISC Zero receipts | Rust crate; receipts can also be wrapped in Groth16 | Whether the wrapped form can use the verifier already here, and how the program is bound |
| SP1 proofs | Succinct's verifier; offers STARK, Groth16 and PLONK forms | The same |
| Halo2 | No standard one | Proof layout is specific to each application |
| Cairo / STARK proofs | Rust verifiers | The same as RISC Zero |
| Bulletproofs range proofs | Rust `bulletproofs` | Not circuit proofs; the report shape needs thought |

### C. Privacy-preserving credentials that are not circuit proofs

BBS selective-disclosure signatures, SD-JWT, AnonCreds and TLSNotary
presentations fit the same report (claim, hidden, public, verification,
limits) but are signatures and protocols, not zero-knowledge circuits. They
need their own design note before any code.

## Decisions for the owner

1. Who reviews the explanation wording, and which maintainer reviews the
   registry entry.
2. Which ZK Email blueprint to pin, once candidates are researched.
3. Whether section C belongs in this product or a later one.

A chain lookup (is a root accepted, was a nullifier used) is out of this
milestone. If added later it must name the provider, chain, contract, block
and query, be kept apart from local verification, and never turn "unused at
block B" into "cannot be replayed".
