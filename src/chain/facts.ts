/**
 * What can be said about a transaction in which no supported proof was
 * found: where it is, whether the network accepted it, who sent it and what
 * it did, as the provider reported. Nothing here is checked by this tool.
 */
export interface TransactionFacts {
  family: 'ethereum' | 'stellar';
  /** Host name of the provider that was asked. */
  provider: string;
  network: string;
  transaction: string;
  /** The block number on an Ethereum chain, the ledger on Stellar. */
  position: number;
  status: 'succeeded' | 'reverted' | 'failed';
  /** The account that sent it. */
  from: string;
  /** What it did, in words: a transfer, a call to a named function, the operations it held. */
  action: string;
  /** The contract called or the account paid, when there is one. */
  to?: string;
}

const NETWORK_NAMES: Record<string, string> = {
  sepolia: 'Ethereum Sepolia (a test network)',
  ethereum: 'Ethereum',
  base: 'Base',
  'base-sepolia': 'Base Sepolia (a test network)',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum',
  polygon: 'Polygon',
  'stellar-testnet': 'the Stellar test network',
  'stellar-mainnet': 'the Stellar main network',
};
export const networkName = (network: string): string => NETWORK_NAMES[network] ?? network;

const STATUS: Record<TransactionFacts['status'], string> = { succeeded: 'accepted', reverted: 'reverted', failed: 'failed' };

/** One or two sentences for a reader. */
export function plainFacts(facts: TransactionFacts): string {
  return `This is a transaction on ${networkName(facts.network)}: ${facts.action}. According to ${facts.provider}, the network ${STATUS[facts.status]} it. No zero-knowledge proof that this tool can read was found in it, so there is no proof to check.`;
}

/** The facts as labelled lines, for technical details and the command line. */
export function factLines(facts: TransactionFacts): [string, string][] {
  return [
    ['Network', networkName(facts.network)],
    ['Transaction', facts.transaction],
    [facts.family === 'stellar' ? 'Ledger' : 'Block', String(facts.position)],
    ['Status', `${STATUS[facts.status]}, as reported by ${facts.provider}`],
    ['Sent by', facts.from],
    ['What it did', facts.action],
    ...(facts.to === undefined ? [] : ([[facts.family === 'stellar' ? 'Contract or account' : 'To', facts.to]] as [string, string][])),
  ];
}

export const renderFacts = (facts: TransactionFacts): string =>
  [`No supported proof found. What ${facts.provider} reported about the transaction, not checked by this tool:`, ...factLines(facts).map(([label, value]) => `  - ${label}: ${value}`)].join('\n');
