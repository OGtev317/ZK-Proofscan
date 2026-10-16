import type { TransactionFacts } from './chain/facts.js';
import { describeMovement, stellarAmount } from './chain/movement.js';

export interface TransactionStory {
  title: string;
  evidence: string;
  movements: { label: string; amount: string; from?: string; to?: string; kind: string }[];
  permissions: string[];
  contracts: string[];
  fee: string;
  notes: string[];
}

/** Recorded public effects, never a reconstruction of a private witness. */
export function transactionStory(facts: TransactionFacts): TransactionStory {
  const movements = facts.status === 'succeeded' ? (facts.movements ?? []) : [];
  const effects = movements.filter((m) => m.kind !== 'approve').length;
  const permissions = movements.filter((m) => m.kind === 'approve').length;
  const describe = (m: (typeof movements)[number]): string => describeMovement({ ...m, amount: BigInt(m.amount) });
  return {
    title: facts.status !== 'succeeded'
      ? 'The transaction failed; requested actions did not commit.'
      : facts.swaps?.[0]?.description ?? (facts.action.startsWith('a call to')
        ? `A contract call: ${effects} decoded asset movement${effects === 1 ? '' : 's'} and ${permissions} decoded spending permission${permissions === 1 ? '' : 's'}.`
        : facts.action),
    evidence: `Execution effects as reported by ${facts.provider}; not independently authenticated against consensus.`,
    movements: movements.filter((m) => m.kind !== 'approve').map((m) => ({ label: describe(m), amount: stellarAmount(BigInt(m.amount), m.asset), kind: m.kind, ...(m.from === undefined ? {} : { from: m.from }), ...(m.to === undefined ? {} : { to: m.to }) })),
    permissions: movements.filter((m) => m.kind === 'approve').map(describe),
    contracts: [...new Set([...(facts.to?.startsWith('C') ? [facts.to] : []), ...movements.flatMap((m) => m.tokenContract === undefined ? [] : [m.tokenContract])])],
    fee: facts.fee ?? 'Fee not available in the recorded data.',
    notes: [
      ...(facts.status === 'succeeded' && movements.length === 0 ? ['No structured token effects were available; this does not establish that no assets moved.'] : []),
      ...(facts.moreTokens ? ['Only the first token events are shown; this is not a complete balance calculation.'] : []),
      ...(facts.swaps ?? []).map((swap) => swap.identity),
      'Private witness values and hidden participants or amounts cannot be reconstructed from a proof.',
      'Recorded token movements are not a complete wallet balance or a safety verdict.',
      'A token contract can claim an asset name or issuer; an event label alone does not authenticate that claim.',
    ],
  };
}
