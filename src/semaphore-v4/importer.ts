import { BASE_FIELD, SCALAR_FIELD, UINT256_LIMIT, parseCanonical } from '../field.js';

export const MIN_DEPTH = 1;
export const MAX_DEPTH = 32;
export const MAX_PROOF_CHARACTERS = 8192;

const KEYS = ['merkleTreeDepth', 'merkleTreeRoot', 'message', 'nullifier', 'scope', 'points'] as const;

export interface SemaphoreV4Proof {
  merkleTreeDepth: number;
  merkleTreeRoot: bigint;
  message: bigint;
  nullifier: bigint;
  scope: bigint;
  /** Packed Groth16 proof: eight base-field coordinates. */
  points: bigint[];
}

export type ImportResult = { ok: true; proof: SemaphoreV4Proof } | { ok: false; reason: string };

const reject = (reason: string): ImportResult => ({ ok: false, reason });

/**
 * Reads a Semaphore v4 proof as written by `@semaphore-protocol/proof`. Only
 * that exact shape is accepted: the six known fields, numbers as canonical
 * decimal strings, each within its range. Nothing here needs a private input.
 */
export function importSemaphoreV4(text: string): ImportResult {
  if (text.length > MAX_PROOF_CHARACTERS) return reject(`the file is larger than ${MAX_PROOF_CHARACTERS} characters`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return reject('the file is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return reject('the file is not a JSON object');
  const record = parsed as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (!(KEYS as readonly string[]).includes(key)) return reject(`unknown field "${key}"`);
  }
  for (const key of KEYS) {
    if (!Object.hasOwn(record, key)) return reject(`missing field "${key}"`);
  }

  const depth = record.merkleTreeDepth;
  if (typeof depth !== 'number' || !Number.isInteger(depth) || depth < MIN_DEPTH || depth > MAX_DEPTH) {
    return reject(`merkleTreeDepth must be a whole number from ${MIN_DEPTH} to ${MAX_DEPTH}`);
  }
  const merkleTreeRoot = parseCanonical(record.merkleTreeRoot, SCALAR_FIELD);
  if (merkleTreeRoot === undefined) return reject('merkleTreeRoot is not a canonical decimal value below the scalar field size');
  const nullifier = parseCanonical(record.nullifier, SCALAR_FIELD);
  if (nullifier === undefined) return reject('nullifier is not a canonical decimal value below the scalar field size');
  const message = parseCanonical(record.message, UINT256_LIMIT);
  if (message === undefined) return reject('message is not a canonical decimal value below 2^256');
  const scope = parseCanonical(record.scope, UINT256_LIMIT);
  if (scope === undefined) return reject('scope is not a canonical decimal value below 2^256');

  const rawPoints = record.points;
  if (!Array.isArray(rawPoints) || rawPoints.length !== 8) return reject('points must be a list of exactly 8 values');
  const points: bigint[] = [];
  for (const raw of rawPoints) {
    const point = parseCanonical(raw, BASE_FIELD);
    if (point === undefined) return reject('points contains a value that is not a canonical decimal below the base field size');
    points.push(point);
  }

  // JSON.parse keeps only the last of two fields with the same name, so a
  // file could show one value to a reader and another to this tool. Every
  // string value above is digits only, so a quoted field name in the text can
  // only be a field name.
  for (const key of KEYS) {
    if (text.split(`"${key}"`).length !== 2) return reject(`field "${key}" appears more than once`);
  }

  return { ok: true, proof: { merkleTreeDepth: depth, merkleTreeRoot, message, nullifier, scope, points } };
}
