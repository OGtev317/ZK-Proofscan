#!/bin/sh
# Builds arkworks' Groth16 verifier as WebAssembly from verifiers/ark-groth16,
# with the Rust release and every crate version pinned, and writes it to
# artifacts/ark-groth16/ark-groth16.wasm. With --check it compares the build
# with the committed file instead, so anyone can confirm the file is this
# source. Paths are remapped so the output does not depend on where it is built.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
crate="$root/verifiers/ark-groth16"
cd "$crate"
RUSTFLAGS="--remap-path-prefix=$crate=/zk-proofscan/ark-groth16 --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" \
  cargo build --release --locked --target wasm32-unknown-unknown
built="$crate/target/wasm32-unknown-unknown/release/zk_proofscan_ark_groth16.wasm"
if [ "${1:-}" = "--check" ]; then
  cmp "$built" "$root/artifacts/ark-groth16/ark-groth16.wasm"
  echo "the committed module is this build"
else
  cp "$built" "$root/artifacts/ark-groth16/ark-groth16.wasm"
fi
shasum -a 256 "$root/artifacts/ark-groth16/ark-groth16.wasm"
