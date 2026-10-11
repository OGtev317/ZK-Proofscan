import { AdapterError, loadAdapter, type LoadedAdapter } from '../adapter.js';
import type { KeyRegistry } from '../registry.js';
import type { VerifierIdentity } from '../result.js';
import type { AdapterLock } from '../semaphore-v4/bind.js';

export const RECORDED_GROTH16_FORMAT = 'snarkjs-groth16-bn128';

/** An explanation tied to one recorded verification key, for a proof that comes with that key. */
export interface BoundRecordedCircuit {
  adapter: LoadedAdapter;
  /** The registry artifact whose single key this explanation is for. */
  artifactId: string;
  keyContentSha256: string;
}

/**
 * Ties an explanation to the one recorded key it was written for. The chain
 * is: lock names the adapter file by hash; the adapter names the published
 * key file by hash; the registry records that file, names this adapter for
 * it, and holds the key's content hash. Exchange any part and binding fails,
 * so the explanation cannot be shown for another key.
 */
export function bindRecordedCircuit(parts: { adapterBytes: Uint8Array; lock: AdapterLock; registry: KeyRegistry; verifier: VerifierIdentity }): BoundRecordedCircuit {
  const adapter = loadAdapter(parts.adapterBytes);
  const { manifest } = adapter;
  const { lock, registry, verifier } = parts;
  if (adapter.sha256 !== lock.sha256 || manifest.id !== lock.id || manifest.revision !== lock.revision) {
    throw new AdapterError(`the adapter file is not the locked ${lock.id} revision ${lock.revision}`);
  }
  if (manifest.format !== RECORDED_GROTH16_FORMAT) throw new AdapterError('the adapter is not for a Groth16 proof on BN254 checked with a recorded key');
  if (manifest.verifier.name !== verifier.name || manifest.verifier.version !== verifier.version) {
    throw new AdapterError(`the adapter was written for ${manifest.verifier.name} ${manifest.verifier.version}, not ${verifier.name} ${verifier.version}`);
  }
  if (manifest.artifacts.length !== 1 || manifest.artifacts[0]!.role !== 'verification-key') throw new AdapterError('the adapter must name exactly one verification-key artifact');
  const recorded = registry.artifacts.filter((artifact) => artifact.explanationAdapter === manifest.id);
  if (recorded.length !== 1) throw new AdapterError('the registry does not name this adapter for exactly one artifact');
  const [artifact] = recorded;
  if (artifact!.provenance.sha256 !== manifest.artifacts[0]!.sha256) throw new AdapterError('the adapter names a different key file than the registry records');
  if (artifact!.circuit.source !== manifest.circuit.source) throw new AdapterError('the adapter and the registry name different circuit sources');
  if (artifact!.keys.length !== 1) throw new AdapterError('the recorded artifact must hold exactly one key');
  return { adapter, artifactId: artifact!.id, keyContentSha256: artifact!.keys[0]!.contentSha256 };
}
