import { sha256Hex } from '../sha256.js';
import { MAX_DEPTH } from './importer.js';

/** SHA-256 of `verification-keys.json` from `@semaphore-protocol/proof` 4.14.3. */
export const SEMAPHORE_V4_KEYS_SHA256 = 'd96ec60593b6fc2334f1f04e008e07425d5536d7777f6ac21d996fc80779b3c9';

export interface SemaphoreV4Keys {
  sha256: string;
  keyForDepth(depth: number): Record<string, unknown>;
}

export class ArtifactMismatchError extends Error {}

/**
 * Accepts the verification-key file only if its bytes match the pinned hash.
 * A matching hash means the file is the one that was pinned; it is not
 * evidence about how the keys were produced.
 */
export function loadSemaphoreV4Keys(bytes: Uint8Array): SemaphoreV4Keys {
  const actual = sha256Hex(bytes);
  if (actual !== SEMAPHORE_V4_KEYS_SHA256) {
    throw new ArtifactMismatchError(`verification keys have SHA-256 ${actual}, expected ${SEMAPHORE_V4_KEYS_SHA256}`);
  }
  const all = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown> & { vk_delta_2: unknown[]; IC: unknown[] };
  return {
    sha256: actual,
    keyForDepth(depth) {
      if (!Number.isInteger(depth) || depth < 1 || depth > MAX_DEPTH) throw new RangeError('unsupported tree depth');
      return { ...all, vk_delta_2: all.vk_delta_2[depth - 1], IC: all.IC[depth - 1] };
    },
  };
}
