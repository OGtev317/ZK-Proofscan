/**
 * What a check is given. A Semaphore v4 proof is one file, checked against
 * keys bundled with this tool. A proof checked with its own verification key
 * comes as three files, the way snarkjs writes them.
 */
export interface ProofInputs {
  proof: string;
  publicInputs?: string;
  verificationKey?: string;
}

export const MAX_PUBLIC_INPUTS_CHARACTERS = 65_536;
export const MAX_VERIFICATION_KEY_CHARACTERS = 262_144;
/** The most public inputs a supplied-key proof may have. */
export const MAX_PUBLIC_INPUTS = 512;
