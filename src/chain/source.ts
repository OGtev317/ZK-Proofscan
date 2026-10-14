/**
 * Where a looked-up proof was found. Everything here is what a data provider
 * said. This tool does not check it: only the proof taken from the
 * transaction is verified, on this machine.
 */
export interface EvmSource {
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

/** Where a proof looked up on Stellar was found. Everything here is what the provider said. */
export interface StellarSource {
  kind: 'stellar-transaction';
  /** Host name of the provider that was asked. */
  provider: string;
  network: string;
  transaction: string;
  ledger: number;
  /** The contract the transaction called, as a C... address. */
  contract: string;
  /** SHA-256 of the contract's code, as the contract's storage names it. */
  contractCode: string;
  /** Whether the network accepted the transaction. Separate from the local check of the proof. */
  status: 'succeeded' | 'failed';
  /** Which known call the proof was read from. */
  call: string;
  /** Whether the key was read from a contract's storage, or found compiled into its code. */
  keyFrom: 'storage' | 'code';
  /** The contract that holds the key: the one called, or the verifier it names. */
  keyContract: string;
  /** SHA-256 of that contract's code. */
  keyContractCode: string;
  /** The last ledger at which anything that decides the key changed: the storage of the contracts involved. */
  keyLastChanged: number;
}

export type ChainSource = EvmSource | StellarSource;

const HASH = /^0x[0-9a-f]{64}$/;
const BARE_HASH = /^[0-9a-f]{64}$/;
const CONTRACT = /^C[A-Z2-7]{55}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const NAME = /^[a-z0-9][a-z0-9.-]{0,62}$/;
const whole = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Reads a source recorded in an export. Anything not exactly this shape is refused, since it gets printed. */
export function readChainSource(value: unknown): ChainSource | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const exactly = (names: string[]): boolean => Object.keys(raw).length === names.length && names.every((name) => Object.hasOwn(raw, name));
  const text = (entry: unknown, pattern: RegExp): entry is string => typeof entry === 'string' && pattern.test(entry);
  if (raw.kind === 'stellar-transaction') {
    if (!exactly(['kind', 'provider', 'network', 'transaction', 'ledger', 'contract', 'contractCode', 'status', 'call', 'keyFrom', 'keyContract', 'keyContractCode', 'keyLastChanged'])) return undefined;
    if (!text(raw.provider, NAME) || !text(raw.network, NAME) || !text(raw.call, NAME) || !text(raw.transaction, BARE_HASH) || !text(raw.contract, CONTRACT) || !text(raw.contractCode, BARE_HASH)) return undefined;
    if ((raw.keyFrom !== 'storage' && raw.keyFrom !== 'code') || !text(raw.keyContract, CONTRACT) || !text(raw.keyContractCode, BARE_HASH)) return undefined;
    if (!whole(raw.ledger) || !whole(raw.keyLastChanged) || (raw.status !== 'succeeded' && raw.status !== 'failed')) return undefined;
    return raw as unknown as StellarSource;
  }
  if (!exactly(['kind', 'provider', 'chain', 'chainId', 'transaction', 'blockNumber', 'blockHash', 'to', 'status', 'call', 'contractOnRecord'])) return undefined;
  if (raw.kind !== 'evm-transaction' || !text(raw.provider, NAME) || !text(raw.chain, NAME) || !text(raw.call, NAME)) return undefined;
  if (!whole(raw.chainId) || !whole(raw.blockNumber) || !text(raw.transaction, HASH) || !text(raw.blockHash, HASH) || !text(raw.to, ADDRESS)) return undefined;
  if ((raw.status !== 'succeeded' && raw.status !== 'reverted') || typeof raw.contractOnRecord !== 'boolean') return undefined;
  return raw as unknown as ChainSource;
}

/** The lines shown above a report for a proof that was looked up. */
export function renderChainSource(source: ChainSource, recorded = false): string {
  const heading = recorded
    ? 'Source recorded in the export (not checked by this rerun, and never checked by this tool):'
    : `Source, as reported by ${source.provider} and not checked by this tool:`;
  const closing = 'A provider can return any data. What follows is this tool\'s own check of the proof found in that data.';
  if (source.kind === 'stellar-transaction') {
    return [
      heading,
      `  - Transaction ${source.transaction} on ${source.network}`,
      `  - Ledger ${source.ledger}`,
      `  - Called contract ${source.contract}, whose code has SHA-256 ${source.contractCode}. This tool has no record of Stellar deployments.`,
      `  - Proof and public inputs read from a call to ${source.call}`,
      source.keyFrom === 'storage'
        ? `  - Verification key read from the storage of contract ${source.keyContract}`
        : `  - Verification key: a key recorded in this tool, every point of which appears in the code of ${source.keyContract} (code SHA-256 ${source.keyContractCode}), the verifier the called contract names. This tool did not check that the code uses those points`,
      `  - What decides that key last changed at ledger ${source.keyLastChanged}: ${
        source.keyLastChanged < source.ledger ? 'before the transaction, so it is the key used when the transaction ran' : 'NOT before the transaction, so it may not be the key used when the transaction ran'
      }`,
      `  - The network ${source.status === 'succeeded' ? 'accepted' : 'FAILED'} the transaction. That is the contract's decision, with its own rules, and is separate from the check below.`,
      closing,
    ].join('\n');
  }
  return [
    heading,
    `  - Transaction ${source.transaction} on ${source.chain} (chain id ${source.chainId})`,
    `  - Block ${source.blockNumber} (${source.blockHash})`,
    `  - Called contract ${source.to}, ${source.contractOnRecord ? 'a deployment this tool has on record for this call' : 'which is not a deployment this tool has on record'}`,
    `  - Proof read from a call to ${source.call}`,
    `  - The chain ${source.status === 'succeeded' ? 'accepted' : 'REVERTED'} the transaction. That is the contract's decision, with its own rules, and is separate from the check below.`,
    closing,
  ].join('\n');
}
