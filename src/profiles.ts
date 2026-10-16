import type { AdapterReview } from './adapter.js';
import type { KeyRegistry } from './registry.js';
import type { Report } from './report.js';
import { verifierText } from './result.js';
import type { ChainSource } from './chain/source.js';

export interface ProofProfile {
  title: string;
  purpose: string;
  verifier: string;
  inputs: { name: string; meaning: string }[];
  limits: string[];
  registryReview: string;
  explanationReview: string;
  key?: string;
  circuitSource?: string;
  deployment?: { network: string; contract: string; codeHash?: string; identity: string };
}

/** Review is never inferred from a passing proof or a known key. */
export function reviewText(review: AdapterReview | undefined): string {
  if (review?.status !== 'reviewed' || !review.reviewer || !/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? '')) return `NOT REVIEWED${review?.note ? `: ${review.note}` : ''}`;
  return `Recorded review by ${review.reviewer}, ${review.date}: ${review.note}. Reviewer qualifications and the review itself are not authenticated by this tool.`;
}

/** Build profiles from the pinned registry, not a second editable list of claims. */
export function circuitDirectory(registry: KeyRegistry): { id: string; title: string; source: string; keys: string[]; link: string; review: string; explanation: string }[] {
  return registry.artifacts.map((artifact) => ({
    id: artifact.id, title: artifact.description, source: artifact.circuit.source,
    keys: artifact.keys.map((key) => key.label), link: `${artifact.circuitLink.status}: ${artifact.circuitLink.note}`,
    review: reviewText(artifact.entryReview),
    explanation: artifact.explanationAdapter === null ? 'No explanation is recorded.' : `Explanation adapter: ${artifact.explanationAdapter}; its review is separate from the registry entry.`,
  }));
}

export function proofProfile(report: Report, source?: ChainSource): ProofProfile | undefined {
  if (report.outcome !== 'valid' && report.outcome !== 'invalid') return undefined;
  const recognized = 'keyRecognition' in report && report.keyRecognition.match === 'exact' ? report.keyRecognition : undefined;
  const named = report.outcome === 'valid' && (report.basis === 'bundled-circuit' || report.basis === 'recorded-circuit') ? report : undefined;
  const title = recognized?.artifact.description ?? (named === undefined ? 'Unknown circuit or program' : named.explanation.circuit.name);
  const deployment = source === undefined ? {} : {
    deployment: source.kind === 'stellar-transaction'
      ? { network: source.network, contract: source.keyContract, codeHash: source.keyContractCode, identity: 'Provider-reported deployment; official identity not established. Hash-bound code and key timing are described in the source report.' }
      : { network: source.chain, contract: source.to, identity: source.contractOnRecord ? 'Deployment on record; not a security audit.' : 'Deployment identity not established.' },
  };
  return {
    title,
    purpose: named?.claim ?? (report.outcome === 'invalid' ? 'No claim established: the proof was rejected.' : 'The proof fits its key or program parameters; its application meaning is not known.'),
    verifier: verifierText(report.verification.verifier),
    inputs: named?.public.map(({ name, meaning }) => ({ name, meaning })) ?? [],
    limits: report.outcome === 'valid' ? report.limits : ['An invalid proof establishes no claim.'],
    registryReview: reviewText(recognized?.artifact.entryReview),
    explanationReview: reviewText(report.outcome === 'valid' ? report.explanation.review : undefined),
    ...(recognized === undefined ? {} : { key: recognized.key, circuitSource: recognized.artifact.circuit.source }),
    ...deployment,
  };
}
