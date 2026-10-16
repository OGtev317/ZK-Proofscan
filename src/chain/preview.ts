import { Address, TransactionBuilder, xdr } from '@stellar/stellar-base';
import { describeInvocation } from './soroban-spec.js';
import { STELLAR_NETWORKS } from './stellar.js';
import type { RpcClient } from './rpc.js';

const MAX_XDR = 262_144;
const MAX_AUTH_NODES = 64;
export interface AuthorizationNode { call: string; contract?: string; children: AuthorizationNode[] }
export interface InspectedOperation {
  kind: string;
  description: string;
  authorizations: { signer: string; invocation: AuthorizationNode }[];
  contract?: string;
}
export interface TransactionPreview {
  kind: 'inspected';
  network: string;
  hash: string;
  source: string;
  feePayer: string;
  maxFeeStroops: string;
  signatures: number;
  embeddedAuthorizationSignatures: boolean;
  operations: InspectedOperation[];
  warnings: string[];
}
export type PreviewResult = TransactionPreview | { kind: 'not-inspected'; reason: string };
export type SimulationResult = {
  kind: 'simulated' | 'simulation-failed' | 'not-simulated';
  message: string;
  provider?: string;
  ledger?: number;
  minResourceFeeStroops?: string;
  authorizations?: { signer: string; invocation: AuthorizationNode }[];
  stateChanges?: { type: 'created' | 'updated' | 'deleted'; key: string }[];
  moreStateChanges?: boolean;
};

function parse(text: string, network: string) {
  const chosen = STELLAR_NETWORKS.find((item) => item.name === network);
  if (chosen === undefined) throw new Error('Choose Stellar testnet or mainnet explicitly.');
  if (typeof text !== 'string' || text.length > MAX_XDR) throw new Error('The transaction XDR is too large.');
  const normalized = text.trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) throw new Error('Paste a base64 transaction envelope XDR, not a secret key or proof.');
  const envelope = xdr.TransactionEnvelope.fromXDR(normalized, 'base64');
  if (envelope.toXDR('base64') !== normalized) throw new Error('The transaction envelope is not canonical base64 XDR.');
  if (!['envelopeTypeTx', 'envelopeTypeTxFeeBump'].includes(envelope.switch().name)) throw new Error('This envelope type is not supported.');
  const built = TransactionBuilder.fromXDR(envelope, chosen.passphrase);
  const inner = 'innerTransaction' in built ? built.innerTransaction : built;
  const transaction = envelope.switch().name === 'envelopeTypeTxFeeBump' ? envelope.feeBump().tx().innerTx().v1().tx() : envelope.v1().tx();
  return { chosen, normalized, envelope, built, inner, transaction };
}

function authorization(entry: xdr.SorobanAuthorizationEntry, budget: { left: number }): { signer: string; invocation: AuthorizationNode } {
  const visit = (node: xdr.SorobanAuthorizedInvocation, depth: number): AuthorizationNode => {
    if (--budget.left < 0 || depth > 12) throw new Error('The authorization tree exceeds the inspection limit.');
    const fn = node.function();
    if (fn.switch().name !== 'sorobanAuthorizedFunctionTypeContractFn') return { call: 'Contract creation authorization (details not decoded).', children: node.subInvocations().map((n) => visit(n, depth + 1)) };
    const call = fn.contractFn();
    return { contract: Address.fromScAddress(call.contractAddress()).toString(), call: describeInvocation(call.functionName().toString(), call.args(), undefined), children: node.subInvocations().map((n) => visit(n, depth + 1)) };
  };
  const credentials = entry.credentials();
  const signer = credentials.switch().name === 'sorobanCredentialsSourceAccount' ? 'transaction source account' : Address.fromScAddress(credentials.address().address()).toString();
  return { signer, invocation: visit(entry.rootInvocation(), 0) };
}

