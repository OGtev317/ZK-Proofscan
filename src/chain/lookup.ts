import type { ProofInputs } from '../inputs.js';
import { readCall } from './calls.js';
import { RpcError, type Chain, type RpcClient } from './rpc.js';
import type { ChainSource } from './source.js';

export type Lookup =
  | { found: true; source: ChainSource; inputs: ProofInputs }
  | { found: false; reason: string };

const HASH = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const QUANTITY = /^0x(0|[1-9a-f][0-9a-f]{0,15})$/;
// Far more than any call read here; a larger input is some other transaction.
const MAX_INPUT_CHARACTERS = 16_384;

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const lower = (value: unknown, pattern: RegExp): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const text = value.toLowerCase();
  return pattern.test(text) ? text : undefined;
};

/**
 * Asks a provider for one transaction and reads a proof out of it, if the
 * transaction is a call this tool knows. Read-only: three requests, no
 * signing, nothing sent to the chain. `keyText` supplies a recorded key's
 * file when the call needs one. Nothing returned here is verified; the
 * caller checks the proof.
 */
export async function lookupTransaction(parts: { chain: Chain; transaction: string; rpc: RpcClient; keyText: (artifactId: string) => Promise<string> }): Promise<Lookup> {
  const { chain, rpc } = parts;
  const no = (reason: string): Lookup => ({ found: false, reason });
  const hash = lower(parts.transaction, HASH);
  if (hash === undefined) return no('a transaction is named by 0x and 64 hex digits');

  // A provider for another chain would answer about another transaction history.
  const chainId = lower(await rpc.call('eth_chainId', []), QUANTITY);
  if (chainId === undefined || Number(BigInt(chainId)) !== chain.chainId) return no(`the provider is not serving ${chain.name}`);

  const transaction = record(await rpc.call('eth_getTransactionByHash', [hash]));
  if (transaction === undefined) return no(`the provider has no such transaction on ${chain.name}`);
  if (lower(transaction.hash, HASH) !== hash) throw new RpcError('the provider answered about a different transaction');
  const blockHash = lower(transaction.blockHash, HASH);
  const blockNumber = lower(transaction.blockNumber, QUANTITY);
  if (blockHash === undefined || blockNumber === undefined) return no('the transaction is not in a block yet');
  const to = lower(transaction.to, ADDRESS);
  if (to === undefined) return no('the transaction creates a contract and calls none');
  if (typeof transaction.input !== 'string' || transaction.input.length > MAX_INPUT_CHARACTERS) return no('the transaction is not a call this tool reads a proof from');
  const read = readCall(transaction.input.toLowerCase());
  if (read === undefined) return no('the transaction is not a call this tool reads a proof from');

  const receipt = record(await rpc.call('eth_getTransactionReceipt', [hash]));
  const status = receipt === undefined ? undefined : lower(receipt.status, QUANTITY);
  if (receipt === undefined || lower(receipt.blockHash, HASH) !== blockHash || (status !== '0x1' && status !== '0x0')) {
    throw new RpcError('the provider gave no consistent receipt for the transaction');
  }

  const files = read.call.read(read.words);
  if (files === undefined) return no('the call does not hold a proof this tool reads');
  const inputs: ProofInputs = read.call.recordedKey === undefined ? files : { ...files, verificationKey: await parts.keyText(read.call.recordedKey) };
  return {
    found: true,
    inputs,
    source: {
      kind: 'evm-transaction',
      provider: rpc.provider,
      chain: chain.name,
      chainId: chain.chainId,
      transaction: hash,
      blockNumber: Number(BigInt(blockNumber)),
      blockHash,
      to,
      status: status === '0x1' ? 'succeeded' : 'reverted',
      call: read.call.id,
      contractOnRecord: read.call.deployments.some((deployment) => deployment.chainId === chain.chainId && deployment.address === to),
    },
  };
}
