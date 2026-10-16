import { Address, TransactionBuilder, xdr } from '@stellar/stellar-base';
import { describeInvocation } from './soroban-spec.js';
import { STELLAR_NETWORKS } from './stellar.js';

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
        'Arguments show requested actions, not committed transfers. Nested effects may not be fully decoded.',
        ...(signatures > 0 || embeddedAuthorizationSignatures ? ['This envelope contains signatures; this tool does not authenticate them.'] : []),
        ...(operations.some((op) => op.description.includes('approve')) ? ['This requests a spending permission. Inspect the spender, amount and expiration before signing elsewhere.'] : []),
      ],
    };
  } catch (error) {
    return { kind: 'not-inspected', reason: error instanceof Error && (error.message.startsWith('Choose ') || error.message.startsWith('The transaction ') || error.message.startsWith('Paste ') || error.message.startsWith('This envelope ') || error.message.startsWith('The authorization ')) ? error.message : 'The transaction envelope could not be read.' };
  }
}
