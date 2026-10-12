import { BASE_FIELD, parseCanonical, SCALAR_FIELD } from '../field.js';
import { binaryBytes, MAX_PUBLIC_INPUTS, partBytes, type ProofInputs } from '../inputs.js';
import type { VerifierIdentity } from '../result.js';
import { sha256Hex } from '../sha256.js';
import type { SuppliedResult } from '../supplied-key/verify.js';

/**
 * UltraHonk proofs as Barretenberg 0.87.0 wrote them, with the Keccak
 * transcript: the version and flavour that Nethermind's UltraHonk verifier
 * for Stellar is built for. Proofs and keys of this version have fixed
 * sizes, and a current version of Barretenberg does not read them.
 */
export const LEGACY_KEY_BYTES = 1760;
/** A proof's size says whether it hides its witness. */
const VARIANT_BY_PROOF_BYTES: Record<number, LegacyUltraHonkVariant> = { 14592: 'keccak', 16224: 'keccak-zk' };
const MAX_LOG_CIRCUIT_SIZE = 28n;
const KEY_OWN_PUBLIC_VALUES = 16;
export const LEGACY_ULTRAHONK_VARIANTS = ['keccak', 'keccak-zk'] as const;
export type LegacyUltraHonkVariant = (typeof LEGACY_ULTRAHONK_VARIANTS)[number];

export interface LegacyUltraHonkEngine {
  identity: VerifierIdentity;
  /**
   * `publicInputs` is the public inputs file: 32-byte values, one after
   * another. Resolves false when the verifier does not accept the files,
   * including when it faults on them. Rejects only when it could not be run.
   */
  verify(variant: LegacyUltraHonkVariant, key: Uint8Array, publicInputs: Uint8Array, proof: Uint8Array): Promise<boolean>;
}

/**
 * A key of this version opens with the circuit size as an 8-byte number,
 * so one of its first 8 bytes is not zero. A key for the current verifier
 * opens with 24 zero bytes. No file is both.
 */
export const looksLikeLegacyKey = (key: Uint8Array): boolean => key.length === LEGACY_KEY_BYTES && key.subarray(0, 8).some((byte) => byte !== 0);

const word = (bytes: Uint8Array, at: number): bigint => BigInt(`0x${Array.from(bytes.subarray(at, at + 32), (byte) => byte.toString(16).padStart(2, '0')).join('')}`);

/** Checks a Barretenberg 0.87.0 Keccak UltraHonk proof against the key that came with it. */
export async function verifyLegacyUltraHonk(inputs: Required<ProofInputs>, engine: LegacyUltraHonkEngine): Promise<SuppliedResult> {
  const unsupported = (reason: string): SuppliedResult => ({ status: 'unsupported', reason });
  const proof = binaryBytes(inputs.proof);
  if (proof === undefined) return unsupported('the proof is not a binary proof file');
  const key = partBytes(inputs.verificationKey);
  if (!looksLikeLegacyKey(key)) return unsupported('the verification key is not one written by Barretenberg 0.87.0 for the Keccak transcript');
  // A key opens with four 8-byte numbers: the circuit size, its logarithm,
  // the number of public inputs and where they start. Measured on
  // @aztec/bb.js 0.87.0: the verifier does not read the upper half of the
  // second, and does not compare the first two with each other. Here they
  // must agree, so that one key has one spelling and one hash.
  const header = [0, 8, 16, 24].map((at) => word(new Uint8Array([...new Uint8Array(24), ...key.subarray(at, at + 8)]), 0));
  const [size, logSize, publicCount] = header as [bigint, bigint, bigint, bigint];
  if (logSize < 1n || logSize > MAX_LOG_CIRCUIT_SIZE || size !== 1n << logSize) return unsupported('the verification key does not open with a circuit size and its logarithm that agree');
  // Measured: a key whose points are all the point at infinity accepts an
  // all-zero proof for any public inputs. The key of a real circuit that was
  // examined holds no such point, so a key that holds one is not read.
  for (let at = 32; at < key.length; at += 64) {
    if (key.subarray(at, at + 64).every((byte) => byte === 0)) return unsupported('the verification key holds a point at infinity, which the key of a circuit does not');
  }
  const variant = VARIANT_BY_PROOF_BYTES[proof.length];
  if (variant === undefined) return unsupported('the proof is not the size of a Keccak UltraHonk proof from Barretenberg 0.87.0');
  // This version of the verifier reduces a number that is too large instead
  // of refusing it, so the same proof could be written many ways. Every
  // 32-byte value of a proof as the prover writes it is inside the field.
  for (let at = 0; at < proof.length; at += 32) {
    if (word(proof, at) >= SCALAR_FIELD) return unsupported('the proof holds a number outside the field');
  }
  // Measured: every point but the last is bound by the proof's own hashing,
  // and the last is not. Its two coordinates are each written as a low part
  // of 136 bits and a high part, which the verifier adds together, so the
  // same point could be written many ways. Only the one way a prover writes
  // it is read here.
  const [xLow, xHigh, yLow, yHigh] = [128, 96, 64, 32].map((back) => word(proof, proof.length - back)) as [bigint, bigint, bigint, bigint];
  const coordinate = (low: bigint, high: bigint): boolean => low < 1n << 136n && high < 1n << 118n && low + (high << 136n) < BASE_FIELD;
  if (!coordinate(xLow, xHigh) || !coordinate(yLow, yHigh)) return unsupported('the last point of the proof is not written the one way a prover writes it');
  const packed = partBytes(inputs.publicInputs);
  if (packed.length % 32 !== 0 || packed.length / 32 > MAX_PUBLIC_INPUTS) return unsupported('the public inputs file is not a whole number of 32-byte values of a supported size');
  const decimal: string[] = [];
  for (let at = 0; at < packed.length; at += 32) {
    const value = word(packed, at).toString();
    if (parseCanonical(value, SCALAR_FIELD) === undefined) return unsupported('a public input is not a number inside the field');
    decimal.push(value);
  }
  // The key counts 16 values of its own after the circuit's public inputs.
  if (publicCount !== BigInt(decimal.length + KEY_OWN_PUBLIC_VALUES)) return unsupported('the number of public inputs is not the number the verification key expects');
  try {
    const checked = {
      protocol: 'ultrahonk' as const,
      curve: 'bn128' as const,
      variant,
      legacy: true as const,
      verifier: engine.identity,
      verificationKeySha256: sha256Hex(key),
      verificationKeyContentSha256: sha256Hex(key),
      publicInputsSha256: sha256Hex(packed),
      publicSignals: decimal,
    };
    const passed = await engine.verify(variant, key, packed, proof);
    if (passed !== true && passed !== false) throw new TypeError('the verifier did not return a yes or no answer');
    return { status: passed ? 'valid' : 'invalid', ...checked };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
