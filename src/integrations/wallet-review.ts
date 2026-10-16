import { inspectStellarTransaction, type TransactionPreview } from '../chain/preview.js';
import { sha256Hex, utf8 } from '../sha256.js';

export interface LocalReviewTicket {
  kind: 'local-review';
  network: string;
  envelopeSha256: string;
  preview: TransactionPreview;
  note: string;
}
/** A dApp-side review step BEFORE its existing Freighter/Wallets Kit signing flow. Never calls a wallet. */
export function prepareWalletReview(unsignedXdr: string, network: string): LocalReviewTicket | { kind: 'not-reviewed'; reason: string } {
  const preview = inspectStellarTransaction(unsignedXdr, network);
  if (preview.kind !== 'inspected') return { kind: 'not-reviewed', reason: preview.reason };
  if (preview.signatures || preview.embeddedAuthorizationSignatures) return { kind: 'not-reviewed', reason: 'Provide an unsigned envelope with no authorization signatures for this pre-sign review.' };
  return { kind: 'local-review', network, envelopeSha256: sha256Hex(utf8(unsignedXdr.trim())), preview, note: 'Local structural review only, not proof verification, a signature check, or a safety verdict. LumenLenz does not connect to, invoke, sign with or submit through a wallet.' };
}
/** Detect ANY envelope mutation, including signatures (not covered by the transaction hash). */
export function matchesWalletReview(ticket: LocalReviewTicket, unsignedXdr: string, network: string): boolean {
  return ticket.kind === 'local-review' && network === ticket.network && unsignedXdr.length <= 262_144 && sha256Hex(utf8(unsignedXdr.trim())) === ticket.envelopeSha256;
}
