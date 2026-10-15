#!/bin/sh
# Builds arkworks' Groth16 verifier as WebAssembly from verifiers/ark-groth16,
# with the Rust release and every crate version pinned, and writes it to
# artifacts/ark-groth16/ark-groth16.wasm. With --check it compares the build
# with the committed file instead, so anyone can confirm the file is this
# source. Paths are remapped so the output does not depend on where it is built.
#
# The reference build is made on Linux x86-64, as the CI does. Measured: the
# same source and toolchain on macOS (Apple silicon) give different, though
# equally valid, bytes, because the compiler's own platform affects its
# output. A build on another platform passes the tests but will not match.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
crate="$root/verifiers/ark-groth16"
cd "$crate"
RUSTFLAGS="--remap-path-prefix=$crate=/zk-proofscan/ark-groth16 --remap-path-prefix=${CARGO_HOME:-$HOME/.cargo}=/cargo" \
  cargo build --release --locked --target wasm32-unknown-unknown
built="$crate/target/wasm32-unknown-unknown/release/zk_proofscan_ark_groth16.wasm"
if [ "${1:-}" = "--check" ]; then
  if [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
    echo "note: the reference build is made on Linux x86-64; this is $(uname -s) $(uname -m), whose bytes differ" >&2
  fi
  cmp "$built" "$root/artifacts/ark-groth16/ark-groth16.wasm"
  echo "the committed module is this build"
elif [ "$(uname -s)-$(uname -m)" != "Linux-x86_64" ]; then
  echo "not replacing the committed module: the reference build is made on Linux x86-64; this build is at $built" >&2
  exit 1
else
  cp "$built" "$root/artifacts/ark-groth16/ark-groth16.wasm"
fi
shasum -a 256 "$root/artifacts/ark-groth16/ark-groth16.wasm"
