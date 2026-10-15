import { Address, Networks, scValToNative, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-base';
import { binaryPart, MAX_PUBLIC_INPUTS, type ProofInputs } from '../inputs.js';
import { sha256Hex } from '../sha256.js';
import type { Lookup } from './lookup.js';
import { RpcError, type RpcClient } from './rpc.js';
import type { StellarSource } from './source.js';
import type { StellarAssetInfo } from './stellar-assets.js';
import type { TransactionFacts } from './facts.js';
import { describeMovement, readStellarActivity } from './stellar-activity.js';

/** A Stellar network this tool reads. Reading only: the owner approved the test network, then the main network, on 2026-10-14 and 2026-10-15. */
export interface StellarNetwork {
  name: string;
  passphrase: string;
  /** The environment variable in which the operator names an RPC. */
  rpcVariable: string;
  /**
   * The RPC used when the operator names none. The main network has none:
   * the Stellar Development Foundation runs no public RPC for it, and this
   * tool does not choose a company to send transaction hashes to.
   */
  defaultRpc?: string;
}

export const STELLAR_NETWORKS: readonly StellarNetwork[] = [
  { name: 'stellar-testnet', passphrase: Networks.TESTNET, rpcVariable: 'STELLAR_RPC_URL', defaultRpc: 'https://soroban-testnet.stellar.org' },
  { name: 'stellar-mainnet', passphrase: Networks.PUBLIC, rpcVariable: 'STELLAR_MAINNET_RPC_URL' },
];

/** The library that reads Stellar's transaction format. A test checks this against the installed package. */
export const STELLAR_BASE_VERSION = '15.0.0';

/** A recorded key file, by its registry artifact. */
export interface RecordedKey {
  artifactId: string;
  text: string;
}

/** Soroban calls this tool reads a proof from. */
export const SOROBAN_CALLS = {
  ultraHonk: {
    id: 'nethermind-ultrahonk.verify-proof',
    function: 'verify_proof',
    description: "Nethermind's UltraHonk verifier contract for Soroban (rs-soroban-ultrahonk), which checks Barretenberg 0.87.0 Keccak proofs and keeps its key in its storage",
  },
  privatePayments: {
    id: 'stellar-private-payments.transact',
    function: 'transact',
    description: "a pool contract of Nethermind's Stellar Private Payments, whose Groth16 verifier contract has its key compiled into its code",
  },
} as const;

/**
 * The commit of Stellar Private Payments whose pool code was read for the
 * order of the public inputs: `contracts/pool/src/pool.rs`, `verify_proof`.
 */
export const PRIVATE_PAYMENTS_POOL_COMMIT = '0471e6be8161c2013cfc8387bd7b72b70e480cf5';
// The pool's policy bits, from `contracts/pool-core/src/policy.rs` at that commit.
const ALLOWLIST_BIT = 1;
const BLOCKLIST_BIT = 2;
const POOL_PROOF_FIELDS = ['asp_membership_root', 'asp_non_membership_root', 'ext_data_hash', 'input_nullifiers', 'output_commitment0', 'output_commitment1', 'proof', 'public_amount', 'root'];

const HASH = /^[0-9a-f]{64}$/;
// Far more than any call read here; a larger envelope is some other transaction.
const MAX_ENVELOPE_CHARACTERS = 262_144;
const MAX_PROOF_BYTES = 49_152;
const MAX_KEY_BYTES = 16_384;
const MAX_CODE_BYTES = 1_048_576;

const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);
const hex = (bytes: Uint8Array): string => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
const word = (value: bigint): Uint8Array => Uint8Array.from(value.toString(16).padStart(64, '0').match(/../g)!, (pair) => Number.parseInt(pair, 16));
const number = (bytes: Uint8Array): bigint => BigInt(`0x${hex(bytes) || '0'}`);

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

/** Not a call this tool reads; not a fault in the provider. */
class NotRead extends Error {}

