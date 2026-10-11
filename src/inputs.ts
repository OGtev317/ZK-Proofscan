/**
 * What a check is given. A Semaphore v4 proof is one file, checked against
 * keys bundled with this tool. A proof checked with its own verification key
 * comes as three files, the way snarkjs writes them.
 */
/**
 * Each part is the content of one file. A text file is its text. A file
 * that is not text, such as a proof written by Barretenberg, is carried as
 * `base64:` followed by its bytes in base64, so it can travel through the
 * same paths and sit in an export.
 */
export interface ProofInputs {
  proof: string;
  publicInputs?: string;
  verificationKey?: string;
}

/** The largest proof part any format accepts; each format applies its own limit after this. */
export const MAX_PROOF_PART_CHARACTERS = 2_500_000;
export const MAX_PUBLIC_INPUTS_CHARACTERS = 65_536;
export const MAX_VERIFICATION_KEY_CHARACTERS = 262_144;
/** The most public inputs a supplied-key proof may have. */
export const MAX_PUBLIC_INPUTS = 512;

const BINARY_PREFIX = 'base64:';
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const isBinaryPart = (part: string): boolean => part.startsWith(BINARY_PREFIX);

function fromBase64(text: string): Uint8Array | undefined {
  if (!BASE64.test(text)) return undefined;
  const binary = atob(text);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  // One spelling per byte string: unused bits in the last group must be zero.
  return toBase64(bytes) === text ? bytes : undefined;
}
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Carries a file's bytes as a part. */
export const binaryPart = (bytes: Uint8Array): string => `${BINARY_PREFIX}${toBase64(bytes)}`;

/**
 * The exact bytes of the file a part stands for: the decoded bytes of a
 * binary part, or the UTF-8 bytes of a text part. Hashes of inputs are
 * always over these bytes. A malformed binary part stands for its own text.
 */
export function partBytes(part: string): Uint8Array {
  const decoded = isBinaryPart(part) ? fromBase64(part.slice(BINARY_PREFIX.length)) : undefined;
  return decoded ?? new TextEncoder().encode(part);
}

/** The bytes of a binary part, or undefined if the part is text or malformed. */
export const binaryBytes = (part: string): Uint8Array | undefined => (isBinaryPart(part) ? fromBase64(part.slice(BINARY_PREFIX.length)) : undefined);
