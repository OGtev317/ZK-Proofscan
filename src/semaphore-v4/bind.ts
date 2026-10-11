import { AdapterError, loadAdapter, type LoadedAdapter } from '../adapter.js';
import { loadSemaphoreV4Keys, type SemaphoreV4Keys } from './artifact.js';
import type { Groth16Engine } from './verify.js';

/** The adapter revision this build ships: one explanation, identified by hash. */
export interface AdapterLock {
  id: string;
  revision: number;
  sha256: string;
}

export interface BoundSemaphoreV4 {
  adapter: LoadedAdapter;
  keys: SemaphoreV4Keys;
  engine: Groth16Engine;
}

export const SEMAPHORE_V4_PUBLIC_FIELDS = ['group root', 'nullifier', 'hashed message', 'hashed scope'] as const;

/**
 * Ties one explanation to the exact verifier and key file it was written
 * for. If any of the four parts is exchanged for another, binding fails and
 * no report can pair that explanation with that verification.
 */
export function bindSemaphoreV4(parts: { adapterBytes: Uint8Array; lock: AdapterLock; keyBytes: Uint8Array; engine: Groth16Engine }): BoundSemaphoreV4 {
  const adapter = loadAdapter(parts.adapterBytes);
  const { manifest } = adapter;
  const { lock, engine } = parts;
  if (adapter.sha256 !== lock.sha256 || manifest.id !== lock.id || manifest.revision !== lock.revision) {
    throw new AdapterError(`the adapter file is not the locked ${lock.id} revision ${lock.revision}`);
  }
  if (manifest.id !== 'semaphore-v4' || manifest.format !== 'semaphore-v4') throw new AdapterError('the adapter is not for Semaphore v4 proofs');
  if (manifest.verifier.name !== engine.identity.name || manifest.verifier.version !== engine.identity.version) {
    throw new AdapterError(`the adapter was written for ${manifest.verifier.name} ${manifest.verifier.version}, not ${engine.identity.name} ${engine.identity.version}`);
  }
  const names = manifest.publicFields.map((field) => field.name);
  if (names.length !== SEMAPHORE_V4_PUBLIC_FIELDS.length || names.some((name, i) => name !== SEMAPHORE_V4_PUBLIC_FIELDS[i])) {
    throw new AdapterError('the adapter does not describe the four Semaphore v4 public inputs in circuit order');
  }
  if (manifest.artifacts.length !== 1 || manifest.artifacts[0]!.role !== 'verification-keys') {
    throw new AdapterError('the adapter must name exactly one verification-keys artifact');
  }
  const keys = loadSemaphoreV4Keys(parts.keyBytes);
  if (keys.sha256 !== manifest.artifacts[0]!.sha256) throw new AdapterError('the verification keys are not the ones the adapter names');
  return { adapter, keys, engine };
}
