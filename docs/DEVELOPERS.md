# Using LumenLenz as a developer

Version 0.1.0, an experimental release. Node 22 or later. Unaudited:
reports and interfaces may change, and no result should be relied on for
a decision with real value at stake. Read the README's status and the
release review first.

LumenLenz checks a zero-knowledge proof on your machine with
established verifiers (snarkjs and arkworks for Groth16, Barretenberg for
Noir, swiftness for Cairo) and reports what it establishes, what it does
not, and, for a proof found in a transaction, which parts rest on the
network data a provider returned. It never signs, sends or writes to a
network.

## Install

```sh
npm install -g lumenlenz   # puts lumenlenz, lumenlenz-mcp and stellar-lumenlenz on your PATH
npm install lumenlenz      # or as a library in a project
```

From a checkout:

```sh
git clone https://github.com/OGtev317/ZK-Proofscan && cd ZK-Proofscan
npm ci && npm run build
npm link
```

## Command line

```sh
lumenlenz check proof.json                                   # Semaphore v4, RISC Zero receipt, Cairo
lumenlenz check proof --public public_inputs --key vk        # snarkjs or Noir, with its own key
lumenlenz lookup https://stellar.expert/explorer/testnet/tx/<hash>
lumenlenz lookup <hash> --chain sepolia --json --export evidence.json
lumenlenz rerun evidence.json
```

Exit codes: 0 valid, 1 invalid, 2 not supported (including a transaction
with no proof this tool reads, whose facts are still printed), 3 not
checked, 64 usage.

## As a Stellar CLI plugin

The Stellar CLI runs any executable named `stellar-<name>` on your `PATH`
as `stellar <name>`. After `npm install -g lumenlenz` (or `npm link`):

```sh
stellar lumenlenz lookup https://stellar.expert/explorer/testnet/tx/<hash>
stellar plugin ls          # lists lumenlenz
```

## As a library

```js
import { checkProof, lookUp, explain, renderReport, stop } from 'lumenlenz';

const report = await checkProof({ proof, publicInputs, verificationKey });
console.log(renderReport(report));

const found = await lookUp('https://stellar.expert/explorer/testnet/tx/<hash>');
if (found.kind === 'checked') {
  const view = explain({ report: found.report, source: found.source, facts: found.facts });
  console.log(view.happened, view.proofCheck, view.settlement);
} else {
  console.log(found.reason, found.facts);   // facts: what the transaction did, when no proof was found
}
await stop();
```

Every function returns a result rather than throwing for a proof it
cannot check. `found.source` is what the provider reported, never checked
here; `found.report` is this tool's own check.

## For an AI agent (MCP)

`lumenlenz-mcp` is a Model Context Protocol server over standard input
and output, with tools `check_proof`, `write_evidence_export`,
`rerun_export` and `lookup_transaction`. See
[the local agent notes](LOCAL_AGENT.md).

## Environment

| Variable | Used for |
| --- | --- |
| `ALCHEMY_API_KEY` or `LUMENLENZ_RPC_URL` | Ethereum-family lookups |
| `STELLAR_RPC_URL` | Stellar testnet; the Stellar Development Foundation's public RPC when unset |
| `STELLAR_MAINNET_RPC_URL` | Stellar mainnet; required, there is no default |
| `LUMENLENZ_SOURCIFY=off` | Do not ask Sourcify to name an ordinary Ethereum call |
| `LUMENLENZ_STELLAR_TOML=off` | Do not fetch an asset issuer's stellar.toml |
| `LUMENLENZ_SEP55=off` | Do not ask GitHub for a contract's build attestation |

## What to read before relying on a result

Added after 0.1.0, so not in the published package yet: transaction stories,
guarded swap decoding, provider history, proof profiles and offline unsigned
transaction inspection (`lumenlenz inspect`). See
[Product lenses](PRODUCT_LENSES.md).

- [The lookup notes](LOOKUP.md): coverage, and exactly what the provider
  is trusted for.
- [The formats](FORMATS.md): each proof system, its verifier, and what a
  pass does and does not say.
- [The release review](RELEASE_REVIEW.md): what still blocks a release.
