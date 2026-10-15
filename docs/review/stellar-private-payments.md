# Review request: how LumenLenz reads Stellar Private Payments

Prepared 2026-10-15 for Nethermind's Stellar Private Payments team. Not yet
sent. LumenLenz is an open-source, unaudited, experimental tool
(GPL-3.0-or-later, <https://github.com/OGtev317/ZK-Proofscan>) that
re-verifies zero-knowledge proofs found in Stellar transactions and
explains them in plain language. It reads your blocklist pool on testnet.
Before we present that reading as anything more than a draft, we would be
grateful if someone who knows the circuits and contracts checked it.

Everything below is reproducible from the repository at the commit that
adds this file.

## What we ask you to check

1. **The explanation** (section 4): is the mathematical statement right
   for `policy_tx_2_2_B`, and is anything it claims not enforced by the
   circuit, or anything enforced that it leaves out?
2. **The public inputs** (section 3): their order, and what each means.
3. **The split between proof and contract** (section 5): are these the
   checks the pool contract performs, and is the list complete?
4. **Two observations from real data** (section 6): zero-amount inputs,
   and a blocklist root of 0.
5. **Key identification** (section 2): is finding every point of a
   recorded key in the verifier's code an acceptable way to say which key
   a deployed verifier uses, given that it does not show the code uses
   them?

If the reading is right, a reply saying so, with a name and date we may
record, would let us mark the explanation as reviewed. If not, corrections
of any size are welcome.

## 1. Versions read

| What | Version |
| --- | --- |
| Circuits | `NethermindEth/stellar-private-payments` commit `ef42a47ee6a84b5c7a289b979e2fa2526c73aabc` (circuits bundle 0.5) |
| Circuit sources read | `policy_tx_2_2_B.circom`, `policyTransactionBlocklist.circom`, `policyTransaction.circom`, `aspNonMembership.circom`, `keypair.circom` |
| Not read | The Merkle, sparse Merkle and Poseidon2 circuits they include |
| Pool contract read | commit `0471e6be8161c2013cfc8387bd7b72b70e480cf5`, `contracts/pool/src/pool.rs` (`verify_proof`), `contracts/pool-core/src/policy.rs` |
| Verification key | `deployments/testnet/circuit_keys/policy_tx_2_2_B_vk.json`, SHA-256 `e30ed2a42074bd6e4f7afb8f2a3068cfd9c08467213cff6b687ed13b45e63afc` |
| Deployment read | `deployments/testnet/deployments.json` as of 2026-10-14: blocklist pool `CA73PEBSX2GXZSMMVL46PTCXY424AIMPXKI7WWUMYJXV22AVY2DXC6DQ`, verifier `CA66PGQD3OUO5R64CMOWL3FIRAQTWORLX36ZERALPPYOJ4ORETGFO3P5` |
| Our explanation | `adapters/stellar-private-payments-blocklist/adapter.json`, revision 1, SHA-256 `576006f089a6cee9058a49955fd29ca9b956562bc24d11f0abea5721ee3b887c` |

## 2. How the tool reads a pool transaction

Read-only, through a Stellar RPC (the public testnet RPC by default):

1. Fetch the transaction. Compute its hash locally from the envelope, so
   the provider cannot answer about a different one.
2. Require exactly one `invokeContract` operation calling `transact` with
   the `Proof` struct's nine fields and a 64/128/64-byte `a`/`b`/`c`.
3. Read the pool's instance storage for `DataKey::Verifier` and
   `DataKey::PolicyFlags`.
4. Read the verifier's code by its hash, and check the code's SHA-256.
5. Use the one recorded key every point of which appears in that code, in
   Soroban's byte layout (G1 as x‖y; G2 as x.c1‖x.c0‖y.c1‖y.c0, matching
   `utils.rs`), with as many public inputs as the pool will pass.
6. Assemble the public inputs in the order `pool.rs` passes them (section
   3), including the blocklist root once per nullifier when the policy's
   blocklist bit is set.
7. Verify the Groth16 proof twice, with snarkjs 0.7.6 and arkworks
   `ark-groth16` 0.6.0; a result stands only when both agree.

What rests on the provider and is not checked: that the transaction was
included and its outcome, the contracts' storage, and when that storage
last changed. Step 5 does not show that the verifier's code uses the
points it contains.

## 3. Public inputs, in the order the pool passes them

