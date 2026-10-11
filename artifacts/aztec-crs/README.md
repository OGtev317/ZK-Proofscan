# Setup files for Barretenberg (UltraHonk)

Barretenberg, the verifier used for Noir proofs, needs these files before it
will verify anything. Its own downloader fetched them from
`https://crs.aztec-cdn.foundation/` on 2026-10-11, through `@aztec/bb.js`
5.2.1, and they are stored here unchanged so that checking a proof never
downloads anything.

| File | What it is | SHA-256 |
| --- | --- | --- |
| `bn254_g1_compressed.dat` | The first 131,072 G1 points of Aztec's setup for BN254, the fewest the library accepts | `fad8203ae1fd103658d4bb33b2b4cf126a28352b5de4684737cff23cc15fb94b` |
| `bn254_g2.dat` | The setup's G2 point. A verification's soundness rests on this file | `01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f` |
| `grumpkin_g1_v2.flat.dat` | Points for the Grumpkin curve, which need no trusted setup | `64236c9455e75aeea77a94587ea607eed2e978d2609a421d66bf10bb9698b8fd` |
| `grumpkin_size` | The number of Grumpkin points, as text | `0f255ec16482c343fd099ba9668863778be40dc166a6856b1d470e0bc97cc6fd` |

The hashes are pinned in `src/node/noir-engine.ts`. A file with any other
content is refused, and each check works from a private copy.

## Not checked

- That these are the points produced by Aztec's Ignition ceremony. They are
  what Aztec's server sent on that date. Comparing the G2 point with the
  ceremony's published transcript has not been done.
- The terms under which Aztec publishes these files. No licence was found
  with them.
