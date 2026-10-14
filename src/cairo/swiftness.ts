import { CairoRejected, CairoUnreadable, type CairoParameters, type STONE_VERSIONS } from './verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const SWIFTNESS_VERSION = '1.0.0';

const HASH_NAMES: Record<string, string> = {
  keccak256_masked160_lsb: 'keccak_160_lsb',
  keccak256_masked248_lsb: 'keccak_248_lsb',
  blake256_masked160_lsb: 'blake2s_160_lsb',
  blake256_masked248_lsb: 'blake2s_248_lsb',
};

/** The package holds one build of the verifier for each layout, hash and Stone version; this is its folder name. */
export const swiftnessBuild = (parameters: CairoParameters, stone: (typeof STONE_VERSIONS)[number]): string =>
  `swiftness_${parameters.layout}_${HASH_NAMES[parameters.commitmentHash]}_${stone}`;

/**
 * What a failure inside the verifier means. Only the verifier's own two
 * kinds of answer are read as answers: a failed verification, and a file it
 * could not parse. Anything else, such as running out of stack or memory,
 * is the verifier failing to run, never a verdict on the proof. Found on
 * WebKit: a worker's smaller stack made one Stone layout overflow, and the
 * other layout's rejection was then reported as a failed proof. The
 * library's own words are not passed on: they can quote the file.
 */
export function swiftnessFailure(message: string): Error {
  if (message.startsWith('Proof verification failed')) return new CairoRejected('the verifier rejected the proof');
  if (message.startsWith('Error parsing proof')) return new CairoUnreadable('the verifier could not read the file');
  return new Error('the Cairo verifier failed while running');
}

/** The verifier's answer for a proof it accepted. */
export function swiftnessResult(result: string): { programHash: string; output: string[] } {
  let parsed: { program_hash?: unknown; output_hash?: unknown; output?: unknown };
  try {
    parsed = JSON.parse(result) as typeof parsed;
  } catch {
    throw new Error('the Cairo verifier returned something that is not JSON');
  }
  // The package's build names the output list `output_hash`; the source names it `output`.
  return { programHash: parsed.program_hash as string, output: (parsed.output ?? parsed.output_hash) as string[] };
}
