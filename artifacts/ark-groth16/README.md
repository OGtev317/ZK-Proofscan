# arkworks' Groth16 verifier, as WebAssembly

`ark-groth16.wasm` is built from `verifiers/ark-groth16` by
`scripts/build-ark-groth16.sh`, with Rust 1.97.1 (pinned in
`rust-toolchain.toml`) and every crate version pinned in `Cargo.lock`, on
Linux x86-64: this file is the CI's build. The script with `--check`
rebuilds it and compares, and the CI does so on every push. Measured: the
same source and toolchain on macOS with Apple silicon give different,
equally valid bytes, because the compiler's own platform affects its output;
that build passes every test but does not match. Its SHA-256 is pinned in
`src/ark-groth16.ts`:
`bee54115f999da60d06a830988da829b95acc91515dd5c1bc69c0a58eeaad7e8`.

The verifier is `ark-groth16` 0.6.0 from arkworks
(<https://github.com/arkworks-rs/groth16>), with `ark-bn254` and
`ark-bls12-381` 0.6.0. The code in `verifiers/ark-groth16/src/lib.rs` only
reads numbers into arkworks' types, refuses those that are not field
elements or points of the right group (arkworks' own checks), and calls
`Groth16::verify_proof`. No cryptography is written here.

The module imports nothing, so it can reach nothing outside itself, and
exports only its memory, `alloc` and `verify`. Each check runs in a new
instance.

## Audit status

No audit of `ark-groth16` 0.6.0 was found. arkworks is widely used and
maintained; that is not the same as audited.

## Licences

arkworks' crates are dual-licensed MIT or Apache-2.0; their licence files
are `LICENSE-MIT` and `LICENSE-APACHE` here. Every crate the build uses, as
each declares (proc-macro crates such as `quote` run only while building):

| Crate | Version | Licence |
| --- | --- | --- |
| ahash | 0.8.12 | MIT OR Apache-2.0 |
| allocator-api2 | 0.2.21 | MIT OR Apache-2.0 |
| ark-bls12-381 | 0.6.0 | MIT OR Apache-2.0 |
| ark-bn254 | 0.6.0 | MIT OR Apache-2.0 |
| ark-crypto-primitives | 0.6.0 | MIT/Apache-2.0 |
| ark-crypto-primitives-macros | 0.5.0 | MIT/Apache-2.0 |
| ark-ec | 0.6.0 | MIT OR Apache-2.0 |
| ark-ff | 0.6.0 | MIT OR Apache-2.0 |
| ark-ff-asm | 0.6.0 | MIT OR Apache-2.0 |
| ark-ff-macros | 0.6.0 | MIT OR Apache-2.0 |
| ark-groth16 | 0.6.0 | MIT/Apache-2.0 |
| ark-poly | 0.6.0 | MIT OR Apache-2.0 |
| ark-relations | 0.6.0 | MIT/Apache-2.0 |
| ark-serialize | 0.6.0 | MIT OR Apache-2.0 |
| ark-serialize-derive | 0.6.0 | MIT OR Apache-2.0 |
| ark-snark | 0.6.0 | MIT/Apache-2.0 |
| ark-std | 0.6.0 | MIT/Apache-2.0 |
| blake2 | 0.10.6 | MIT OR Apache-2.0 |
| block-buffer | 0.10.4 | MIT OR Apache-2.0 |
| byteorder | 1.5.0 | Unlicense OR MIT |
| cfg-if | 1.0.5 | MIT OR Apache-2.0 |
| crypto-common | 0.1.7 | MIT OR Apache-2.0 |
| derivative | 2.2.0 | MIT/Apache-2.0 |
| digest | 0.10.7 | MIT OR Apache-2.0 |
| educe | 0.6.0 | MIT |
| either | 1.19.0 | MIT OR Apache-2.0 |
| enum-ordinalize | 4.4.2 | MIT |
| enum-ordinalize-derive | 4.4.2 | MIT |
| equivalent | 1.0.3 | Apache-2.0 OR MIT |
| foldhash | 0.1.5 | Zlib |
| generic-array | 0.14.7 | MIT |
| hashbrown | 0.17.1 | MIT OR Apache-2.0 |
| indexmap | 2.14.2 | Apache-2.0 OR MIT |
| itertools | 0.14.0 | MIT OR Apache-2.0 |
| keccak | 0.1.6 | Apache-2.0 OR MIT |
| merlin | 3.0.0 | MIT |
| num-bigint | 0.4.8 | MIT OR Apache-2.0 |
| num-integer | 0.1.47 | MIT OR Apache-2.0 |
| num-traits | 0.2.19 | MIT OR Apache-2.0 |
| once_cell | 1.21.4 | MIT OR Apache-2.0 |
| pin-project-lite | 0.2.17 | Apache-2.0 OR MIT |
| ppv-lite86 | 0.2.21 | MIT OR Apache-2.0 |
| proc-macro2 | 1.0.107 | MIT OR Apache-2.0 |
| quote | 1.0.47 | MIT OR Apache-2.0 |
| rand | 0.8.8 | MIT OR Apache-2.0 |
| rand_chacha | 0.3.1 | MIT OR Apache-2.0 |
| rand_core | 0.6.4 | MIT OR Apache-2.0 |
| sha2 | 0.10.9 | MIT OR Apache-2.0 |
| subtle | 2.6.1 | BSD-3-Clause |
| syn | 1.0.109 | MIT OR Apache-2.0 |
| syn | 2.0.119 | MIT OR Apache-2.0 |
| syn | 3.0.9 | MIT OR Apache-2.0 |
| tracing | 0.1.44 | MIT |
| tracing-attributes | 0.1.31 | MIT |
| tracing-core | 0.1.36 | MIT |
| typenum | 1.20.1 | MIT OR Apache-2.0 |
| unicode-ident | 1.0.27 | AND Unicode-3.0 |
| zerocopy | 0.8.63 | BSD-2-Clause OR Apache-2.0 OR MIT |
| zeroize | 1.9.1 | Apache-2.0 OR MIT |
| zeroize_derive | 1.5.0 | Apache-2.0 OR MIT |