/** Parsing only: no fetch, signature validation, signing, or submission. */
export function inspectStellarTransaction(text: string, network: string): PreviewResult {
  try {
    const { built, inner, transaction } = parse(text, network);
    const budget = { left: MAX_AUTH_NODES };
    let embeddedAuthorizationSignatures = false;
    const operations = transaction.operations().map((operation, index): InspectedOperation => {
      const body = operation.body();
      const kind = body.switch().name;
      if (kind !== 'invokeHostFunction') {
        const native = inner.operations[index]!;
        const description = native.type === 'payment' ? `Requested payment of ${native.amount} ${native.asset.isNative() ? 'XLM' : `${native.asset.getCode()} issued by ${native.asset.getIssuer()}`} to ${native.destination}` : `Requested ${kind} operation; full effects not decoded.`;
        return { kind, description, authorizations: [] };
      }
      const host = body.invokeHostFunctionOp();
      const authorizations = host.auth().map((entry) => {
        if (entry.credentials().switch().name === 'sorobanCredentialsAddress' && entry.credentials().address().signature().switch().name !== 'scvVoid') embeddedAuthorizationSignatures = true;
        return authorization(entry, budget);
      });
      if (host.hostFunction().switch().name !== 'hostFunctionTypeInvokeContract') return { kind, description: 'Requested contract creation or code upload; effects not decoded.', authorizations };
      const call = host.hostFunction().invokeContract();
      return { kind, description: `Requested ${describeInvocation(call.functionName().toString(), call.args(), undefined)}`, contract: Address.fromScAddress(call.contractAddress()).toString(), authorizations };
    });
    const signatures = inner.signatures.length + ('innerTransaction' in built ? built.signatures.length : 0);
    return {
      kind: 'inspected', network, hash: built.hash().toString('hex'), source: inner.source,
      feePayer: 'innerTransaction' in built ? built.feeSource : inner.source,
      maxFeeStroops: built.fee, signatures, embeddedAuthorizationSignatures, operations,
      warnings: [
        'Local inspection only. The transaction has not been submitted and no proof or signature was checked.',
        'XDR does not encode a network passphrase. The network above is your selection, not detected from the envelope.',
        'Arguments show requested actions, not committed transfers. Nested effects can require simulation and may still be incompletely decoded.',
        ...(signatures > 0 || embeddedAuthorizationSignatures ? ['This envelope contains signatures; this tool does not authenticate them and will not send it for simulation.'] : []),
        ...(operations.some((op) => op.description.includes('approve')) ? ['This requests a spending permission. Inspect the spender, amount and expiration before signing elsewhere.'] : []),
      ],
    };
  } catch (error) {
    return { kind: 'not-inspected', reason: error instanceof Error && (error.message.startsWith('Choose ') || error.message.startsWith('The transaction ') || error.message.startsWith('Paste ') || error.message.startsWith('This envelope ') || error.message.startsWith('The authorization ')) ? error.message : 'The transaction envelope could not be read.' };
  }
}

/** Explicit opt-in: sends the unsigned XDR only to the caller's selected RPC. */
export async function simulateStellarTransaction(text: string, network: string, rpc: RpcClient): Promise<SimulationResult> {
  const inspected = inspectStellarTransaction(text, network);
  if (inspected.kind !== 'inspected') return { kind: 'not-simulated', message: inspected.reason };
  if (inspected.signatures || inspected.embeddedAuthorizationSignatures) return { kind: 'not-simulated', message: 'Only unsigned envelopes with no embedded authorization signatures may be simulated.' };
  try {
    const parsed = parse(text, network);
    if (parsed.envelope.switch().name !== 'envelopeTypeTx' || inspected.operations.length !== 1 || inspected.operations[0]!.kind !== 'invokeHostFunction') return { kind: 'not-simulated', message: 'Simulation supports one unsigned Soroban operation, not fee bumps or classic transactions.' };
    const about = await rpc.call('getNetwork', {}) as { passphrase?: unknown };
    if (about?.passphrase !== parsed.chosen.passphrase) return { kind: 'not-simulated', message: 'The selected provider is not serving the selected network.' };
    const reply = await rpc.call('simulateTransaction', { transaction: parsed.normalized, authMode: 'record' }) as Record<string, unknown>;
    if (!reply || typeof reply !== 'object' || 'error' in reply) return { kind: 'simulation-failed', provider: rpc.provider, message: 'The provider could not simulate this transaction. No transaction was submitted; provider error text is not repeated.' };
    if (!Number.isSafeInteger(reply.latestLedger) || (reply.latestLedger as number) < 1 || !Array.isArray(reply.results) || reply.results.length !== 1) return { kind: 'simulation-failed', message: 'The provider returned an incomplete simulation, not a usable prediction.' };
    const result = reply.results[0] as { auth?: unknown };
    const budget = { left: MAX_AUTH_NODES };
    if (!result || !Array.isArray(result.auth) || result.auth.length > MAX_AUTH_NODES || !result.auth.every((v) => typeof v === 'string' && v.length < MAX_XDR)) return { kind: 'simulation-failed', message: 'The provider returned authorization data this tool cannot read.' };
    const authorizations = result.auth.map((v: string) => authorization(xdr.SorobanAuthorizationEntry.fromXDR(v, 'base64'), budget));
    const changes = Array.isArray(reply.stateChanges) ? reply.stateChanges : [];
    const stateChanges: NonNullable<SimulationResult['stateChanges']> = [];
    for (const item of changes.slice(0, 20)) {
      if (typeof item !== 'object' || item === null) continue;
      const change = item as Record<string, unknown>;
      if (!['created', 'updated', 'deleted'].includes(String(change.type)) || typeof change.key !== 'string' || change.key.length > 8192) continue;
      const key = xdr.LedgerKey.fromXDR(change.key, 'base64');
      stateChanges.push({ type: change.type as 'created' | 'updated' | 'deleted', key: key.toXDR('base64') });
    }
    return {
      kind: 'simulated', provider: rpc.provider, ledger: reply.latestLedger as number,
      message: 'Prediction only, from the selected provider. Authorization was recorded, NOT enforced; signatures were not checked. State may change before submission. No transaction was signed or submitted.',
      ...(typeof reply.minResourceFee === 'string' && /^\d{1,40}$/.test(reply.minResourceFee) ? { minResourceFeeStroops: reply.minResourceFee } : {}),
      authorizations, stateChanges, moreStateChanges: changes.length > 20,
    };
  } catch { return { kind: 'simulation-failed', message: 'Simulation could not be completed; no transaction was submitted.' }; }
}
