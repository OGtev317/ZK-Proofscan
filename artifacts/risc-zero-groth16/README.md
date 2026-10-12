# RISC Zero Groth16 receipt verifier parameters, version 3.0.0

`parameters-3.0.0.json` is an unmodified copy of
`contracts/groth16-verifier/parameters.json` from
`NethermindEth/stellar-risc0-verifier` at commit
`e8ff6ea202db195352c0141ecc533ff649393fe4` (Apache-2.0; see `LICENSE`).
It holds the Groth16 verification key, the control root and the BN254
control ID that RISC Zero's receipt verifier uses. The parameters are RISC
Zero's, not specific to Stellar: the same ones verify a receipt on any chain.

SHA-256 of the file:
`290b10f9fed64871c33bcd2624fc5bd50f22d72b44063ce269648800642ad29a`

## What was checked

`node scripts/check-risc-zero-parameters.mjs` repeats this and writes
`parameters-check.json`:

- the file is byte-for-byte the one in Nethermind's repository;
- all 26 numbers of the verification key equal the constants in RISC Zero's
  own `Groth16Verifier.sol`, and the control root and BN254 control ID
  equal those in its `ControlID.sol`, at tag `v3.0.0` of
  `risc0/risc0-ethereum` (commit `32aa0b6f23ddd02dd93fc71717667606e5c7db86`);
- the test receipt in Nethermind's contract tests, kept here as
  `tests/fixtures/risc-zero/nethermind-test-receipt.txt`, passes under
  these parameters.

## What was not checked

- That the selector `73c457ba` follows from these parameters. It was not
  recomputed.
- How the trusted setup behind the key was run.
- The RISC Zero circuits that the control root allows.
- Nethermind's verifier says of itself that it has not been audited. This
  tool uses its parameters file and its test receipt, not its code.
- Only one real receipt was available.
