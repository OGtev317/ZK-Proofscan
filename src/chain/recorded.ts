import { RpcError, type RpcClient } from './rpc.js';

/**
 * A provider that answers from a provider's recorded answers instead of the
 * network: each method maps to the answer that was received, and
 * `getLedgerEntries` may be recorded per ledger key asked for. A request
 * with no recorded answer is refused, never invented.
 */
export function recordedRpc(answers: Record<string, unknown>, provider: string): RpcClient {
  return {
    provider,
    async call(method, params) {
      const answer = answers[method];
      if (answer === undefined) throw new RpcError('the saved example holds no answer for this request');
      if (method !== 'getLedgerEntries' || typeof answer !== 'object' || answer === null || 'entries' in answer) return answer;
      const key = (params as { keys?: unknown[] }).keys?.[0];
      const keyed = typeof key === 'string' ? (answer as Record<string, unknown>)[key] : undefined;
      if (keyed === undefined) throw new RpcError('the saved example holds no answer for this request');
      return keyed;
    },
  };
}
