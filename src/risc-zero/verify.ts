import { sha256 } from '@noble/hashes/sha2.js';
import { BASE_FIELD, SCALAR_FIELD } from '../field.js';
import type { VerifierIdentity } from '../result.js';
import type { Groth16Engine } from '../semaphore-v4/verify.js';
import { utf8 } from '../sha256.js';
import { hexBytes, type RiscZeroParameters } from './parameters.js';

/**
 * A RISC Zero Groth16 receipt as three lines of lower-case hex: the seal
 * (260 bytes), the image ID of the program (32 bytes) and the SHA-256 of
 * the journal the program wrote (32 bytes). This is the file Nethermind's
 * guide to verifying RISC Zero proofs on Stellar has a prover write.
 */
const RECEIPT = /^([0-9a-f]{520})\n([0-9a-f]{64})\n([0-9a-f]{64})\n?$/;

export const looksLikeRiscZeroReceipt = (text: string): boolean => text.length <= 660 && RECEIPT.test(text);

export interface RiscZeroBound {
  parameters: RiscZeroParameters;
  engine: Groth16Engine;
}

interface RiscZeroChecked {
  verifier: VerifierIdentity;
  parameters: { version: string; selector: string; sha256: string };
}
export type RiscZeroResult =
  | ({ status: 'valid'; imageId: string; journalSha256: string } & RiscZeroChecked)
  | ({ status: 'invalid' } & RiscZeroChecked)
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};
const ZERO_DIGEST = new Uint8Array(32);
/** The state of a RISC Zero machine that has stopped, as RISC Zero's verifier contracts fix it. */
const HALTED_STATE = hexBytes('a3acc27117418996340b84e5a90f3ef4c49d22c79e44aad822ec9c313e1eb8e2');

/**
 * The digest of the statement a receipt is checked against: this program
 * ran with no declared input, stopped normally with exit code zero, wrote
 * a journal with this hash, and relies on no other unproven receipt. The
 * layout is the one RISC Zero's verifier contracts use.
 */
export function claimDigest(imageId: Uint8Array, journalDigest: Uint8Array): Uint8Array {
  const output = sha256(concat(sha256(utf8('risc0.Output')), journalDigest, ZERO_DIGEST, Uint8Array.of(2, 0)));
  // After the four digests: system exit code 0 (halted), user exit code 0, then the count of digests.
  return sha256(concat(sha256(utf8('risc0.ReceiptClaim')), ZERO_DIGEST, imageId, HALTED_STATE, output, new Uint8Array(8), Uint8Array.of(4, 0)));
}

const number = (bytes: Uint8Array): bigint => BigInt(`0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`);
/** A digest as the two public inputs the circuit takes: its bytes reversed, then cut in half. */
function halves(digest: Uint8Array): [string, string] {
  const reversed = Uint8Array.from(digest).reverse();
  return [number(reversed.subarray(16)).toString(), number(reversed.subarray(0, 16)).toString()];
}

/**
 * Checks a RISC Zero Groth16 receipt against the pinned verifier
 * parameters. Only a seal made for exactly those parameters is checked.
 */
export async function verifyRiscZero(text: string, bound: RiscZeroBound): Promise<RiscZeroResult> {
  const unsupported = (reason: string): RiscZeroResult => ({ status: 'unsupported', reason });
  const lines = RECEIPT.exec(text);
  if (text.length > 660 || lines === null) return unsupported('the file is not a RISC Zero receipt written as three lines of hex');
  const { parameters, engine } = bound;
  const seal = hexBytes(lines[1]!);
  if (lines[1]!.slice(0, 8) !== parameters.selector) {
    return unsupported(`the seal was made for other verifier parameters than version ${parameters.version}, the only version this tool checks`);
  }
  const words = Array.from({ length: 8 }, (_, i) => number(seal.subarray(4 + 32 * i, 36 + 32 * i)));
  // One spelling per point: a coordinate outside the field is refused, not reduced.
  if (words.some((word) => word >= BASE_FIELD)) return unsupported('the seal holds a number outside the field');
  const [ax, ay, bx1, bx0, by1, by0, cx, cy] = words.map(String);
  const proof = { pi_a: [ax, ay, '1'], pi_b: [[bx0, bx1], [by0, by1], ['1', '0']], pi_c: [cx, cy, '1'], protocol: 'groth16', curve: 'bn128' };
  const publicSignals = [...halves(parameters.controlRoot), ...halves(claimDigest(hexBytes(lines[2]!), hexBytes(lines[3]!))), parameters.bn254ControlId];
  try {
    if (publicSignals.some((signal) => BigInt(signal) >= SCALAR_FIELD)) throw new RangeError('a public input is outside the field');
    const checked: RiscZeroChecked = { verifier: engine.identity, parameters: { version: parameters.version, selector: parameters.selector, sha256: parameters.sha256 } };
    const passed = await engine.verify(parameters.key, publicSignals, proof);
    if (passed !== true && passed !== false) throw new TypeError('the verifier did not return a yes or no answer');
    return passed ? { status: 'valid', imageId: lines[2]!, journalSha256: lines[3]!, ...checked } : { status: 'invalid', ...checked };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
