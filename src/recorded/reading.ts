import type { PublicReading } from '../adapter.js';

/**
 * A second way to show a public input, when its adapter names one. It is a
 * reading aid: the proof is about the number, and text read out of it was
 * chosen by whoever made the proof.
 */
export function readPublicInput(value: string, reading: PublicReading): { kind: 'text' | 'address'; value: string } | undefined {
  let rest = BigInt(value);
  if (reading === 'ethereum-address') {
    return rest < 1n << 160n ? { kind: 'address', value: `0x${rest.toString(16).padStart(40, '0')}` } : undefined;
  }
  // ZK Email packs revealed characters into a number, first character lowest.
  const bytes: number[] = [];
  while (rest > 0n) {
    bytes.push(Number(rest & 0xffn));
    rest >>= 8n;
  }
  if (bytes.length === 0 || bytes.length > 31 || bytes.some((byte) => byte < 0x20 || byte > 0x7e)) return undefined;
  return { kind: 'text', value: String.fromCharCode(...bytes) };
}
