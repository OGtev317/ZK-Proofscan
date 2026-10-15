# Using ZK-Proofscan as a developer

Version 0.1.0. Node 22 or later. Unaudited prototype: read the README's
status and the release review before relying on a result.

ZK-Proofscan checks a zero-knowledge proof on your machine with
established verifiers (snarkjs and arkworks for Groth16, Barretenberg for
Noir, swiftness for Cairo) and reports what it establishes, what it does
not, and, for a proof found in a transaction, which parts rest on the
network data a provider returned. It never signs, sends or writes to a
network.

## Install

Not yet published to npm. From a checkout:

```sh
git clone https://github.com/OGtev317/ZK-Proofscan && cd ZK-Proofscan
npm ci && npm run build
npm link            # puts zk-proofscan, zk-proofscan-mcp and stellar-zk-proofscan on your PATH
```

## Command line

```sh
zk-proofscan check proof.json                                   # Semaphore v4, RISC Zero receipt, Cairo
zk-proofscan check proof --public public_inputs --key vk        # snarkjs or Noir, with its own key
zk-proofscan lookup https://stellar.expert/explorer/testnet/tx/<hash>
zk-proofscan lookup <hash> --chain sepolia --json --export evidence.json
zk-proofscan rerun evidence.json
```

Exit codes: 0 valid, 1 invalid, 2 not supported (including a transaction
with no proof this tool reads, whose facts are still printed), 3 not
checked, 64 usage.

## As a Stellar CLI plugin

The Stellar CLI runs any executable named `stellar-<name>` on your `PATH`
as `stellar <name>`. After `npm link`:

```sh
stellar zk-proofscan lookup https://stellar.expert/explorer/testnet/tx/<hash>
stellar plugin ls          # lists zk-proofscan
```

## As a library

```js
import { checkProof, lookUp, explain, renderReport, stop } from 'zk-proofscan';

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

`zk-proofscan-mcp` is a Model Context Protocol server over standard input
and output, with tools `check_proof`, `write_evidence_export`,
`rerun_export` and `lookup_transaction`. See
[the local agent notes](LOCAL_AGENT.md).

## Environment

| Variable | Used for |
| --- | --- |
| `ALCHEMY_API_KEY` or `ZK_PROOFSCAN_RPC_URL` | Ethereum-family lookups |
| `STELLAR_RPC_URL` | Stellar testnet; the Stellar Development Foundation's public RPC when unset |
| `STELLAR_MAINNET_RPC_URL` | Stellar mainnet; required, there is no default |
| `ZK_PROOFSCAN_SOURCIFY=off` | Do not ask Sourcify to name an ordinary Ethereum call |
| `ZK_PROOFSCAN_STELLAR_TOML=off` | Do not fetch an asset issuer's stellar.toml |
| `ZK_PROOFSCAN_SEP55=off` | Do not ask GitHub for a contract's build attestation |

## What to read before relying on a result

- [The lookup notes](LOOKUP.md): coverage, and exactly what the provider
  is trusted for.
- [The formats](FORMATS.md): each proof system, its verifier, and what a
  pass does and does not say.
- [The release review](RELEASE_REVIEW.md): what still blocks a release.
