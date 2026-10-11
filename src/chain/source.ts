/**
 * Where a looked-up proof was found. Everything here is what a data provider
 * said. This tool does not check it: only the proof taken from the
 * transaction is verified, on this machine.
 */
export interface ChainSource {
  kind: 'evm-transaction';
  /** Host name of the provider that was asked. Never the address with its key. */
  provider: string;
  chain: string;
  chainId: number;
  transaction: string;
  blockNumber: number;
  blockHash: string;
  /** The contract the transaction called. */
  to: string;
  /** Whether the chain accepted the transaction. Separate from the local check of the proof. */
  status: 'succeeded' | 'reverted';
  /** Which known call shape the proof was read from. */
  call: string;
  /** Whether `to` is a deployment this tool has on record for that call. */
  contractOnRecord: boolean;
}

const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9.-]{0,62}$/;
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reads a source recorded in an export. Anything not exactly this shape is refused, since it gets printed. */
export function readChainSource(value: unknown): ChainSource | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const names = ['kind', 'provider', 'chain', 'chainId', 'transaction', 'blockNumber', 'blockHash', 'to', 'status', 'call', 'contractOnRecord'];
  if (Object.keys(raw).length !== names.length || !names.every((name) => Object.hasOwn(raw, name))) return undefined;
  const text = (entry: unknown, pattern: RegExp): entry is string => typeof entry === 'string' && pattern.test(entry);
  if (raw.kind !== 'evm-transaction' || !text(raw.provider, NAME) || !text(raw.chain, NAME) || !text(raw.call, NAME)) return undefined;
  if (!whole(raw.chainId) || !whole(raw.blockNumber) || !text(raw.transaction, HASH) || !text(raw.blockHash, HASH) || !text(raw.to, ADDRESS)) return undefined;
  if ((raw.status !== 'succeeded' && raw.status !== 'reverted') || typeof raw.contractOnRecord !== 'boolean') return undefined;
  return raw as unknown as ChainSource;
}

/** The lines shown above a report for a proof that was looked up. */
export function renderChainSource(source: ChainSource, recorded = false): string {
  return [
    recorded
      ? 'Source recorded in the export (not checked by this rerun, and never checked by this tool):'
      : `Source, as reported by ${source.provider} and not checked by this tool:`,
    `  - Transaction ${source.transaction} on ${source.chain} (chain id ${source.chainId})`,
    `  - Block ${source.blockNumber} (${source.blockHash})`,
    `  - Called contract ${source.to}, ${source.contractOnRecord ? 'a deployment this tool has on record for this call' : 'which is not a deployment this tool has on record'}`,
    `  - Proof read from a call to ${source.call}`,
    `  - The chain ${source.status === 'succeeded' ? 'accepted' : 'REVERTED'} the transaction. That is the contract's decision, with its own rules, and is separate from the check below.`,
    'A provider can return any data. What follows is this tool\'s own check of the proof found in that data.',
  ].join('\n');
}
