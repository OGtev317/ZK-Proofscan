import { parseCanonical, SCALAR_FIELD } from '../field.js';
import { binaryBytes, MAX_PUBLIC_INPUTS, partBytes, type ProofInputs } from '../inputs.js';
import type { VerifierIdentity } from '../result.js';
import { sha256Hex } from '../sha256.js';
import type { SuppliedResult } from '../supplied-key/verify.js';

/**
 * How an UltraHonk proof was made: the hash that stands in for the
 * verifier's random choices, and whether the proof hides its witness. A
 * proof and its key are made for one variant and verify under no other.
 */
export const ULTRAHONK_VARIANTS = ['evm', 'evm-no-zk', 'noir-recursive', 'noir-recursive-no-zk'] as const;
export type UltraHonkVariant = (typeof ULTRAHONK_VARIANTS)[number];

/** A verifier for UltraHonk proofs made by Barretenberg, the usual backend for Noir. */
export interface UltraHonkEngine {
  identity: VerifierIdentity;
  /**
   * `publicInputs` are 32-byte values as 0x-prefixed hex. Resolves false
   * when the verifier does not accept the files, including when it faults
   * on them. Rejects only when the verifier could not be run at all.
   */
  verify(variant: UltraHonkVariant, key: Uint8Array, publicInputs: string[], proof: Uint8Array): Promise<boolean>;
}

const MAX_PROOF_BYTES = 49_152;
const MAX_KEY_BYTES = 16_384;

/**
 * Checks an UltraHonk proof against the verification key that came with it,
 * as Barretenberg writes the three files: `proof`, `public_inputs` and
 * `vk`, all binary. The proof and key are opaque to this tool. The public
 * inputs are 32-byte numbers, each of which must be inside the field.
 */
export async function verifyUltraHonk(inputs: Required<ProofInputs>, engine: UltraHonkEngine): Promise<SuppliedResult> {
  const unsupported = (reason: string): SuppliedResult => ({ status: 'unsupported', reason });
  const proof = binaryBytes(inputs.proof);
  if (proof === undefined) return unsupported('the proof is not a binary proof file');
  if (proof.length === 0 || proof.length % 32 !== 0 || proof.length > MAX_PROOF_BYTES) return unsupported('the proof file is not a whole number of 32-byte values of a supported size');
  // The other two files are taken as their exact bytes, however they were read.
  const key = partBytes(inputs.verificationKey);
  if (key.length === 0 || key.length > MAX_KEY_BYTES) return unsupported('the verification key file is empty or too large');
  // Measured on @aztec/bb.js 5.2.1: a key opens with three 32-byte numbers
  // of which the verifier reads only the last 8 bytes. The unread bytes must
  // be zero, so that one key has one spelling and one hash.
  for (const header of [0, 32, 64]) {
    if (key.length < header + 32 || key.subarray(header, header + 24).some((byte) => byte !== 0)) return unsupported('the verification key does not open with three small numbers, as a key for this verifier does');
  }
  const packed = partBytes(inputs.publicInputs);
  if (packed.length % 32 !== 0 || packed.length / 32 > MAX_PUBLIC_INPUTS) return unsupported('the public inputs file is not a whole number of 32-byte values of a supported size');

  const hex: string[] = [];
  const decimal: string[] = [];
  for (let at = 0; at < packed.length; at += 32) {
    const digits = Array.from(packed.subarray(at, at + 32), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const value = BigInt(`0x${digits}`);
    if (parseCanonical(value.toString(), SCALAR_FIELD) === undefined) return unsupported('a public input is not a number inside the field');
    hex.push(`0x${digits}`);
    decimal.push(value.toString());
  }

  try {
    const checked = {
      protocol: 'ultrahonk' as const,
      curve: 'bn128' as const,
      verifier: engine.identity,
      verificationKeySha256: sha256Hex(key),
      // The key is opaque bytes, so its content is its bytes.
      verificationKeyContentSha256: sha256Hex(key),
      publicInputsSha256: sha256Hex(packed),
      publicSignals: decimal,
    };
    // The files do not say which variant they are, so each is tried. Each is
    // a complete verification on its own. A throw means the verifier could
    // not run, which is an error and never a verdict on the proof.
    for (const variant of ULTRAHONK_VARIANTS) {
      const passed = await engine.verify(variant, key, hex, proof);
      if (passed !== true && passed !== false) throw new TypeError('the verifier did not return a yes or no answer');
      if (passed) return { status: 'valid', ...checked, variant };
    }
    return { status: 'invalid', ...checked };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
