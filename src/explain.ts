import { plainFacts, type TransactionFacts } from './chain/facts.js';
import type { ChainSource } from './chain/source.js';
import { plainWords } from './plain.js';
import type { Report } from './report.js';

/**
 * A result laid out for a reader: what happened, the network's decision and
 * the proof check side by side, what the proof shows and what it does not.
 * Every line comes from the report, the source or the facts; nothing is
 * added that they do not establish.
 */
export interface Explained {
  happened: string;
  /** Absent for a proof checked from files, which has no transaction. */
  status?: { text: string; note: string };
  proofCheck: { text: string; tone: 'pass' | 'fail' | 'caution' };
  proves: string[];
  unknown: string[];
}

const STATUS_WORDS = { succeeded: 'Succeeded', reverted: 'Reverted', failed: 'Failed' } as const;
const statusOf = (status: keyof typeof STATUS_WORDS, provider: string): NonNullable<Explained['status']> => ({
  text: STATUS_WORDS[status],
  note: `As reported by ${provider}. Whether the network accepted the transaction is the contract's own decision, separate from the proof check.`,
});

export function explain(result: { report: Report; source?: ChainSource } | { facts: TransactionFacts }): Explained {
  if ('facts' in result) {
    const { facts } = result;
    return {
      happened: plainFacts(facts),
      status: statusOf(facts.status, facts.provider),
      proofCheck: { text: 'No supported proof found', tone: 'caution' },
      proves: ['Nothing about zero knowledge: this transaction holds no proof this tool can read.'],
      unknown: [],
    };
  }
  const { report, source } = result;
  const status = source === undefined ? undefined : statusOf(source.status, source.provider);
  const base = { happened: plainWords(report, source), ...(status === undefined ? {} : { status }) };
  if (report.outcome === 'unsupported' || report.outcome === 'error') {
    return { ...base, proofCheck: { text: 'Not checked', tone: 'caution' }, proves: ['Nothing was checked.'], unknown: ['Whether the proof is valid.'] };
  }
  if (report.outcome === 'invalid') {
    return { ...base, proofCheck: { text: 'Failed: the verifier rejected the proof', tone: 'fail' }, proves: ['Nothing. A rejected proof establishes nothing.'], unknown: [] };
  }
  const verifier = report.verification.verifier;
  const proofCheck = { text: verifier.alsoCheckedBy === undefined ? 'Passed' : 'Passed: two independent verifiers agree', tone: 'pass' as const };
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
