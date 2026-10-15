export interface VerifierIdentity {
  name: string;
  version: string;
  /** A second, independent verifier that gave the same answer. */
  alsoCheckedBy?: { name: string; version: string };
}

/** How a report names the verifier: both, when a second one agreed. */
export const verifierText = (verifier: VerifierIdentity): string =>
  verifier.alsoCheckedBy === undefined ? `${verifier.name} ${verifier.version}` : `${verifier.name} ${verifier.version} and ${verifier.alsoCheckedBy.name} ${verifier.alsoCheckedBy.version}, two independent verifiers that agree`;

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
 *
 * This is the verifier's answer only. What a passing proof does and does not
 * establish is in the `Report` built from it, which is what gets printed and
 * exported in every format.
 */
export type VerificationResult =
  | ({ status: 'valid' } & Checked)
  | ({ status: 'invalid' } & Checked)
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };
