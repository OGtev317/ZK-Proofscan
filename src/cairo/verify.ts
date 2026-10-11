import type { VerifierIdentity } from '../result.js';

/** The largest Cairo proof file read. The examples are 0.3 to 1.0 million characters. */
export const MAX_CAIRO_PROOF_CHARACTERS = 2_500_000;
/**
 * The least security a proof may declare. A STARK proof chooses its own
 * parameters, and the verifier library accepts whatever a proof declares,
 * so without a floor a proof made with trivial parameters would pass.
 */
export const MINIMUM_SECURITY_BITS = 80;

export const CAIRO_LAYOUTS = ['dex', 'dynamic', 'recursive', 'recursive_with_poseidon', 'small', 'starknet', 'starknet_with_keccak'] as const;
export const CAIRO_COMMITMENT_HASHES = ['keccak256_masked160_lsb', 'keccak256_masked248_lsb', 'blake256_masked160_lsb', 'blake256_masked248_lsb'] as const;
/** The two versions of the Stone prover's proof layout. A file does not say which it is. */
export const STONE_VERSIONS = ['stone6', 'stone5'] as const;

export interface CairoParameters {
  layout: (typeof CAIRO_LAYOUTS)[number];
  commitmentHash: (typeof CAIRO_COMMITMENT_HASHES)[number];
  queries: number;
  logCosets: number;
  proofOfWorkBits: number;
  /** queries × logCosets + proofOfWorkBits: the conjectured security the proof declares. */
  securityBits: number;
}

/** A verifier for Cairo STARK proofs in the Stone prover's JSON layout. */
export interface CairoEngine {
  identity: VerifierIdentity;
  /**
   * Resolves with what the proof is about when the verifier accepts it.
   * Rejects with `CairoRejected` when the verifier ran and refused the
   * proof, and with any other error when it could not read the file.
   */
  verify(text: string, parameters: CairoParameters, stone: (typeof STONE_VERSIONS)[number]): Promise<{ programHash: string; output: string[] }>;
}
export class CairoRejected extends Error {}
/** The verifier could not read the file in this Stone layout. Not a verdict on the proof. */
export class CairoUnreadable extends Error {}

export interface CairoChecked {
  verifier: VerifierIdentity;
  parameters: CairoParameters;
}
export type CairoResult =
  | ({ status: 'valid'; stone: (typeof STONE_VERSIONS)[number]; programHash: string; output: string[] } & CairoChecked)
  | ({ status: 'invalid' } & CairoChecked)
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

const FELT = /^0x[0-9a-f]{1,64}$/;
const count = (value: unknown, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;
const record = (value: unknown): Record<string, unknown> | undefined => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);

/** Does a file look like a Cairo proof, enough to be read as one? */
export const looksLikeCairoProof = (text: string): boolean => text.includes('"proof_parameters"') && text.includes('"public_input"');

/** Reads the parameters a Cairo proof declares for itself. */
export function readCairoParameters(text: string): CairoParameters | { reason: string } {
  if (text.length > MAX_CAIRO_PROOF_CHARACTERS) return { reason: 'the file is too large' };
  // Each name must be written once. Read twice, a file could show one
  // number to this tool and another to the verifier.
  for (const name of ['proof_parameters', 'public_input', 'stark', 'fri', 'n_queries', 'log_n_cosets', 'proof_of_work_bits', 'layout', 'commitment_hash']) {
    if (text.split(`"${name}"`).length !== 2) return { reason: 'the file does not name each proof parameter exactly once' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { reason: 'the file is not valid JSON' };
  }
  const top = record(parsed);
  const parameters = record(top?.proof_parameters);
  const stark = record(parameters?.stark);
  const fri = record(stark?.fri);
  const publicInput = record(top?.public_input);
  if (fri === undefined || publicInput === undefined) return { reason: 'the file does not have the parts of a Cairo proof' };
  const layout = CAIRO_LAYOUTS.find((known) => known === publicInput.layout);
  const commitmentHash = CAIRO_COMMITMENT_HASHES.find((known) => known === parameters!.commitment_hash);
  if (layout === undefined || commitmentHash === undefined) return { reason: 'the proof uses a layout or hash this tool does not check' };
  const { n_queries: queries, proof_of_work_bits: proofOfWorkBits } = fri;
  const logCosets = stark!.log_n_cosets;
  if (!count(queries, 1024) || !count(logCosets, 64) || !count(proofOfWorkBits, 256)) return { reason: 'the proof parameters are not whole numbers in range' };
  return { layout, commitmentHash, queries, logCosets, proofOfWorkBits, securityBits: queries * logCosets + proofOfWorkBits };
}

/**
 * Checks a Cairo proof. A proof that declares less security than this tool
 * requires is not checked at all. Otherwise each Stone layout is tried, and
 * a pass under either is a pass.
 */
export async function verifyCairo(text: string, engine: CairoEngine): Promise<CairoResult> {
  const parameters = readCairoParameters(text);
  if ('reason' in parameters) return { status: 'unsupported', reason: parameters.reason };
  if (parameters.securityBits < MINIMUM_SECURITY_BITS) {
    return { status: 'unsupported', reason: `the proof declares ${parameters.securityBits} bits of security, below the ${MINIMUM_SECURITY_BITS} this tool requires` };
  }
  const checked: CairoChecked = { verifier: engine.identity, parameters };
  let rejected = false;
  try {
    for (const stone of STONE_VERSIONS) {
      let result;
      try {
        result = await engine.verify(text, parameters, stone);
      } catch (error) {
        if (error instanceof CairoRejected) rejected = true;
        else if (!(error instanceof CairoUnreadable)) throw error;
        continue;
      }
      if (typeof result.programHash !== 'string' || !FELT.test(result.programHash) || !Array.isArray(result.output) || result.output.length > 4096 || !result.output.every((value) => typeof value === 'string' && FELT.test(value))) {
        throw new TypeError('the verifier did not return a program hash and output');
      }
      return { status: 'valid', stone, programHash: result.programHash, output: result.output, ...checked };
    }
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
  return rejected ? { status: 'invalid', ...checked } : { status: 'unsupported', reason: 'the verifier could not read the file as a Cairo proof in either Stone layout' };
}