/** A contract's instance: its code's hash, its storage, and the ledger at which either last changed. */
interface Instance {
  code: Uint8Array;
  /** The same hash as the library holds it, to name the code in a further request. */
  codeKey: ReturnType<xdr.ContractExecutable['wasmHash']>;
  storage: xdr.ScMapEntry[];
  lastChanged: number;
}
async function readInstance(rpc: RpcClient, contract: xdr.ScAddress): Promise<Instance | undefined> {
  const key = xdr.LedgerKey.contractData(new xdr.LedgerKeyContractData({ contract, key: xdr.ScVal.scvLedgerKeyContractInstance(), durability: xdr.ContractDataDurability.persistent() })).toXDR('base64');
  const entry = await oneEntry(rpc, key);
  if (entry === undefined) return undefined;
  try {
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64').contractData();
    if (!data.contract().toXDR().equals(contract.toXDR()) || data.key().switch().name !== 'scvLedgerKeyContractInstance') throw new Error('other entry');
    const instance = data.val().instance();
    if (instance.executable().switch().name !== 'contractExecutableWasm') throw new NotRead('the contract that was called is not one this tool reads a key from');
    const codeKey = instance.executable().wasmHash();
    return { code: new Uint8Array(codeKey), codeKey, storage: instance.storage() ?? [], lastChanged: entry.lastChanged };
  } catch (error) {
    if (error instanceof NotRead) throw error;
    throw new RpcError('the provider sent contract storage that cannot be read');
  }
}
// The library's own byte type is passed back to it: a browser has no global Buffer.
async function readCode(rpc: RpcClient, codeKey: Instance['codeKey']): Promise<Uint8Array> {
  const codeHash = new Uint8Array(codeKey);
  const key = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: codeKey })).toXDR('base64');
  const entry = await oneEntry(rpc, key);
  if (entry === undefined) throw new NotRead('the provider holds no code for the verifier contract');
  let code: Uint8Array;
  try {
    const data = xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64').contractCode();
    code = new Uint8Array(data.code());
  } catch {
    throw new RpcError('the provider sent contract code that cannot be read');
  }
  // Code is stored under its own hash, so the provider cannot send other code under this one.
  if (code.length > MAX_CODE_BYTES || sha256Hex(code) !== hex(codeHash)) throw new RpcError('the provider sent contract code that does not match its hash');
  return code;
}
async function oneEntry(rpc: RpcClient, key: string): Promise<{ xdr: string; lastChanged: number } | undefined> {
  const stored = record(await rpc.call('getLedgerEntries', { keys: [key] }));
  const entries = stored?.entries;
  if (!Array.isArray(entries) || entries.length > 1) throw new RpcError('the provider gave no consistent answer for the contract\'s storage');
  if (entries.length === 0) return undefined;
  const entry = record(entries[0]);
  const lastChanged = whole(entry?.lastModifiedLedgerSeq);
  if (entry === undefined || typeof entry.xdr !== 'string' || lastChanged === undefined || (typeof entry.key === 'string' && entry.key !== key)) {
    throw new RpcError('the provider gave no consistent answer for the contract\'s storage');
  }
  return { xdr: entry.xdr, lastChanged };
}

/** An entry of a contract's storage whose key is a symbol, or a one-symbol enum case such as `DataKey::Verifier`. */
function stored(storage: xdr.ScMapEntry[], name: string): xdr.ScVal | undefined {
  for (const item of storage) {
    const key = item.key();
    const symbol = key.switch().name === 'scvSymbol' ? key.sym().toString() : key.switch().name === 'scvVec' && key.vec()?.length === 1 && key.vec()![0]!.switch().name === 'scvSymbol' ? key.vec()![0]!.sym().toString() : undefined;
    if (symbol === name) return item.val();
  }
  return undefined;
}

interface Read {
  inputs: ProofInputs;
  call: string;
  keyFrom: StellarSource['keyFrom'];
  keyContract: xdr.ScAddress;
  keyContractCode: Uint8Array;
  keyLastChanged: number;
  calledCode: Uint8Array;
}

