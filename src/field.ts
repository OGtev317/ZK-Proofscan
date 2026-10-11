// BN254 (alt_bn128) field sizes. Out-of-range values are refused here and
// never reach the verifier, so the result does not depend on how a given
// verifier version treats them.
export const SCALAR_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const BASE_FIELD = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;
export const UINT256_LIMIT = 1n << 256n;

const CANONICAL_DECIMAL = /^(0|[1-9][0-9]{0,77})$/;

/** Parses a decimal string with no sign, spaces or leading zeros, below `limit`. */
export function parseCanonical(value: unknown, limit: bigint): bigint | undefined {
  if (typeof value !== 'string' || !CANONICAL_DECIMAL.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed < limit ? parsed : undefined;
}
