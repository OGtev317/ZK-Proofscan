// Writes the registry entries for the Stellar Private Payments testnet keys
// kept in artifacts/stellar-private-payments, from those files. Prints the
// entries as JSON; it does not edit the registry.
//
//   node scripts/record-stellar-private-payments-keys.mjs
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { keyContentSha256 } from '../dist/registry.js';

export const COMMIT = 'ef42a47ee6a84b5c7a289b979e2fa2526c73aabc';
const folder = fileURLToPath(new URL('../artifacts/stellar-private-payments/', import.meta.url));
const POLICY = { '': 'no allowlist or blocklist', _A: 'allowlist', _B: 'blocklist', _AB: 'allowlist and blocklist' };
const VIEW = { '': '', _gvk_V: ', with a view key for an authority (view only)', _gvk_T: ', with a view key for an authority (traceable)' };

function describe(stem) {
  const disclosure = /^selectiveDisclosure_([1-4])$/.exec(stem);
  if (disclosure) return `Selective-disclosure receipt for ${disclosure[1]} note${disclosure[1] === '1' ? '' : 's'}, checked off-chain`;
  const policy = /^policy_tx_2_2(|_A|_B|_AB)(|_gvk_V|_gvk_T)$/.exec(stem);
  if (!policy) throw new Error(`unknown circuit ${stem}`);
  return `Pool transaction with two inputs and two outputs, ${POLICY[policy[1]]}${VIEW[policy[2]]}`;
}

export const entries = readdirSync(folder).filter((name) => name.endsWith('_vk.json')).sort().map((name) => {
  const stem = name.slice(0, -'_vk.json'.length);
  const bytes = readFileSync(`${folder}${name}`);
  return {
    id: `stellar-private-payments-testnet-${stem.replaceAll('_', '-').toLowerCase()}`,
    description: `Stellar Private Payments (Nethermind), testnet key. ${describe(stem)}`,
    provenance: {
      publisher: 'Nethermind',
      package: 'NethermindEth/stellar-private-payments',
      version: `commit ${COMMIT}, circuits bundle 0.5`,
      file: `deployments/testnet/circuit_keys/${name}`,
      url: `https://github.com/NethermindEth/stellar-private-payments/blob/${COMMIT}/deployments/testnet/circuit_keys/${name}`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
    circuit: { name: stem, source: `https://github.com/NethermindEth/stellar-private-payments/blob/${COMMIT}/circuits/src/${stem}.circom` },
    circuitLink: {
      status: 'unconfirmed',
      note: "The publisher records this key's setup as local: it was made on one machine with no trusted ceremony, so whoever made it could make passing proofs of false statements. The publisher says the keys are for testnet only and the code is unaudited. That the key was built from this source was not checked.",
    },
    // The blocklist pool's key has an explanation (adapters/stellar-private-payments-blocklist); the others have none.
    explanationAdapter: stem === 'policy_tx_2_2_B' ? 'stellar-private-payments-blocklist' : null,
    entryReview: { status: 'unreviewed', note: "Written with the tool. No maintainer has checked this entry against the publisher's files." },
    keys: [{ label: "the circuit's only key", contentSha256: keyContentSha256(JSON.parse(bytes.toString('utf8'))) }],
  };
});

if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(entries, null, 1));
