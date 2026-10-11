import { BASE_FIELD, BLS12_381_BASE_FIELD, BLS12_381_SCALAR_FIELD, parseCanonical, SCALAR_FIELD } from '../field.js';
import { MAX_PUBLIC_INPUTS, MAX_PUBLIC_INPUTS_CHARACTERS, MAX_VERIFICATION_KEY_CHARACTERS } from '../inputs.js';

export const MAX_SUPPLIED_PROOF_CHARACTERS = 16_384;

/** The proof systems snarkjs writes, which this file reads. */
export type SnarkjsProtocol = 'groth16' | 'plonk' | 'fflonk';
/** Every proof system a supplied key can be for. */
export type Protocol = SnarkjsProtocol | 'ultrahonk';
export type Curve = 'bn128' | 'bls12381';

const FIELDS: Record<Curve, { base: bigint; scalar: bigint }> = {
  bn128: { base: BASE_FIELD, scalar: SCALAR_FIELD },
  bls12381: { base: BLS12_381_BASE_FIELD, scalar: BLS12_381_SCALAR_FIELD },
};
/** The proof systems and curves snarkjs verifies. */
const CURVES: Record<SnarkjsProtocol, readonly Curve[]> = { groth16: ['bn128', 'bls12381'], plonk: ['bn128'], fflonk: ['bn128'] };

export interface SuppliedKeyProof {
  protocol: SnarkjsProtocol;
  curve: Curve;
  /** Passed to the verifier exactly as read, after every value was checked. */
  proof: Record<string, unknown>;
  key: Record<string, unknown>;
  publicSignals: string[];
}

export type SuppliedImport = { ok: true; value: SuppliedKeyProof } | { ok: false; reason: string };

/**
 * Reads JSON that can only be read one way: no escapes, and writing the
 * parsed value back out gives the same text. That refuses a repeated field,
 * which different programs resolve differently, and any number or string
 * not written plainly.
 */
function readPlainJson(text: string): unknown {
  if (text.includes('\\')) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  return JSON.stringify(parsed) === text.replace(/\s+/g, '') ? parsed : undefined;
}

