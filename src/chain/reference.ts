/**
 * Reads what a person pastes to name a transaction: a bare hash, or the
 * address of the transaction's page on a block explorer. Nothing is
 * fetched: the network is read from the explorer's address when it names
 * one, and the hash is checked for its form only.
 */

export type ChainFamily = 'ethereum' | 'stellar';

export interface TransactionReference {
  family: ChainFamily;
  /** The network, when what was pasted names one. */
  network?: string;
  /** As each network writes it: 0x and 64 hex digits on Ethereum chains, 64 hex digits on Stellar. */
  hash: string;
}

/** Every network a transaction can be looked up on, by family. */
export const NETWORKS: Record<ChainFamily, readonly string[]> = {
  ethereum: ['sepolia', 'ethereum', 'base', 'base-sepolia', 'optimism', 'arbitrum', 'polygon'],
  stellar: ['stellar-testnet', 'stellar-mainnet'],
};
export const familyOf = (network: string): ChainFamily | undefined => (NETWORKS.ethereum.includes(network) ? 'ethereum' : NETWORKS.stellar.includes(network) ? 'stellar' : undefined);

// Each explorer's host, the network it shows, and the path a transaction's page has.
const ETHEREUM_EXPLORERS: Record<string, string> = {
  'etherscan.io': 'ethereum',
  'sepolia.etherscan.io': 'sepolia',
  'basescan.org': 'base',
  'sepolia.basescan.org': 'base-sepolia',
  'optimistic.etherscan.io': 'optimism',
  'arbiscan.io': 'arbitrum',
  'polygonscan.com': 'polygon',
};
const STELLAR_EXPERT_NETWORKS: Record<string, string> = { testnet: 'stellar-testnet', public: 'stellar-mainnet' };
const STELLAR_LAB_NETWORKS: Record<string, string> = { testnet: 'stellar-testnet', mainnet: 'stellar-mainnet' };
const STELLARCHAIN: Record<string, string> = { 'stellarchain.io': 'stellar-mainnet', 'testnet.stellarchain.io': 'stellar-testnet' };

const EVM_HASH = /^0x[0-9a-f]{64}$/;
const STELLAR_HASH = /^[0-9a-f]{64}$/;

export function readTransactionReference(pasted: string): TransactionReference | undefined {
  const text = pasted.trim();
  if (text.length === 0 || text.length > 512) return undefined;
  const lower = text.toLowerCase();
  if (EVM_HASH.test(lower)) return { family: 'ethereum', hash: lower };
  if (STELLAR_HASH.test(lower)) return { family: 'stellar', hash: lower };

  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter((part) => part !== '');
  const last = (parts[parts.length - 1] ?? '').toLowerCase();

  const ethereum = ETHEREUM_EXPLORERS[host];
  if (ethereum !== undefined && parts.length === 2 && parts[0] === 'tx' && EVM_HASH.test(last)) return { family: 'ethereum', network: ethereum, hash: last };

  if (host === 'stellar.expert' && parts.length === 4 && parts[0] === 'explorer' && parts[2] === 'tx' && STELLAR_HASH.test(last)) {
    const network = STELLAR_EXPERT_NETWORKS[parts[1]!];
    return network === undefined ? undefined : { family: 'stellar', network, hash: last };
  }
  if (host === 'lab.stellar.org' && parts.length === 4 && parts[0] === 'r' && parts[2] === 'tx' && STELLAR_HASH.test(last)) {
    const network = STELLAR_LAB_NETWORKS[parts[1]!];
    return network === undefined ? undefined : { family: 'stellar', network, hash: last };
  }
  const stellarchain = STELLARCHAIN[host];
  if (stellarchain !== undefined && parts.length === 2 && (parts[0] === 'tx' || parts[0] === 'transactions') && STELLAR_HASH.test(last)) return { family: 'stellar', network: stellarchain, hash: last };
  return undefined;
}

/**
 * The public RPC the browser page asks for each network. Each is a third
 * party that sees the hash of every transaction a visitor looks up; the page
 * names it beside the button. The command line does not use these: it uses
 * the provider its operator configures.
 */
export const PAGE_RPCS: Record<string, string> = {
  // dRPC keeps receipts of old transactions; PublicNode's Sepolia endpoint was
  // measured on 2026-10-15 to return a transaction from 2024 without its receipt.
  sepolia: 'https://sepolia.drpc.org',
  ethereum: 'https://eth.drpc.org',
  base: 'https://base.drpc.org',
  'base-sepolia': 'https://base-sepolia.drpc.org',
  optimism: 'https://optimism.drpc.org',
  arbitrum: 'https://arbitrum.drpc.org',
  // dRPC's Polygon endpoint could not be reached from the machine this was built on.
  polygon: 'https://polygon-bor.publicnode.com',
  'stellar-testnet': 'https://soroban-testnet.stellar.org',
  'stellar-mainnet': 'https://mainnet.sorobanrpc.com',
};

/** Where a reader can inspect a transaction on public explorers, to compare with this tool's account of it. */
export function explorerLinks(network: string, hash: string): { label: string; url: string }[] {
  const stellar: Record<string, [string, string]> = { 'stellar-testnet': ['testnet', 'testnet'], 'stellar-mainnet': ['public', 'mainnet'] };
  if (network in stellar) {
    const [expert, lab] = stellar[network]!;
    return [
      { label: 'Stellar Lab', url: `https://lab.stellar.org/r/${lab}/tx/${hash}` },
      { label: 'stellar.expert', url: `https://stellar.expert/explorer/${expert}/tx/${hash}` },
    ];
  }
  const host = Object.entries(ETHEREUM_EXPLORERS).find(([, name]) => name === network)?.[0];
  return host === undefined ? [] : [{ label: host, url: `https://${host}/tx/${hash}` }];
}

