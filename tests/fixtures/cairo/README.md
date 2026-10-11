# Cairo proof fixtures

Unmodified example proofs from the Swiftness repository
(`iosis-tech/swiftness`, Apache-2.0), commit
`29c780d476a060e1206af431ee4b4272aaa7c28c`, folder `examples/proofs`. Each
proves a run of the Fibonacci program in that folder. They were made by
that project with the Stone prover; nothing here was made with a secret.

| File here | File there | Security the proof declares |
| --- | --- | --- |
| `dynamic-stone6-96-bits.json` | `dynamic/cairo0_stone6_example_proof.json` | 32 queries × 2 + 32 = 96 bits |
| `starknet-stone5-70-bits.json` | `starknet/cairo0_stone5_example_proof.json` | 10 queries × 4 + 30 = 70 bits |

The second is below the 80 bits this tool requires, and is here to test
that such a proof is refused.
