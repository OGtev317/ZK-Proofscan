import { Address, Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-base';
import { binaryPart, MAX_PUBLIC_INPUTS, type ProofInputs } from '../inputs.js';
import type { Lookup } from './lookup.js';
import { RpcError, type RpcClient } from './rpc.js';

/** A Stellar network this tool reads. Only the test network is approved. */
export interface StellarNetwork {
  name: string;
  passphrase: string;
  /** The public RPC used when the operator names none. */
  defaultRpc: string;
}

export const STELLAR_NETWORKS: readonly StellarNetwork[] = [
  { name: 'stellar-testnet', passphrase: Networks.TESTNET, defaultRpc: 'https://soroban-testnet.stellar.org' },
];

/** The library that reads Stellar's transaction format. A test checks this against the installed package. */
export const STELLAR_BASE_VERSION = '15.0.0';

/**
 * Soroban calls this tool reads a proof from. Each names the contract
 * function, and where in the contract's storage its verification key is.
 */
interface SorobanCall {
  id: string;
  /** Who publishes the contract, and what it is. */
  description: string;
  function: string;
  /** The instance storage entry, a symbol, that holds the key as bytes. */
  keySymbol: string;
}
export const SOROBAN_CALLS: readonly SorobanCall[] = [
  {
    id: 'nethermind-ultrahonk.verify-proof',
    description: "Nethermind's UltraHonk verifier contract for Soroban (rs-soroban-ultrahonk), which checks Barretenberg 0.87.0 Keccak proofs",
    function: 'verify_proof',
    keySymbol: 'vk',
  },
];

const HASH = /^[0-9a-f]{64}$/;
// Far more than any call read here; a larger envelope is some other transaction.
const MAX_ENVELOPE_CHARACTERS = 262_144;
const MAX_PROOF_BYTES = 49_152;
const MAX_KEY_BYTES = 16_384;

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

/** The operations of a transaction, through a fee bump if there is one. */
function operations(envelope: xdr.TransactionEnvelope): xdr.Operation[] | undefined {
  switch (envelope.switch().name) {
    case 'envelopeTypeTx':
      return envelope.v1().tx().operations();
    case 'envelopeTypeTxFeeBump':
      return envelope.feeBump().tx().innerTx().v1().tx().operations();
    default:
      return undefined;
  }
}

/**
 * Asks a Stellar RPC for one transaction and reads a proof out of it, if it
 * is a call this tool knows, together with the verification key the called
 * contract holds. Read-only: three requests, no signing, nothing sent to
 * the network. Nothing returned here is verified; the caller checks the proof.
 */
export async function lookupStellarTransaction(parts: { network: StellarNetwork; transaction: string; rpc: RpcClient }): Promise<Lookup> {
  const { network, rpc } = parts;
  const no = (reason: string): Lookup => ({ found: false, reason });
  const hash = typeof parts.transaction === 'string' ? parts.transaction.toLowerCase() : '';
  if (!HASH.test(hash)) return no('a Stellar transaction is named by 64 hex digits');

  // A provider for another network would answer about another history.
  const about = record(await rpc.call('getNetwork', {}));
  if (about?.passphrase !== network.passphrase) return no(`the provider is not serving ${network.name}`);

  const transaction = record(await rpc.call('getTransaction', { hash }));
  if (transaction === undefined) throw new RpcError('the provider did not describe the transaction');
  if (transaction.status === 'NOT_FOUND') return no(`the provider has no such transaction on ${network.name}; a public Stellar RPC keeps only about the last week`);
  if (transaction.status !== 'SUCCESS' && transaction.status !== 'FAILED') throw new RpcError('the provider gave the transaction no known status');
  const ledger = whole(transaction.ledger);
  if (ledger === undefined || ledger === 0) throw new RpcError('the provider gave no ledger for the transaction');
  if (typeof transaction.envelopeXdr !== 'string' || transaction.envelopeXdr.length > MAX_ENVELOPE_CHARACTERS) return no('the transaction is not a call this tool reads a proof from');

  let envelope: xdr.TransactionEnvelope;
  let computed: string;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(transaction.envelopeXdr, 'base64');
    computed = hex(TransactionBuilder.fromXDR(envelope, network.passphrase).hash());
  } catch {
    throw new RpcError('the provider sent a transaction that cannot be read');
  }
  // The hash is computed here from what was sent, so the transaction read is the one asked for.
  if (computed !== hash) throw new RpcError('the provider answered about a different transaction');

  const ops = operations(envelope);
  if (ops === undefined || ops.length !== 1 || ops[0]!.body().switch().name !== 'invokeHostFunction') return no('the transaction is not a call this tool reads a proof from');
  const host = ops[0]!.body().invokeHostFunctionOp().hostFunction();
  if (host.switch().name !== 'hostFunctionTypeInvokeContract') return no('the transaction is not a call this tool reads a proof from');
  const invoked = host.invokeContract();
  const call = SOROBAN_CALLS.find((known) => known.function === invoked.functionName().toString());
  const args = invoked.args();
  if (call === undefined || args.length !== 2 || !args.every((arg) => arg.switch().name === 'scvBytes')) return no('the transaction is not a call this tool reads a proof from');
  const [publicInputs, proof] = args.map((arg) => new Uint8Array(arg.bytes())) as [Uint8Array, Uint8Array];
  if (publicInputs.length % 32 !== 0 || publicInputs.length / 32 > MAX_PUBLIC_INPUTS || proof.length === 0 || proof.length > MAX_PROOF_BYTES) return no('the call does not hold a proof this tool reads');
  const contract = Address.fromScAddress(invoked.contractAddress()).toString();
  if (!StrKey.isValidContract(contract)) return no('the transaction is not a call this tool reads a proof from');

  // The key is not in the transaction: the contract keeps it in its own storage.
  const instanceKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({ contract: invoked.contractAddress(), key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent() }),
  );
  const stored = record(await rpc.call('getLedgerEntries', { keys: [instanceKey.toXDR('base64')] }));
  const entries = stored?.entries;
  if (!Array.isArray(entries) || entries.length > 1) throw new RpcError('the provider gave no consistent answer for the contract\'s storage');
  if (entries.length === 0) return no('the provider holds no storage for the contract that was called, so its verification key cannot be read');
  const entry = record(entries[0]);
  const keyLastChanged = whole(entry?.lastModifiedLedgerSeq);
  if (entry === undefined || typeof entry.xdr !== 'string' || keyLastChanged === undefined || (typeof entry.key === 'string' && entry.key !== instanceKey.toXDR('base64'))) {
    throw new RpcError('the provider gave no consistent answer for the contract\'s storage');
  }
  let key: Uint8Array | undefined;
  let contractCode: string;
  try {
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64').contractData();
    if (Address.fromScAddress(data.contract()).toString() !== contract || data.key().switch().name !== 'scvLedgerKeyContractInstance') throw new Error('other entry');
    const instance = data.val().instance();
    const executable = instance.executable();
    if (executable.switch().name !== 'contractExecutableWasm') return no('the contract that was called is not one this tool reads a key from');
    contractCode = hex(executable.wasmHash());
    for (const item of instance.storage() ?? []) {
      if (item.key().switch().name === 'scvSymbol' && item.key().sym().toString() === call.keySymbol && item.val().switch().name === 'scvBytes') key = new Uint8Array(item.val().bytes());
    }
  } catch {
    throw new RpcError('the provider sent contract storage that cannot be read');
  }
  if (key === undefined || key.length === 0 || key.length > MAX_KEY_BYTES) return no(`the contract that was called holds no verification key under "${call.keySymbol}"`);

  const inputs: ProofInputs = { proof: binaryPart(proof), publicInputs: binaryPart(publicInputs), verificationKey: binaryPart(key) };
  return {
    found: true,
    inputs,
    source: {
      kind: 'stellar-transaction',
      provider: rpc.provider,
      network: network.name,
      transaction: hash,
      ledger,
      contract,
      contractCode,
      status: transaction.status === 'SUCCESS' ? 'succeeded' : 'failed',
      call: call.id,
      keyLastChanged,
    },
  };
}