type Check = (value: unknown) => boolean;
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const tuple = (...parts: Check[]): Check => (value) => Array.isArray(value) && value.length === parts.length && parts.every((part, i) => part(value[i]));
const either = (a: Check, b: Check): Check => (value) => a(value) || b(value);
const is = (expected: unknown): Check => (value) => value === expected;
const count = (max: number): Check => (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max;

/** Exactly these fields, each passing its check. */
const record = (shape: Record<string, Check>): Check => (value) => {
  if (!isRecord(value)) return false;
  const names = Object.keys(value);
  return names.length === Object.keys(shape).length && names.every((name) => Object.hasOwn(shape, name) && shape[name]!(value[name]));
};

function shapes(curve: Curve, protocol: SnarkjsProtocol): { proof: Check; key: (value: unknown) => boolean } {
  const { base, scalar } = FIELDS[curve];
  const fq: Check = (value) => parseCanonical(value, base) !== undefined;
  const fr: Check = (value) => parseCanonical(value, scalar) !== undefined;
  // Points are written with a third coordinate of one. A key, unlike a
  // proof, may hold the point at infinity, which snarkjs writes as 0, 1, 0.
  const g1 = tuple(fq, fq, is('1'));
  const g1OrInfinity = either(g1, tuple(is('0'), is('1'), is('0')));
  const g2 = tuple(tuple(fq, fq), tuple(fq, fq), tuple(is('1'), is('0')));
  const fq6 = tuple(tuple(fq, fq), tuple(fq, fq), tuple(fq, fq));
  const names = { protocol: is(protocol), curve: is(curve) };
  const each = (check: Check, fields: string[]): Record<string, Check> => Object.fromEntries(fields.map((field) => [field, check]));
  const keyHead = { ...names, nPublic: count(MAX_PUBLIC_INPUTS) };

  switch (protocol) {
    case 'groth16':
      return {
        proof: record({ pi_a: g1, pi_b: g2, pi_c: g1, ...names }),
        key: (value) =>
          record({ ...keyHead, vk_alpha_1: g1, vk_beta_2: g2, vk_gamma_2: g2, vk_delta_2: g2, vk_alphabeta_12: tuple(fq6, fq6), IC: Array.isArray })(value) &&
          (value as { IC: unknown[]; nPublic: number }).IC.length === (value as { nPublic: number }).nPublic + 1 &&
          (value as { IC: unknown[] }).IC.every(g1OrInfinity),
      };
    case 'plonk':
      return {
        proof: record({ ...each(g1, ['A', 'B', 'C', 'Z', 'T1', 'T2', 'T3', 'Wxi', 'Wxiw']), ...each(fr, ['eval_a', 'eval_b', 'eval_c', 'eval_s1', 'eval_s2', 'eval_zw']), ...names }),
        key: record({ ...keyHead, power: count(28), ...each(fr, ['k1', 'k2', 'w']), ...each(g1OrInfinity, ['Qm', 'Ql', 'Qr', 'Qo', 'Qc', 'S1', 'S2', 'S3']), X_2: g2 }),
      };
    case 'fflonk':
      return {
        proof: record({
          polynomials: record(each(g1, ['C1', 'C2', 'W1', 'W2'])),
          evaluations: record(each(fr, ['ql', 'qr', 'qm', 'qo', 'qc', 's1', 's2', 's3', 'a', 'b', 'c', 'z', 'zw', 't1w', 't2w', 'inv'])),
          ...names,
        }),
        key: record({ ...keyHead, power: count(28), ...each(fr, ['k1', 'k2', 'w', 'w3', 'w4', 'w8', 'wr']), X_2: g2, C0: g1OrInfinity }),
      };
  }
}

/**
 * Reads a proof, its public inputs and its verification key as snarkjs
 * writes them. Every number must be a plain decimal inside its field, and
 * the three files must agree on the proof system, the curve and the number
 * of public inputs. Reasons never repeat text from the files.
 */
export function importSuppliedKey(texts: { proof: string; publicInputs: string; verificationKey: string }): SuppliedImport {
  const reject = (reason: string): SuppliedImport => ({ ok: false, reason });
  if (texts.proof.length > MAX_SUPPLIED_PROOF_CHARACTERS) return reject('the proof file is too large');
  if (texts.publicInputs.length > MAX_PUBLIC_INPUTS_CHARACTERS) return reject('the public inputs file is too large');
  if (texts.verificationKey.length > MAX_VERIFICATION_KEY_CHARACTERS) return reject('the verification key file is too large');

  const proof = readPlainJson(texts.proof);
  const signals = readPlainJson(texts.publicInputs);
  const key = readPlainJson(texts.verificationKey);
  if (!isRecord(proof)) return reject('the proof file is not plainly written JSON');
  if (!Array.isArray(signals)) return reject('the public inputs file is not a plainly written JSON list');
  if (!isRecord(key)) return reject('the verification key file is not plainly written JSON');

  const protocol = (['groth16', 'plonk', 'fflonk'] as const).find((name) => name === proof.protocol);
  if (protocol === undefined) return reject('the proof does not name a proof system this tool checks');
  const curve = CURVES[protocol].find((name) => name === proof.curve);
  if (curve === undefined) return reject('the proof does not name a curve this tool checks for that proof system');
  if (key.protocol !== protocol || key.curve !== curve) return reject('the verification key is for a different proof system or curve than the proof');

  const shape = shapes(curve, protocol);
  if (!shape.proof(proof)) return reject('the proof does not have exactly the fields and in-range values of that proof system');
  if (!shape.key(key)) return reject('the verification key does not have exactly the fields and in-range values of that proof system');
  if (signals.length !== key.nPublic) return reject('the number of public inputs is not the number the verification key expects');
  if (!signals.every((signal) => parseCanonical(signal, FIELDS[curve].scalar) !== undefined)) return reject('a public input is not a plain decimal number inside the field');

  return { ok: true, value: { protocol, curve, proof, key, publicSignals: signals as string[] } };
}
