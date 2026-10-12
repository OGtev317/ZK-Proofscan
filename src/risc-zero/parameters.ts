import { BASE_FIELD, parseCanonical } from '../field.js';
import { sha256Hex } from '../sha256.js';

/**
 * SHA-256 of `artifacts/risc-zero-groth16/parameters-3.0.0.json`: the
 * parameters of RISC Zero's Groth16 receipt verifier, version 3.0.0, as
 * Nethermind's Stellar verifier publishes them.
 */
export const RISC_ZERO_PARAMETERS_SHA256 = '290b10f9fed64871c33bcd2624fc5bd50f22d72b44063ce269648800642ad29a';
/** The four bytes a seal for these parameters begins with. */
export const RISC_ZERO_SELECTOR = '73c457ba';
export const RISC_ZERO_PARAMETERS_VERSION = '3.0.0';

export interface RiscZeroParameters {
  sha256: string;
  version: string;
  selector: string;
  /** The verification key, laid out as snarkjs reads one. */
  key: Record<string, unknown>;
  /** The control root, 32 bytes. It fixes which RISC Zero circuits a receipt may come from. */
  controlRoot: Uint8Array;
  /** The fifth public input, as a decimal number. */
  bn254ControlId: string;
}

export class RiscZeroParametersError extends Error {}

const HEX_32 = /^[0-9a-f]{64}$/;
const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
export const hexBytes = (hex: string): Uint8Array => Uint8Array.from({ length: hex.length / 2 }, (_, i) => Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16));

/**
 * Accepts the parameters file only if its bytes match the pinned hash, and
 * every number in it is a plain decimal inside the field. A matching hash
 * means the file is the one that was pinned; it is not evidence about how
 * the key was produced.
 */
export function loadRiscZeroParameters(bytes: Uint8Array): RiscZeroParameters {
  const sha256 = sha256Hex(bytes);
  if (sha256 !== RISC_ZERO_PARAMETERS_SHA256) throw new RiscZeroParametersError(`the RISC Zero parameters have SHA-256 ${sha256}, expected ${RISC_ZERO_PARAMETERS_SHA256}`);
  const bad = (): never => {
    throw new RiscZeroParametersError('the RISC Zero parameters are not in the expected form');
  };
  const raw = record(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))) ?? bad();
  const vk = record(raw.verification_key) ?? bad();
  const number = (value: unknown): string => (parseCanonical(value, BASE_FIELD) === undefined ? bad() : (value as string));
  const g1 = (value: unknown): string[] => {
    const point = record(value) ?? bad();
    return [number(point.x), number(point.y), '1'];
  };
  // The file names the two parts of each coordinate x1, x2; snarkjs takes them in the other order.
  const g2 = (value: unknown): string[][] => {
    const point = record(value) ?? bad();
    return [[number(point.x2), number(point.x1)], [number(point.y2), number(point.y1)], ['1', '0']];
  };
  if (raw.version !== RISC_ZERO_PARAMETERS_VERSION || typeof raw.control_root !== 'string' || !HEX_32.test(raw.control_root)) bad();
  if (typeof raw.bn254_control_id !== 'string' || !HEX_32.test(raw.bn254_control_id) || !Array.isArray(vk.IC) || vk.IC.length !== 6) bad();
  return {
    sha256,
    version: RISC_ZERO_PARAMETERS_VERSION,
    selector: RISC_ZERO_SELECTOR,
    key: { protocol: 'groth16', curve: 'bn128', nPublic: 5, vk_alpha_1: g1(vk.alpha), vk_beta_2: g2(vk.beta), vk_gamma_2: g2(vk.gamma), vk_delta_2: g2(vk.delta), IC: (vk.IC as unknown[]).map(g1) },
    controlRoot: hexBytes(raw.control_root as string),
    bn254ControlId: BigInt(`0x${raw.bn254_control_id as string}`).toString(),
  };
}