/** `verify_proof(public_inputs, proof)` on the UltraHonk verifier, whose key is in its storage under `vk`. */
async function readUltraHonkCall(rpc: RpcClient, contract: xdr.ScAddress, args: xdr.ScVal[]): Promise<Read> {
  if (args.length !== 2 || !args.every((arg) => arg.switch().name === 'scvBytes')) throw new NotRead('the transaction is not a call this tool reads a proof from');
  const [publicInputs, proof] = args.map((arg) => new Uint8Array(arg.bytes())) as [Uint8Array, Uint8Array];
  if (publicInputs.length % 32 !== 0 || publicInputs.length / 32 > MAX_PUBLIC_INPUTS || proof.length === 0 || proof.length > MAX_PROOF_BYTES) throw new NotRead('the call does not hold a proof this tool reads');
  // The key is not in the transaction: the contract keeps it in its own storage.
  const instance = await readInstance(rpc, contract);
  if (instance === undefined) throw new NotRead('the provider holds no storage for the contract that was called, so its verification key cannot be read');
  const value = stored(instance.storage, 'vk');
  const key = value?.switch().name === 'scvBytes' ? new Uint8Array(value.bytes()) : undefined;
  if (key === undefined || key.length === 0 || key.length > MAX_KEY_BYTES) throw new NotRead('the contract that was called holds no verification key under "vk"');
  return {
    inputs: { proof: binaryPart(proof), publicInputs: binaryPart(publicInputs), verificationKey: binaryPart(key) },
    call: SOROBAN_CALLS.ultraHonk.id,
    keyFrom: 'storage',
    keyContract: contract,
    keyContractCode: instance.code,
    keyLastChanged: instance.lastChanged,
    calledCode: instance.code,
  };
}

/** A key's points in Soroban's byte layout: G1 as x then y, G2 as x.c1, x.c0, y.c1, y.c0, each 32 bytes big-endian. */
function keyPoints(text: string): { points: Uint8Array[]; publicCount: number } | undefined {
  try {
    const key = JSON.parse(text) as { vk_alpha_1: string[]; vk_beta_2: string[][]; vk_gamma_2: string[][]; vk_delta_2: string[][]; IC: string[][]; nPublic: number };
    const g1 = (point: string[]): Uint8Array => new Uint8Array([...word(BigInt(point[0]!)), ...word(BigInt(point[1]!))]);
    const g2 = (point: string[][]): Uint8Array => new Uint8Array([...word(BigInt(point[0]![1]!)), ...word(BigInt(point[0]![0]!)), ...word(BigInt(point[1]![1]!)), ...word(BigInt(point[1]![0]!))]);
    return { points: [g1(key.vk_alpha_1), g2(key.vk_beta_2), g2(key.vk_gamma_2), g2(key.vk_delta_2), ...key.IC.map(g1)], publicCount: key.nPublic };
  } catch {
    return undefined;
  }
}
const contains = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  outer: for (let at = 0; at + needle.length <= haystack.length; at++) {
    for (let i = 0; i < needle.length; i++) if (haystack[at + i] !== needle[i]) continue outer;
    return true;
  }
  return false;
};

/**
 * `transact(proof, ext_data, sender)` on a Stellar Private Payments pool. The
 * pool names its verifier contract and policy in its storage; the verifier
 * has its key compiled into its code. The key used is the one recorded key
 * whose every point appears in that code. Public inputs are assembled in the
 * order the pool passes them, which depends on its policy.
 */
