import type { ContractAbi } from './abi.js';
import type { StellarAssetInfo } from './stellar-assets.js';
import { lookupTransaction, type Lookup } from './lookup.js';
import { readTransactionReference } from './reference.js';
import { CHAINS, type RpcClient } from './rpc.js';
import type { RecordedKey } from './stellar.js';

/** What a lookup needs besides the provider: the recorded key files it may use. */
export interface RecordedFiles {
  /** A recorded key file, by registry artifact, for an Ethereum call that names one. */
  keyText(artifactId: string): Promise<string>;
  /** The recorded Stellar Private Payments keys, looked for in a verifier's code. */
  stellarPrivatePaymentsKeys(): Promise<RecordedKey[]>;
  /** Where to find a contract's interface, to name an ordinary call; absent to ask no one. */
  contractAbi?: ContractAbi;
  /** How to check an issued Stellar asset against its issuer's stellar.toml; absent to fetch no such file. */
  stellarAssetInfo?: StellarAssetInfo;
}

/**
 * Settles which network and transaction a request names. `pasted` may be a
 * hash or an explorer link; `network` may be given, or read from the link.
 */
export function resolveTransaction(pasted: string, network: string | undefined): { network: string; hash: string } | { reason: string } {
  const reference = readTransactionReference(pasted);
  if (reference === undefined) return { reason: 'that is not a transaction hash or a block explorer link to a transaction' };
  if (network !== undefined && reference.network !== undefined && reference.network !== network) return { reason: `the link is to a transaction on ${reference.network}, not ${network}` };
  const chosen = network ?? reference.network;
  if (chosen === undefined) return { reason: 'a hash on its own does not say which network it is on; name the network' };
  const family = CHAINS.some((chain) => chain.name === chosen) ? 'ethereum' : chosen.startsWith('stellar-') ? 'stellar' : undefined;
  if (family !== undefined && family !== reference.family) return { reason: `that is not written as a transaction hash on ${chosen}` };
  return { network: chosen, hash: reference.hash };
}

/**
 * Reads a proof out of one transaction, on an Ethereum chain or on Stellar,
 * with the provider given. Read-only. Nothing returned is verified here.
 */
export async function findProof(network: string, hash: string, rpc: RpcClient, files: RecordedFiles): Promise<Lookup> {
  const chain = CHAINS.find((known) => known.name === network);
  if (chain !== undefined) return lookupTransaction({ chain, transaction: hash, rpc, keyText: (id) => files.keyText(id), ...(files.contractAbi === undefined ? {} : { contractAbi: files.contractAbi }) });
  // The Stellar reader and its library are loaded only when a Stellar transaction is asked for.
  const { lookupStellarTransaction, STELLAR_NETWORKS } = await import('./stellar.js');
  const stellar = STELLAR_NETWORKS.find((known) => known.name === network);
  if (stellar === undefined) return { found: false, reason: `the network must be one of ${[...CHAINS.map((known) => known.name), ...STELLAR_NETWORKS.map((known) => known.name)].join(', ')}` };
  return lookupStellarTransaction({ network: stellar, transaction: hash, rpc, recordedKeys: () => files.stellarPrivatePaymentsKeys(), ...(files.stellarAssetInfo === undefined ? {} : { assetInfo: files.stellarAssetInfo }) });
}
