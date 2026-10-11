import { keccak_256 } from '@noble/hashes/sha3.js';

/**
 * Semaphore's mapping of a message or scope to a circuit input: keccak256 of
 * the value as 32 big-endian bytes, shifted right by 8 bits to fit the field.
 */
export function hashToField(value: bigint): bigint {
  const bytes = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    bytes[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n) throw new RangeError('value does not fit in 32 bytes');
  let digest = 0n;
  for (const byte of keccak_256(bytes)) digest = (digest << 8n) | BigInt(byte);
  return digest >> 8n;
}