async function readPoolCall(rpc: RpcClient, contract: xdr.ScAddress, args: xdr.ScVal[], recordedKeys: () => Promise<RecordedKey[]>): Promise<Read> {
  const notThis = new NotRead('the transaction is not a call this tool reads a proof from');
  if (args.length !== 3 || args[0]!.switch().name !== 'scvMap') throw notThis;
  const fields = new Map<string, xdr.ScVal>();
  for (const entry of args[0]!.map() ?? []) {
    if (entry.key().switch().name !== 'scvSymbol') throw notThis;
    fields.set(entry.key().sym().toString(), entry.val());
  }
  if (fields.size !== POOL_PROOF_FIELDS.length || !POOL_PROOF_FIELDS.every((name) => fields.has(name))) throw notThis;
  const u256 = (value: xdr.ScVal | undefined): bigint => {
    if (value?.switch().name !== 'scvU256') throw notThis;
    return scValToNative(value) as bigint;
  };
  const points = new Map<string, Uint8Array>();
  const proofValue = fields.get('proof')!;
  if (proofValue.switch().name !== 'scvMap') throw notThis;
  for (const entry of proofValue.map() ?? []) {
    if (entry.key().switch().name !== 'scvSymbol' || entry.val().switch().name !== 'scvBytes') throw notThis;
    points.set(entry.key().sym().toString(), new Uint8Array(entry.val().bytes()));
  }
  const [a, b, c] = [points.get('a'), points.get('b'), points.get('c')];
  if (points.size !== 3 || a?.length !== 64 || b?.length !== 128 || c?.length !== 64) throw new NotRead('the call does not hold a proof this tool reads');
  const nullifierValues = fields.get('input_nullifiers')!;
  if (nullifierValues.switch().name !== 'scvVec' || (nullifierValues.vec() ?? []).length === 0 || (nullifierValues.vec() ?? []).length > 16) throw notThis;
  const nullifiers = (nullifierValues.vec() ?? []).map(u256);
  const extDataHash = fields.get('ext_data_hash')!;
  if (extDataHash.switch().name !== 'scvBytes' || extDataHash.bytes().length !== 32) throw notThis;

  const pool = await readInstance(rpc, contract);
  if (pool === undefined) throw new NotRead('the provider holds no storage for the pool that was called');
  const verifierValue = stored(pool.storage, 'Verifier');
  const flagsValue = stored(pool.storage, 'PolicyFlags');
  if (verifierValue?.switch().name !== 'scvAddress' || flagsValue?.switch().name !== 'scvU32') throw new NotRead('the contract that was called does not name a verifier and policy the way a Stellar Private Payments pool does');
  const flags = flagsValue.u32();
  const verifier = await readInstance(rpc, verifierValue.address());
  if (verifier === undefined) throw new NotRead('the provider holds no storage for the pool\'s verifier contract');
  const code = await readCode(rpc, verifier.codeKey);

  // The pool's order: root, amount, external data hash, nullifiers, the two
  // output commitments, then the membership and non-membership roots once
  // per nullifier when its policy requires them.
  const inputs: bigint[] = [u256(fields.get('root')), u256(fields.get('public_amount')), number(new Uint8Array(extDataHash.bytes())), ...nullifiers, u256(fields.get('output_commitment0')), u256(fields.get('output_commitment1'))];
  if (flags & ALLOWLIST_BIT) for (const _ of nullifiers) inputs.push(u256(fields.get('asp_membership_root')));
  if (flags & BLOCKLIST_BIT) for (const _ of nullifiers) inputs.push(u256(fields.get('asp_non_membership_root')));

  const found = (await recordedKeys()).filter((recorded) => {
    const read = keyPoints(recorded.text);
    return read !== undefined && read.publicCount === inputs.length && read.points.every((point) => contains(code, point));
  });
  if (found.length !== 1) throw new NotRead('no recorded Stellar Private Payments key, with this many public inputs, is in the code of the pool\'s verifier contract');
  const at = (bytes: Uint8Array, index: number): string => number(bytes.subarray(index * 32, index * 32 + 32)).toString();
  const proof = { pi_a: [at(a, 0), at(a, 1), '1'], pi_b: [[at(b, 1), at(b, 0)], [at(b, 3), at(b, 2)], ['1', '0']], pi_c: [at(c, 0), at(c, 1), '1'], protocol: 'groth16', curve: 'bn128' };
  return {
    inputs: { proof: `${JSON.stringify(proof, null, 2)}\n`, publicInputs: `${JSON.stringify(inputs.map(String), null, 2)}\n`, verificationKey: found[0]!.text },
    call: SOROBAN_CALLS.privatePayments.id,
    keyFrom: 'code',
    keyContract: verifierValue.address(),
    keyContractCode: verifier.code,
    // The pool's storage names the verifier and the policy; either changing would change the check.
    keyLastChanged: Math.max(pool.lastChanged, verifier.lastChanged),
    calledCode: pool.code,
  };
}

/**
 * Asks a Stellar RPC for one transaction and reads a proof out of it, if it
 * is a call this tool knows, together with the verification key the called
 * contracts hold. Read-only: a handful of requests, no signing, nothing sent
 * to the network. Nothing returned here is verified; the caller checks the proof.
 */
