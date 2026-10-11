import { ordered } from './canonical.js';
import { sha256Hex, utf8 } from './sha256.js';

/** SHA-256 of `registry/keys.json` as shipped. Changing the registry means changing this. */
export const KEY_REGISTRY_SHA256 = 'ed8732bc657197d862623e35b8b46292602db9c9d1ce854e2824487cbee17655';

/** How far a recorded key has been tied to the source of its circuit. */
export type CircuitLink = 'established' | 'partly-established' | 'unconfirmed';

/**
 * One published file of verification keys. Each part answers a different
 * question, and none of them stands in for another: where the file came
 * from, whether it is tied to circuit source, whether a maintainer checked
 * this entry, and whether this tool holds an explanation for the circuit.
 */
export interface RegistryArtifact {
  id: string;
  description: string;
  provenance: { publisher: string; package: string; version: string; file: string; url: string; sha256: string };
  circuit: { name: string; source: string };
  circuitLink: { status: CircuitLink; note: string };
  /** The adapter in this tool that explains the circuit, if there is one. Its review status is its own. */
  explanationAdapter: string | null;
  entryReview: { status: 'unreviewed' | 'reviewed'; note: string; reviewer?: string; date?: string };
  keys: { label: string; contentSha256: string }[];
}

export interface RecognisedKey {
  artifact: Omit<RegistryArtifact, 'keys'>;
  label: string;
}

export interface KeyRegistry {
  sha256: string;
  revision: number;
  artifacts: RegistryArtifact[];
  /** Finds a key by the hash of its content. An unknown key is simply not found. */
  find(contentSha256: string): RecognisedKey | undefined;
}

export class RegistryError extends Error {}

/**
 * Identifies a verification key by what it says, not by how its file is
 * laid out: SHA-256 of the key with spacing removed and fields in a fixed
 * order. Every value counts, including ones a verifier does not read, so a
 * key that differs anywhere is a different key.
 */
export const keyContentSha256 = (key: unknown): string => sha256Hex(utf8(ordered(key)));

const HASH = /^[0-9a-f]{64}$/;
const MAX_REGISTRY_BYTES = 262_144;

function fields(value: unknown, where: string, names: string[], optional: string[] = []): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new RegistryError(`${where} must be an object`);
  const found = Object.keys(value);
  const missing = names.filter((name) => !found.includes(name));
  const extra = found.filter((name) => !names.includes(name) && !optional.includes(name));
  if (missing.length > 0 || extra.length > 0) throw new RegistryError(`${where} does not have exactly the expected fields`);
  return value as Record<string, unknown>;
}
function text(value: unknown, where: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 600 || value !== value.trim()) throw new RegistryError(`${where} must be non-empty text`);
  return value;
}
function hash(value: unknown, where: string): string {
  if (typeof value !== 'string' || !HASH.test(value)) throw new RegistryError(`${where} must be a SHA-256 in lower-case hex`);
  return value;
}
function list(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value) || value.length === 0) throw new RegistryError(`${where} must be a non-empty list`);
  return value;
}

function artifact(value: unknown, where: string): RegistryArtifact {
  const raw = fields(value, where, ['id', 'description', 'provenance', 'circuit', 'circuitLink', 'explanationAdapter', 'entryReview', 'keys']);
  const provenance = fields(raw.provenance, `${where}.provenance`, ['publisher', 'package', 'version', 'file', 'url', 'sha256']);
  const circuit = fields(raw.circuit, `${where}.circuit`, ['name', 'source']);
  const link = fields(raw.circuitLink, `${where}.circuitLink`, ['status', 'note']);
  const status = (['established', 'partly-established', 'unconfirmed'] as const).find((known) => known === link.status);
  if (status === undefined) throw new RegistryError(`${where}.circuitLink.status is not a known status`);
  const review = fields(raw.entryReview, `${where}.entryReview`, ['status', 'note'], ['reviewer', 'date']);
  if (review.status !== 'unreviewed' && review.status !== 'reviewed') throw new RegistryError(`${where}.entryReview.status is not a known status`);
  // A review is a named person on a date, or it is not a review.
  if ((review.status === 'reviewed') !== (review.reviewer !== undefined && review.date !== undefined)) {
    throw new RegistryError(`${where}.entryReview must name a reviewer and a date exactly when it is reviewed`);
  }
  return {
    id: text(raw.id, `${where}.id`),
    description: text(raw.description, `${where}.description`),
    provenance: {
      publisher: text(provenance.publisher, `${where}.provenance.publisher`),
      package: text(provenance.package, `${where}.provenance.package`),
      version: text(provenance.version, `${where}.provenance.version`),
      file: text(provenance.file, `${where}.provenance.file`),
      url: text(provenance.url, `${where}.provenance.url`),
      sha256: hash(provenance.sha256, `${where}.provenance.sha256`),
    },
    circuit: { name: text(circuit.name, `${where}.circuit.name`), source: text(circuit.source, `${where}.circuit.source`) },
    circuitLink: { status, note: text(link.note, `${where}.circuitLink.note`) },
    explanationAdapter: raw.explanationAdapter === null ? null : text(raw.explanationAdapter, `${where}.explanationAdapter`),
    entryReview: {
      status: review.status,
      note: text(review.note, `${where}.entryReview.note`),
      ...(review.reviewer === undefined ? {} : { reviewer: text(review.reviewer, `${where}.entryReview.reviewer`) }),
      ...(review.date === undefined ? {} : { date: text(review.date, `${where}.entryReview.date`) }),
    },
    keys: list(raw.keys, `${where}.keys`).map((entry, i) => {
      const key = fields(entry, `${where}.keys[${i}]`, ['label', 'contentSha256']);
      return { label: text(key.label, `${where}.keys[${i}].label`), contentSha256: hash(key.contentSha256, `${where}.keys[${i}].contentSha256`) };
    }),
  };
}

/**
 * Reads the registry of recorded keys. `expected` is the hash this build
 * was made with; a registry file with any other content is refused, so an
 * altered registry cannot make an unknown key look recorded.
 */
export function loadKeyRegistry(bytes: Uint8Array, expected: string = KEY_REGISTRY_SHA256): KeyRegistry {
  if (bytes.length > MAX_REGISTRY_BYTES) throw new RegistryError('the key registry is too large');
  const sha256 = sha256Hex(bytes);
  if (sha256 !== expected) throw new RegistryError(`the key registry has SHA-256 ${sha256}, expected ${expected}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RegistryError('the key registry is not valid JSON');
  }
  const raw = fields(parsed, 'registry', ['registryVersion', 'revision', 'artifacts']);
  if (raw.registryVersion !== 1) throw new RegistryError('the key registry version is not supported');
  if (typeof raw.revision !== 'number' || !Number.isInteger(raw.revision) || raw.revision < 1) throw new RegistryError('registry.revision must be a positive whole number');
  const artifacts = list(raw.artifacts, 'registry.artifacts').map((entry, i) => artifact(entry, `registry.artifacts[${i}]`));

  const byContent = new Map<string, RecognisedKey>();
  const ids = new Set<string>();
  for (const { keys, ...rest } of artifacts) {
    if (ids.has(rest.id)) throw new RegistryError('two registry artifacts share an id');
    ids.add(rest.id);
    for (const key of keys) {
      // One key recorded twice would make "which key is this" ambiguous.
      if (byContent.has(key.contentSha256)) throw new RegistryError('the same key is recorded twice');
      byContent.set(key.contentSha256, { artifact: rest, label: key.label });
    }
  }
  return { sha256, revision: raw.revision, artifacts, find: (contentSha256) => byContent.get(contentSha256) };
}
