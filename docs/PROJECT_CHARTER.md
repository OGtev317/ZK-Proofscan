# ZK-Proofscan project charter

Created 2026-10-11. **Proposed direction, not settled requirements.** The idea
was supplied by the owner. Nothing here is implemented, specified or approved
for release.

## The idea

A zero-knowledge proof is normally shown as an opaque value and the word
"Verified". That tells a reader nothing about what was proved. ZK-Proofscan
would take a supported proof and produce an evidence report a non-specialist
can read and a specialist can re-check.

The owner's example, for a group-membership proof:

> **Claim:** The prover controls a credential included in this membership list.
> **Hidden:** Which member they are.
> **Public:** The group reference and other public inputs.
> **Verification:** The proof passed the specified verifier.
> **Limits:** This does not establish unique personhood or whether membership
> was granted fairly.

## What a report is made of

| Section | Where the content comes from |
| --- | --- |
| Claim | A reviewed description of the circuit, selected by its verifying key |
| Hidden | The same description: the circuit's private inputs |
| Public | The proof's public inputs, labelled by the description |
| Verification | Running an established verifier locally on the supplied files |
| Limits | The description, plus anything this tool did not check |

Only the Verification section is computed from the proof. Everything else
depends on knowing which circuit the verifying key belongs to. The core of the
product is therefore a **registry of circuit descriptions**: for each supported
circuit, its source, how to reproduce the verifying key from that source, a
plain-language statement, the meaning of each public input, known limits, and
who reviewed it. A proof whose verifying key is not in the registry gets a
report that says the proof is valid for an unknown statement.

"Checkable" means a reader can repeat the work: the report names the verifier
library and version, identifies the verifying key by hash, and lists the exact
public inputs, so the same files give the same result elsewhere.

## Claims that need care

1. **A proof does not carry its own meaning.** The plain-language claim is only
   as good as the review of the circuit behind it. If the description is wrong,
   the report is wrong while still saying "verified".
2. **Circuits can enforce less than they appear to.** Under-constrained
   circuits are a common fault: the proof passes without the intended statement
   holding. A report can state who reviewed a circuit; it cannot certify that
   the circuit is sound.
3. **A valid proof is about its public inputs, not the world.** A membership
   proof is relative to a group root. Whether that root is the real, current
   list is a separate check. Unless the tool performs it, the report must say
   it was not performed.
4. **Verification rests on assumptions.** These include the proof system's
   security, any trusted setup behind the verifying key, and the verifier
   library. The report should name them, not hide them behind a green tick.
5. **Reports can leak.** Public inputs such as nullifiers and external
   identifiers can link a person's proofs together. Publishing or storing
   reports needs a privacy decision first.
6. **No private inputs.** The tool must work from the proof, public inputs and
   verifying key only, and must never ask for a witness.
7. **Not an audit.** A report is a structured reading of one proof. It must not
   be presented as an audit or certification of a protocol.

## Proposed first version

Proposed, not decided:

- One proof system and one circuit family, chosen to match the example:
  Groth16 membership proofs of the Semaphore kind.
- A library and command-line tool that reads a proof, public inputs and
  verifying key from files, verifies offline, and writes a report as JSON and
  as readable text.
- A registry of circuit descriptions kept in this repository.
- No network access, no chain lookups, no hosted service.

## Open decisions for the owner

1. Is the first deliverable a written report specification with one worked
   example?
2. Which proof system and circuit first? Recommendation: Groth16, Semaphore.
3. Form: library and command line first, or a web page first?
4. Language and verifier library. The verifier must be an existing, maintained
   one; none has been selected or reviewed yet.
5. Who may add a circuit description to the registry, and what review does it
   need before a report may quote it?
6. Are online checks (for example, confirming a group root on a chain) ever in
   scope? This needs explicit approval before any work.
7. Is "ZK-Proofscan" the final name? Whether the name is already in use has
   not been checked.
