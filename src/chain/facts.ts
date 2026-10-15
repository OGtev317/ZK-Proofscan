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
  /** Token movements and permissions the transaction recorded, one sentence each. */
  tokens?: string[];
  /** More token events were recorded than are listed. */
  moreTokens?: boolean;
  /** The fee charged, in the network's own coin. */
  fee?: string;
  memo?: string;
  /** Each operation's outcome, when the network reports them separately. */
  outcomes?: string[];
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
  const tokens = facts.tokens ?? [];
  const activity =
    tokens.length === 0
      ? ''
      : ` It ${tokens.slice(0, 3).join('; it ')}${tokens.length > 3 || facts.moreTokens === true ? '; and more, listed in the technical details' : ''}. A token's name is what its own contract claims.`;
  return `This is a transaction on ${networkName(facts.network)}: ${facts.action}. According to ${facts.provider}, the network ${STATUS[facts.status]} it.${activity} No zero-knowledge proof that this tool can read was found in it, so there is no proof to check.`;
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
    ...(facts.fee === undefined ? [] : ([['Fee charged', facts.fee]] as [string, string][])),
    ...(facts.memo === undefined ? [] : ([['Memo', facts.memo]] as [string, string][])),
    ...(facts.outcomes ?? []).map((line): [string, string] => ['Outcome', line]),
    ...(facts.tokens ?? []).map((line): [string, string] => ['Token activity', `It ${line}`]),
    ...(facts.moreTokens === true ? ([['Token activity', 'More token events were recorded than are listed here.']] as [string, string][]) : []),
  ];
}

/** The token activity alone, for a transaction whose proof is reported separately. */
export function plainActivity(facts: TransactionFacts): string | undefined {
  const tokens = facts.tokens ?? [];
  if (tokens.length === 0) return undefined;
  return `The transaction also ${tokens.slice(0, 3).join('; it ')}${tokens.length > 3 || facts.moreTokens === true ? '; and more, listed in the technical details' : ''}, according to ${facts.provider}.`;
}

export const renderFacts = (facts: TransactionFacts): string =>
  [`No supported proof found. What ${facts.provider} reported about the transaction, not checked by this tool:`, ...factLines(facts).map(([label, value]) => `  - ${label}: ${value}`)].join('\n');
