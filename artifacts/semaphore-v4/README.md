# Semaphore v4 verification keys

`verification-keys.json` is an unmodified copy of
`src/verification-keys.json` from the npm package `@semaphore-protocol/proof`
version 4.14.3 (MIT; see `LICENSE` in this folder). It holds the Groth16
verification keys for tree depths 1 to 32.

SHA-256 of the file:
`d96ec60593b6fc2334f1f04e008e07425d5536d7777f6ac21d996fc80779b3c9`

The loader refuses any file whose hash differs. The hash shows the file has
not changed since it was copied. It does not show that these keys came from a
sound trusted setup or that they match any particular circuit source; that
link has not been established or reviewed in this repository.
