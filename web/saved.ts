/// <reference types="vite/client" />
// Examples whose provider answers were recorded, so they work after the
// public RPC has forgotten the transaction. They are replayed through the
// same lookup as a live one; nothing is fetched from the network.
import noProofUrl from '../tests/fixtures/stellar-testnet/not-a-proof/answers.json?url';
import poolUrl from '../tests/fixtures/stellar-testnet/private-payments/answers.json?url';
import ultraHonkUrl from '../tests/fixtures/stellar-testnet/ultrahonk/answers.json?url';
import swapUrl from '../tests/fixtures/stellar-mainnet/soroswap.json?url';

export interface SavedExample {
  id: string;
  label: string;
  network: string;
  hash: string;
  /** The recorded answers, with the provider's address and the date they were recorded. */
  url: string;
}

export const SAVED_EXAMPLES: readonly SavedExample[] = [
  { id: 'stellar-soroswap', label: 'A saved mainnet Soroswap swap (no proof)', network: 'stellar-mainnet', hash: '203d14cb109f442a96e26a5bba9a2c5b8aa5770dabe29e0b5f46e310a2003e3a', url: swapUrl },
  { id: 'stellar-private-payment', label: 'A Stellar private payment', network: 'stellar-testnet', hash: 'cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc', url: poolUrl },
  { id: 'stellar-noir', label: 'A Stellar Noir proof', network: 'stellar-testnet', hash: '10dd8ab5bcfbc8395030144cdfc5cb200ce61d38e7fad533e18e3aee89bbb3b2', url: ultraHonkUrl },
  { id: 'stellar-no-proof', label: 'A Stellar transaction with no proof', network: 'stellar-testnet', hash: '294424f4b8818140ecf48e587bac0d9185ee3638f4a769de84dd3a49de1044bb', url: noProofUrl },
];
