import type { ProofInputs } from '../inputs.js';
import { readCall } from './calls.js';
import { RpcError, type Chain, type RpcClient } from './rpc.js';
import type { TransactionFacts } from './facts.js';
import type { ChainSource } from './source.js';

/**
 * A proof found in a transaction, or why none was. When the transaction was
 * read but holds no proof this tool reads, `facts` says what it was.
 */
export type Lookup =
  | { found: true; source: ChainSource; inputs: ProofInputs }
  | { found: false; reason: string; facts?: TransactionFacts };

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
  const from = lower(transaction.from, ADDRESS);
  if (from === undefined || (transaction.to !== null && transaction.to !== undefined && to === undefined)) throw new RpcError('the provider described the transaction in a form this tool does not read');

  const receipt = record(await rpc.call('eth_getTransactionReceipt', [hash]));
  const status = receipt === undefined ? undefined : lower(receipt.status, QUANTITY);
  if (receipt === undefined || lower(receipt.blockHash, HASH) !== blockHash || (status !== '0x1' && status !== '0x0')) {
    throw new RpcError('the provider gave no consistent receipt for the transaction');
  }

  // Read but holding no proof this tool reads: say what the transaction was.
  const input = typeof transaction.input === 'string' ? transaction.input.toLowerCase() : '';
  const facts = (): TransactionFacts => ({
    family: 'ethereum',
    provider: rpc.provider,
    network: chain.name,
    transaction: hash,
    position: Number(BigInt(blockNumber)),
    status: status === '0x1' ? 'succeeded' : 'reverted',
    from,
    action: describeCall(to, input, transaction.value, chain.name),
    ...(to === undefined ? {} : { to }),
  });
  const notRead = (reason: string): Lookup => ({ found: false, reason, facts: facts() });
  if (to === undefined) return notRead('the transaction creates a contract and calls none');
  if (input.length > MAX_INPUT_CHARACTERS) return notRead('the transaction is not a call this tool reads a proof from');
  const read = readCall(input);
  if (read === undefined) return notRead('the transaction is not a call this tool reads a proof from');

  const files = read.call.read(read.words);
  if (files === undefined) return notRead('the call does not hold a proof this tool reads');
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

/** The coin each chain pays in, for a plain transfer. */
const COIN: Record<string, string> = { polygon: 'POL' };

/** What an Ethereum transaction did, from its recipient, call data and value. */
function describeCall(to: string | undefined, input: string, value: unknown, chain: string): string {
  if (to === undefined) return 'the creation of a contract';
  let amount = '';
  if (typeof value === 'string' && QUANTITY.test(value.toLowerCase()) && BigInt(value) > 0n) {
    const wei = BigInt(value);
    const whole = wei / 10n ** 18n;
    const fraction = (wei % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '');
    amount = `${whole}${fraction === '' ? '' : `.${fraction}`} ${COIN[chain] ?? 'ETH'}`;
  }
  if (input === '0x' || input === '') return amount === '' ? `an empty transaction to ${to}` : `a transfer of ${amount} to ${to}`;
  const selector = /^0x[0-9a-f]{8}/.exec(input)?.[0];
  return `a call to contract ${to}${selector === undefined ? '' : `, function ${selector}`}${amount === '' ? '' : `, sending ${amount}`}`;
}
