import { plainActivity, plainFacts, type TransactionFacts } from './chain/facts.js';
import type { ChainSource } from './chain/source.js';
import { plainWords } from './plain.js';
import type { Report } from './report.js';
import { verifierText } from './result.js';
import { networkName } from './chain/facts.js';

/**
 * A result laid out for a reader: what happened, the network's decision and
 * the proof check side by side, what the proof shows and what it does not.
 * Every line comes from the report, the source or the facts; nothing is
 * added that they do not establish.
 */
export interface Explained {
  happened: string;
  /** What the network data says: absent for a proof checked from files, which has no transaction. */
  status?: { text: string; note: string };
  /** Whether the proof passed here, and which verifiers said so. */
  proofCheck: { text: string; tone: 'pass' | 'fail' | 'caution'; detail?: string };
  /** Whether the transaction is settled: final, not checked, or not applicable. */
  settlement: { text: string; detail: string };
  proves: string[];
  unknown: string[];
}

const STATUS_WORDS = { succeeded: 'Succeeded', reverted: 'Reverted', failed: 'Failed' } as const;
const statusOf = (status: keyof typeof STATUS_WORDS, provider: string, network: string, position: string): NonNullable<Explained['status']> => ({
  text: STATUS_WORDS[status],
  note: `${networkName(network)}, ${position}, as reported by ${provider}. Whether the network accepted the transaction is the contract's own decision, separate from the proof check.`,
});
/** Finality as each network has it; nothing here is checked against the network. */
const settlementOf = (family: 'ethereum' | 'stellar' | undefined, position: string): Explained['settlement'] =>
  family === 'stellar'
    ? { text: 'Final', detail: `Included in ${position}. Stellar treats a closed ledger as final; that it closed is the provider's word.` }
    : family === 'ethereum'
      ? { text: 'Not checked', detail: `Included in ${position}. Whether that block is finalized, and for a rollup whether its batch was settled on Ethereum, was not checked.` }
      : { text: 'Not applicable', detail: 'A proof checked from files has no transaction to settle.' };

export function explain(result: { report: Report; source?: ChainSource; facts?: TransactionFacts } | { facts: TransactionFacts }): Explained {
  if (!('report' in result)) {
    const { facts } = result;
    const position = `${facts.family === 'stellar' ? 'ledger' : 'block'} ${facts.position}`;
    return {
      happened: plainFacts(facts),
      status: statusOf(facts.status, facts.provider, facts.network, position),
      proofCheck: { text: 'No supported proof found', tone: 'caution', detail: 'No proof this tool reads was in the transaction, so no verifier ran.' },
      settlement: settlementOf(facts.family, position),
      proves: ['Nothing about zero knowledge: this transaction holds no proof this tool can read.'],
      unknown: [],
    };
  }
  const { report, source } = result;
  const position = source === undefined ? '' : source.kind === 'stellar-transaction' ? `ledger ${source.ledger}` : `block ${source.blockNumber}`;
  const status = source === undefined ? undefined : statusOf(source.status, source.provider, source.kind === 'stellar-transaction' ? source.network : source.chain, position);
  const settlement = settlementOf(source === undefined ? undefined : source.kind === 'stellar-transaction' ? 'stellar' : 'ethereum', position);
  // The contract on the network that verifies, or carries, the proof, where the source names one.
  const onChain =
    source === undefined
      ? ''
      : source.kind === 'stellar-transaction'
        ? ` On the network: verifier contract ${source.keyContract} (code SHA-256 ${source.keyContractCode.slice(0, 16)}…).`
        : ` On the network: contract ${source.to}, ${source.contractOnRecord ? 'a deployment this tool has on record' : 'not a deployment this tool has on record'}.`;
  const activity = result.facts === undefined ? undefined : plainActivity(result.facts);
  const base = { happened: activity === undefined ? plainWords(report, source) : `${plainWords(report, source)} ${activity}`, ...(status === undefined ? {} : { status }), settlement };
  if (report.outcome === 'unsupported' || report.outcome === 'error') {
    return { ...base, proofCheck: { text: 'Not checked', tone: 'caution', detail: `No verifier gave an answer.${onChain}` }, proves: ['Nothing was checked.'], unknown: ['Whether the proof is valid.'] };
  }
  if (report.outcome === 'invalid') {
    return { ...base, proofCheck: { text: 'Failed: the verifier rejected the proof', tone: 'fail', detail: `Checked with ${verifierText(report.verification.verifier)}.${onChain}` }, proves: ['Nothing. A rejected proof establishes nothing.'], unknown: [] };
  }
  const verifier = report.verification.verifier;
  const proofCheck = { text: verifier.alsoCheckedBy === undefined ? 'Passed' : 'Passed: two independent verifiers agree', tone: 'pass' as const, detail: `Checked on this device with ${verifierText(verifier)}.${onChain}` };
  const unknown = [...report.limits];
  let proves: string[];
  if (report.basis === 'supplied-key') {
    if (report.keyRecognition.match === 'exact') {
      const { artifact } = report.keyRecognition;
      proves = [`The proof fits a key this tool has on record: ${artifact.description}.`, 'This tool has no explanation of that circuit, so it cannot say in plain words what was proven.'];
      // What is known about where the key came from belongs in front of the reader, not behind technical details.
      if (artifact.circuitLink.status !== 'established') unknown.unshift(`About the key: ${artifact.circuitLink.note}`);
    } else {
      proves = ['The proof fits the verification key that came with it. This tool does not know which circuit that key belongs to, so it cannot say what was proven.'];
    }
  } else {
    proves = [report.claim];
    if (report.basis === 'recorded-circuit' && report.keyRecognition.artifact.circuitLink.status !== 'established') unknown.unshift(`About the key: ${report.keyRecognition.artifact.circuitLink.note}`);
  }
  unknown.push('The explanation wording has not been reviewed by a qualified person.');
  return { ...base, proofCheck, proves, unknown };
}
