import type { ChainSource } from './chain/source.js';
import type { Report } from './report.js';
import type { VerifierIdentity } from './result.js';

/** How a network is named to a reader. */
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

const short = (hash: string): string => `${hash.slice(0, hash.startsWith('0x') ? 10 : 8)}…`;

function verifiers(verifier: VerifierIdentity): string {
  return verifier.alsoCheckedBy === undefined ? `${verifier.name} accepts it` : `${verifier.name} and ${verifier.alsoCheckedBy.name}, two independent verifiers, both accept it`;
}

function where(source: ChainSource): string {
  const network = NETWORK_NAMES[source.kind === 'stellar-transaction' ? source.network : source.chain] ?? (source.kind === 'stellar-transaction' ? source.network : source.chain);
  const decision = source.status === 'succeeded' ? 'accepted' : source.kind === 'stellar-transaction' ? 'failed' : 'reverted';
  return `It was found in transaction ${short(source.transaction)} on ${network}, according to ${source.provider}; the network ${decision} that transaction, which is the contract's own decision and separate from this check.`;
}

/**
 * Two to four sentences for a reader who will not read the report: whether
 * the proof is valid, what that says, and where it came from. Every
 * statement here is taken from the report; none says more than it does.
 */
export function plainWords(report: Report, source?: ChainSource): string {
  const found = source === undefined ? [] : [where(source)];
  if (report.outcome === 'unsupported' || report.outcome === 'error') {
    return [`This proof was not checked: ${report.outcome === 'unsupported' ? report.reason : report.message}. That says nothing about whether it is valid.`, ...found].join(' ');
  }
  if (report.outcome === 'invalid') {
    return ['The proof is not valid: the verifier rejected it, so it establishes nothing.', ...found].join(' ');
  }
  const sentences = [`The proof is valid: ${verifiers(report.verification.verifier)}.`];
  switch (report.basis) {
    case 'bundled-circuit':
    case 'recorded-circuit':
      sentences.push(`What it shows: ${report.claim}`);
      break;
    case 'supplied-key':
      sentences.push(
        report.keyRecognition.match === 'exact'
          ? `It was made for a circuit this tool has on record: ${report.keyRecognition.artifact.description}. This tool has no explanation of that circuit, so it cannot say in plain words what was proven.`
          : 'It fits the verification key that came with it, but that key is not one this tool knows, so this does not show what was proven.',
      );
      break;
    case 'cairo-program':
      sentences.push('It shows that a Cairo program with the hash shown below ran and gave the output shown; this tool does not know what that program does.');
      break;
    case 'risc-zero-program':
      sentences.push('It shows that a program with the image ID shown below ran in the RISC Zero virtual machine; this tool does not know what that program does.');
      break;
  }
  sentences.push(...found, 'It does not show who made the proof. The wording here has not been reviewed by a qualified person.');
  return sentences.join(' ');
}
