/**
 * Semaphore turns a text message into a number by placing its bytes at the
 * start of 32 bytes and padding with zeros. If a number has that shape and
 * holds only plain printable ASCII, this returns the text. It is a reading
 * aid: the proof is bound to the number, and nothing shows the prover meant
 * it as text.
 */
export function asPaddedAscii(value: bigint): string | undefined {
  const bytes: number[] = [];
  let rest = value;
  for (let i = 0; i < 32; i++) {
    bytes.unshift(Number(rest & 0xffn));
    rest >>= 8n;
  }
  if (rest !== 0n) return undefined;
  let length = 32;
  while (length > 0 && bytes[length - 1] === 0) length--;
  if (length === 0 || length === 32) return undefined;
  const used = bytes.slice(0, length);
  if (used.some((byte) => byte < 0x20 || byte > 0x7e)) return undefined;
  return String.fromCharCode(...used);
}