export async function lookupStellarTransaction(parts: { network: StellarNetwork; transaction: string; rpc: RpcClient; recordedKeys: () => Promise<RecordedKey[]>; assetInfo?: StellarAssetInfo }): Promise<Lookup> {
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
  let sender: string;
  try {
    envelope = xdr.TransactionEnvelope.fromXDR(transaction.envelopeXdr, 'base64');
    const built = TransactionBuilder.fromXDR(envelope, network.passphrase);
    computed = hex(built.hash());
    sender = 'innerTransaction' in built ? built.innerTransaction.source : built.source;
  } catch {
    throw new RpcError('the provider sent a transaction that cannot be read');
  }
  // The hash is computed here from what was sent, so the transaction read is the one asked for.
  if (computed !== hash) throw new RpcError('the provider answered about a different transaction');

  const ops = operations(envelope) ?? [];
  // Read but holding no proof this tool reads: say what the transaction was.
  // What the transaction did, from its result and the events its successful execution emitted.
  const activity = readStellarActivity({ envelope, resultXdr: transaction.resultXdr, events: transaction.events, succeeded: transaction.status === 'SUCCESS' });
  const facts = async (withAssetNote: boolean): Promise<TransactionFacts> => {
    const { asset, ...described } = describeOperations(ops);
    const action = asset === undefined ? described.action : `${described.action} issued by ${asset.issuer}${withAssetNote ? await assetNote(rpc, asset, parts.assetInfo) : ''}`;
    return {
      family: 'stellar',
      provider: rpc.provider,
      network: network.name,
      transaction: hash,
      position: ledger,
      status: transaction.status === 'SUCCESS' ? 'succeeded' : 'failed',
      from: sender,
      ...described,
      action,
      ...(activity.fee === undefined ? {} : { fee: activity.fee }),
      ...(activity.memo === undefined ? {} : { memo: activity.memo }),
      ...(activity.outcomes.length === 0 ? {} : { outcomes: activity.outcomes }),
      ...(activity.movements.length === 0 ? {} : { tokens: activity.movements.map(describeMovement) }),
      ...(activity.more ? { moreTokens: true } : {}),
    };
  };
  const notRead = async (reason: string): Promise<Lookup> => ({ found: false, reason, facts: await facts(true) });
  if (ops.length !== 1 || ops[0]!.body().switch().name !== 'invokeHostFunction') return notRead('the transaction is not a call this tool reads a proof from');
  const host = ops[0]!.body().invokeHostFunctionOp().hostFunction();
  if (host.switch().name !== 'hostFunctionTypeInvokeContract') return notRead('the transaction is not a call this tool reads a proof from');
  const invoked = host.invokeContract();
  const contract = Address.fromScAddress(invoked.contractAddress()).toString();
  if (!StrKey.isValidContract(contract)) return notRead('the transaction is not a call this tool reads a proof from');

  let read: Read;
  try {
    const name = invoked.functionName().toString();
    if (name === SOROBAN_CALLS.ultraHonk.function) read = await readUltraHonkCall(rpc, invoked.contractAddress(), invoked.args());
    else if (name === SOROBAN_CALLS.privatePayments.function) read = await readPoolCall(rpc, invoked.contractAddress(), invoked.args(), parts.recordedKeys);
    else return notRead('the transaction is not a call this tool reads a proof from');
  } catch (error) {
    if (error instanceof NotRead) return notRead(error.message);
    throw error;
  }

  return {
    found: true,
    facts: await facts(false),
    inputs: read.inputs,
    source: {
      kind: 'stellar-transaction',
      provider: rpc.provider,
      network: network.name,
      transaction: hash,
      ledger,
      contract,
      contractCode: hex(read.calledCode),
      status: transaction.status === 'SUCCESS' ? 'succeeded' : 'failed',
      call: read.call,
      keyFrom: read.keyFrom,
      keyContract: Address.fromScAddress(read.keyContract).toString(),
      keyContractCode: hex(read.keyContractCode),
      keyLastChanged: read.keyLastChanged,
    },
  };
}

/** Common operations in plain words; any other kind is spelt out from its name. */
const OPERATIONS: Record<string, string> = {
  payment: 'a payment',
  createAccount: 'creating an account',
  pathPaymentStrictSend: 'a payment converted between currencies',
  pathPaymentStrictReceive: 'a payment converted between currencies',
  manageBuyOffer: "an offer to buy on Stellar's exchange",
  manageSellOffer: "an offer to sell on Stellar's exchange",
  createPassiveSellOffer: "an offer to sell on Stellar's exchange",
  changeTrust: 'allowing an account to hold an asset',
  accountMerge: 'closing an account',
  setOptions: "changing an account's settings",
  invokeHostFunction: 'a smart contract operation',
};
const words = (name: string): string => OPERATIONS[name] ?? name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

