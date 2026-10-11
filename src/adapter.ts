import type { VerifierIdentity } from './result.js';
import { sha256Hex } from './sha256.js';

export interface AdapterArtifact {
  role: string;
  sha256: string;
  source: string;
}

export interface AdapterReview {
  status: 'unreviewed' | 'reviewed';
  note: string;
  reviewer?: string;
  date?: string;
}

/**
 * Everything a report says beyond the verifier's yes or no comes from here.
 * The text is fixed: nothing from a proof file is ever substituted into it.
 */
export interface AdapterManifest {
  id: string;
  revision: number;
  format: string;
  verifier: VerifierIdentity;
  artifacts: AdapterArtifact[];
  circuit: { name: string; source: string; linkToArtifacts: string };
  /** `reading` names a fixed way to also show a public input, as a reading aid only. */
  publicFields: { name: string; meaning: string; reading?: PublicReading }[];
  explanation: {
    claim: string;
    hidden: string[];
    /** Checks a relying application must make itself. This tool performs none of them. */
    applicationChecks: { id: string; description: string }[];
    limits: string[];
    assumptions: string[];
  };
  review: AdapterReview;
}

export type PublicReading = 'packed-ascii' | 'ethereum-address';

export interface LoadedAdapter {
  manifest: AdapterManifest;
  /** SHA-256 of the manifest file: any change of wording changes it. */
  sha256: string;
}

export class AdapterError extends Error {}

const MAX_ADAPTER_BYTES = 32_768;
const MAX_TEXT = 600;
const HASH = /^[0-9a-f]{64}$/;

type Shape = Record<string, (value: unknown, where: string) => unknown>;

function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_TEXT || value !== value.trim()) {
    throw new AdapterError(`${where} must be non-empty text of at most ${MAX_TEXT} characters`);
  }
  return value;
}

function object<T>(shape: Shape, optional: string[] = []) {
  return (value: unknown, where: string): T => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new AdapterError(`${where} must be an object`);
    const record = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      if (!Object.hasOwn(shape, key)) throw new AdapterError(`${where} has unknown field "${key}"`);
    }
    const out: Record<string, unknown> = {};
    for (const [key, read] of Object.entries(shape)) {
      if (!Object.hasOwn(record, key)) {
        if (optional.includes(key)) continue;
        throw new AdapterError(`${where} is missing "${key}"`);
      }
      out[key] = read(record[key], `${where}.${key}`);
    }
    return out as T;
  };
}

function list<T>(read: (value: unknown, where: string) => T) {
  return (value: unknown, where: string): T[] => {
    if (!Array.isArray(value) || value.length === 0 || value.length > 32) throw new AdapterError(`${where} must be a list of 1 to 32 entries`);
    return value.map((entry, i) => read(entry, `${where}[${i}]`));
  };
}

const hash = (value: unknown, where: string): string => {
  if (typeof value !== 'string' || !HASH.test(value)) throw new AdapterError(`${where} must be a lowercase SHA-256`);
  return value;
};

const readManifest = object<AdapterManifest>({
  id: text,
  revision: (value, where) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new AdapterError(`${where} must be a whole number of at least 1`);
    return value;
  },
  format: text,
  verifier: object<VerifierIdentity>({ name: text, version: text }),
  artifacts: list(object<AdapterArtifact>({ role: text, sha256: hash, source: text })),
  circuit: object({ name: text, source: text, linkToArtifacts: text }),
  publicFields: list(object({
    name: text,
    meaning: text,
    reading: (value, where) => {
      if (value !== 'packed-ascii' && value !== 'ethereum-address') throw new AdapterError(`${where} is not a known reading`);
      return value;
    },
  }, ['reading'])),
  explanation: object({
    claim: text,
    hidden: list(text),
    applicationChecks: list(object({
      id: (value, where) => {
        if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) throw new AdapterError(`${where} must be a short lowercase identifier`);
        return value;
      },
      description: text,
    })),
    limits: list(text),
    assumptions: list(text),
  }),
  review: (value, where) => {
    const review = object<AdapterReview>({
      status: (status, at) => {
        if (status !== 'unreviewed' && status !== 'reviewed') throw new AdapterError(`${at} must be "unreviewed" or "reviewed"`);
        return status;
      },
      note: text,
      reviewer: text,
      date: (date, at) => {
        if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AdapterError(`${at} must be a date written YYYY-MM-DD`);
        return date;
      },
    }, ['reviewer', 'date'])(value, where);
    // "Reviewed" with nobody named would let a report claim a review that
    // cannot be traced to a person.
    if (review.status === 'reviewed' && (!review.reviewer || !review.date)) throw new AdapterError(`${where} is marked reviewed without a reviewer and date`);
    if (review.status === 'unreviewed' && (review.reviewer || review.date)) throw new AdapterError(`${where} names a reviewer but is marked unreviewed`);
    return review;
  },
});

/** Reads an adapter manifest strictly and identifies it by the hash of its bytes. */
export function loadAdapter(bytes: Uint8Array): LoadedAdapter {
  if (bytes.length > MAX_ADAPTER_BYTES) throw new AdapterError('the adapter file is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new AdapterError('the adapter file is not valid JSON');
  }
  return { manifest: readManifest(parsed, 'adapter'), sha256: sha256Hex(bytes) };
}
