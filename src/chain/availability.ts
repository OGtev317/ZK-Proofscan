import type { Lookup } from './lookup.js';
import { RpcError, type RpcClient } from './rpc.js';

export interface ProviderAttempt {
  provider: string;
  result: 'found' | 'not-found' | 'unavailable' | 'not-read';
  window?: { oldestLedger: number; latestLedger: number; ledgerRetentionWindow?: number };
}
export interface LookupAvailability { attempts: ProviderAttempt[]; note: string }
export function availabilityText(value: LookupAvailability): string {
  return ['Provider availability (as reported):', ...value.attempts.map((attempt) => `  ${attempt.provider}: ${attempt.result}${attempt.window === undefined ? '; history window unavailable' : `; ledgers ${attempt.window.oldestLedger}-${attempt.window.latestLedger}`}`), value.note].join('\n');
}
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export async function providerWindow(rpc: RpcClient): Promise<ProviderAttempt['window']> {
  try {
    const value = await rpc.call('getHealth', {}) as Record<string, unknown>;
    if (!value || !integer(value.oldestLedger) || !integer(value.latestLedger) || value.oldestLedger > value.latestLedger) return undefined;
    return { oldestLedger: value.oldestLedger, latestLedger: value.latestLedger, ...(integer(value.ledgerRetentionWindow) ? { ledgerRetentionWindow: value.ledgerRetentionWindow } : {}) };
  } catch { return undefined; }
}

/** Only a caller-provided fallback is tried; no silent third-party selection. */
export async function withStellarAvailability(primary: RpcClient, archive: RpcClient | undefined, read: (rpc: RpcClient) => Promise<Lookup>): Promise<Lookup> {
  const attempts: ProviderAttempt[] = [];
  const providers = [primary, ...(archive === undefined || archive === primary ? [] : [archive])];
  for (const [index, rpc] of providers.entries()) {
    const canRetry = index + 1 < providers.length;
    let result: Lookup;
    try { result = await read(rpc); }
    catch {
      attempts.push({ provider: rpc.provider, result: 'unavailable' });
      if (canRetry) continue;
      return { found: false, reason: 'the selected Stellar providers could not complete the lookup; no proof verdict was produced', availability: { attempts, note: 'Provider failure is not evidence of an invalid proof.' } };
    }
    const window = await providerWindow(rpc);
    const missing = !result.found && result.facts === undefined && result.reason.startsWith('the provider has no such transaction');
    attempts.push({ provider: rpc.provider, result: result.found || result.facts !== undefined ? 'found' : missing ? 'not-found' : 'not-read', ...(window === undefined ? {} : { window }) });
    if (missing && canRetry) continue;
    return { ...result, availability: { attempts, note: 'Provider-reported availability. Not found can mean an unretained, unknown, or not-yet-recorded transaction; it is not a proof failure. Archive ledger history does not guarantee transaction-by-hash or historical key availability.' } };
  }
  throw new RpcError('no Stellar provider was selected');
}
