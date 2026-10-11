import type { Checked, VerificationResult, VerifierIdentity } from '../result.js';
import type { SemaphoreV4Keys } from './artifact.js';
import { hashToField } from './hash.js';
import { importSemaphoreV4, type SemaphoreV4Proof } from './importer.js';

/** A Groth16 verifier with the call shape of `snarkjs.groth16.verify`. */
export interface Groth16Engine {
  identity: VerifierIdentity;
  verify(key: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
}

/** The four public inputs of the Semaphore v4 circuit, in circuit order. */
export function publicSignals(proof: SemaphoreV4Proof): string[] {
  return [proof.merkleTreeRoot, proof.nullifier, hashToField(proof.message), hashToField(proof.scope)].map(String);
}

function unpack(points: bigint[]): unknown {
  const p = points.map(String);
  return {
    pi_a: [p[0], p[1]],
    pi_b: [[p[3], p[2]], [p[5], p[4]]],
    pi_c: [p[6], p[7]],
    protocol: 'groth16',
    curve: 'bn128',
  };
}

/**
 * Checks one Semaphore v4 proof file. This is cryptographic verification
 * only: it does not check that the group root is one any application accepts,
 * or that the nullifier has not been used before.
 */
export async function verifySemaphoreV4(text: string, keys: SemaphoreV4Keys, engine: Groth16Engine): Promise<VerificationResult> {
  const imported = importSemaphoreV4(text);
  if (!imported.ok) return { status: 'unsupported', reason: imported.reason };
  const { proof } = imported;
  try {
    const signals = publicSignals(proof);
    const checked: Checked = {
      format: 'semaphore-v4',
      verifier: engine.identity,
      artifact: { sha256: keys.sha256, merkleTreeDepth: proof.merkleTreeDepth },
      message: proof.message.toString(),
      scope: proof.scope.toString(),
      publicSignals: signals,
    };
    const passed = await engine.verify(keys.keyForDepth(proof.merkleTreeDepth), signals, unpack(proof.points));
    if (passed !== true && passed !== false) throw new TypeError('the verifier did not return a yes or no answer');
    return { status: passed ? 'valid' : 'invalid', ...checked };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