/** What a Stellar transaction's operations did, and the one contract or account involved when there is one. */
function describeOperations(ops: xdr.Operation[]): { action: string; to?: string; asset?: { code: string; issuer: string } } {
  if (ops.length === 1) {
    const body = ops[0]!.body();
    const kind = body.switch().name;
    try {
      if (kind === 'invokeHostFunction' && body.invokeHostFunctionOp().hostFunction().switch().name === 'hostFunctionTypeInvokeContract') {
        const invoked = body.invokeHostFunctionOp().hostFunction().invokeContract();
        const contract = Address.fromScAddress(invoked.contractAddress()).toString();
        return { action: `a call to ${invoked.functionName().toString()} on contract ${contract}`, to: contract };
      }
      if (kind === 'invokeHostFunction') {
        const host = body.invokeHostFunctionOp().hostFunction().switch().name;
        if (host === 'hostFunctionTypeUploadContractWasm') return { action: 'uploading the code of a smart contract' };
        if (host.startsWith('hostFunctionTypeCreateContract')) return { action: 'creating a smart contract' };
      }
      if (kind === 'payment') {
        const payment = body.paymentOp();
        const kind = payment.asset().switch().name;
        const code = (bytes: Uint8Array): string => new TextDecoder().decode(bytes).replace(/\0+$/, '');
        const amount = (Number(payment.amount().toBigInt()) / 1e7).toString();
        const to = StrKey.encodeEd25519PublicKey(payment.destination().switch().name === 'keyTypeEd25519' ? payment.destination().ed25519() : payment.destination().med25519().ed25519());
        if (kind === 'assetTypeNative') return { action: `a payment of ${amount} XLM`, to };
        // An issued asset is its code and its issuer together: the code alone is not unique.
        const credit = kind === 'assetTypeCreditAlphanum4' ? payment.asset().alphaNum4() : payment.asset().alphaNum12();
        const asset = { code: code(credit.assetCode()), issuer: StrKey.encodeEd25519PublicKey(credit.issuer().ed25519()) };
        return { action: `a payment of ${amount} ${asset.code}`, to, asset };
      }
    } catch {
      // Described by its kind alone below.
    }
    return { action: words(kind) };
  }
  const kinds = [...new Set(ops.map((op) => words(op.body().switch().name)))];
  return { action: `${ops.length} operations: ${kinds.join('; ')}` };
}

/**
 * What can be said about who issued an asset: the home domain the issuer's
 * account declares, read from the ledger, and, when a checker is given,
 * whether that domain's stellar.toml lists this asset and issuer. Any
 * failure leaves the note shorter, never wrong.
 */
async function assetNote(rpc: RpcClient, asset: { code: string; issuer: string }, check: StellarAssetInfo | undefined): Promise<string> {
  let domain: string | undefined;
  try {
    const key = xdr.LedgerKey.account(new xdr.LedgerKeyAccount({ accountId: xdr.PublicKey.publicKeyTypeEd25519(StrKey.decodeEd25519PublicKey(asset.issuer)) })).toXDR('base64');
    const entry = await oneEntry(rpc, key);
    const declared = entry === undefined ? '' : xdr.LedgerEntryData.fromXDR(entry.xdr, 'base64').account().homeDomain().toString();
    domain = /^[a-z0-9.-]{1,253}$/i.test(declared) ? declared.toLowerCase() : undefined;
  } catch {
    domain = undefined;
  }
  if (domain === undefined) return ', whose account names no home domain';
  const claimed = `, whose account names ${domain} as its home domain`;
  const found = check === undefined ? undefined : await check(domain, asset.code, asset.issuer).catch(() => undefined);
  if (found === undefined) return `${claimed} (not checked against that domain's stellar.toml)`;
  if (found.missing === true) return `${claimed}; that domain publishes no stellar.toml, so the link is not confirmed`;
  return found.confirmed
    ? `${claimed}; that domain's stellar.toml lists this asset and issuer${found.name === undefined ? '' : `, naming it "${found.name}"`}`
    : `${claimed}; that domain's stellar.toml does not list this asset and issuer, so the link is not confirmed`;
}