| # | Field | Our reading |
| --- | --- | --- |
| 1 | root | The root of the pool's tree of notes. Every spent note with a non-zero amount is a leaf of the tree with this root. Whether the pool has ever had this root is the pool contract's check. |
| 2 | public amount | What enters the pool (as a positive number) or leaves it, net of the fee, as a number in the BN254 field: an amount leaving is written as the field's size minus that amount. Whether it matches what was paid is the pool contract's check. |
| 3 | external data hash | A hash, computed by the pool contract, of the transaction's external data: recipient, external amount and encrypted outputs. The proof is bound to it but the circuit does not look inside it. |
| 4 | input nullifier 1 | Derived from the first spent note and its owner's private key. Publishing it lets the pool refuse a second spend of that note without revealing which note it was. |
| 5 | input nullifier 2 | Derived from the second spent note and its owner's private key, as for the first. |
| 6 | output commitment 1 | A commitment to a new note: an amount, an owner's public key and a blinding value, all hidden. |
| 7 | output commitment 2 | A commitment to a second new note, as for the first. |
| 8 | blocklist root for input 1 | The root of the blocklist tree the owner of the first input is shown to be absent from. A root of 0 is the empty tree, which every key is absent from. Whether it is the pool's current blocklist is the pool contract's check. |
| 9 | blocklist root for input 2 | The same for the owner of the second input. A root of 0 is the empty tree. |

## 4. The explanation shown for a passing proof

**Claim (mathematical statement only).** Whoever made this proof knew,
for each of two inputs, a private key, an amount and a blinding value from
which the nullifier shown is derived; any input with a non-zero amount is
a note in the tree with the root shown; each input's owner key is absent
from the blocklist tree with the root shown; and they knew the note behind
each output commitment shown. The nullifiers differ, the inputs plus the
public amount equal the outputs, and the proof is bound to the external
data hash shown.

**Hidden.** The amounts of the spent and the new notes; which notes were
spent; the private keys of the spent notes' owners and the public keys of
the new notes' owners; the blinding values.

**Limits.**

- This is the mathematical statement alone. That the transaction was a
  valid private payment in this pool, made by someone not on its
  blocklist, also rests on the pool contract's own checks (section 5),
  which this tool did not perform.
- An input with a zero amount is not checked against the tree, so a
  deposit made with two zero-amount inputs shows nothing about earlier
  notes.
- This does not establish who sent or received anything, or what the
  hidden amounts were.
- Absence from the blocklist means only that the owner's key is not on
  the list its maintainer published. It says nothing about the person
  behind the key.
- Stellar Private Payments is published as unaudited work in progress for
  testnet only. This key's setup was run on one machine with no trusted
  ceremony, so whoever ran it could make passing proofs of false
  statements.

**Assumptions.** Groth16, BN254 and Poseidon2 are sound; the setup was
performed honestly (recorded as local, with no ceremony); the key belongs
to the named circuit, which with the circuits it includes enforces the
statement; the verifier libraries are correct.

## 5. What we attribute to the pool contract, not the proof

| Check | Our wording |
| --- | --- |
| known root | Whether the root is one the pool's tree has had. |
| nullifiers unspent | Whether either nullifier was used before, which would make this a second spend of a note. |
| blocklist current | Whether the blocklist roots are the pool's current blocklist. |
| external data | Whether the external data hash matches this transaction's recipient, external amount and encrypted outputs. |
| amount paid | Whether the public amount matches the tokens actually deposited or withdrawn, net of the fee. |

## 6. Evidence: the two testnet transactions

Both `transact` calls to the blocklist pool that the public testnet RPC
held on 2026-10-14 pass under the recorded key, with both verifiers
agreeing:

- `cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc`
  (ledger 5190131)
- `0460a0f6a63608ca64435f776d770c5912ebe6c6d7e63836cf7c897b1c12c8a1`
  (ledger 5191591)

In both, the public amount is 1000000 and both blocklist roots are 0. We
read that as an empty blocklist, so the non-membership part holds
trivially. The first also moved 0.1 XLM from the sender to the pool,
according to the RPC's events. Reproduce with:

```sh
npx lumenlenz lookup https://stellar.expert/explorer/testnet/tx/cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc
```

The RPC's answers for the first are kept as a test fixture
(`tests/fixtures/stellar-testnet/private-payments/answers.json`), since
public RPCs keep only about a week of history.

## Specific questions

1. Are the two inputs in a pure deposit zero-amount dummies, and is it
   right that such a deposit proves nothing about earlier notes?
2. Is a blocklist root of 0 the empty tree in your sparse Merkle tree, and
   is an empty blocklist expected on the testnet pool?
3. Is the public amount for a withdrawal the field's size minus the
   amount, as we infer from the circuit's field arithmetic (we did not
   read `amounts.rs`), and is the fee already netted out of it?
4. The comment on `hash_ext_data` in `pool.rs` says it binds the
   external data to the pool's own address and token as well. Is our
   description of what the hash covers complete with those two added?
5. Is there a reason the gvk ("traceable") pool should be read
   differently, beyond its extra fields?
