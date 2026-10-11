export interface VerifierIdentity {
  name: string;
  version: string;
}

export interface Checked {
  format: 'semaphore-v4';
  verifier: VerifierIdentity;
  artifact: { sha256: string; merkleTreeDepth: number };
  /** Message and scope as written in the proof file; the circuit sees their hashes. */
  message: string;
  scope: string;
  /** The exact values given to the verifier, in order. */
  publicSignals: string[];
}

/**
 * `invalid` means the verifier ran and rejected the proof. `unsupported` means
 * the input is not a proof this tool understands, and `error` means the check
 * could not be completed. Neither of those says anything about validity.
 */
export type VerificationResult =
  | ({ status: 'valid' } & Checked)
  | ({ status: 'invalid' } & Checked)
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };
