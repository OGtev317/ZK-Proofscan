import type { ProofInputs } from '../inputs.js';
import type { VerifierIdentity } from '../result.js';
import { sha256Hex, utf8 } from '../sha256.js';
import { importSuppliedKey, type Curve, type Protocol } from './importer.js';

/** A verifier for the proof systems snarkjs implements, called with a caller-supplied key. */
export interface SuppliedKeyEngine {
  identity: VerifierIdentity;
  verify(protocol: Protocol, key: unknown, publicSignals: string[], proof: unknown): Promise<boolean>;
}

export interface SuppliedChecked {
  protocol: Protocol;
  curve: Curve;
  verifier: VerifierIdentity;
  verificationKeySha256: string;
  publicInputsSha256: string;
  publicSignals: string[];
}

export type SuppliedResult =
  | ({ status: 'valid' } & SuppliedChecked)
  | ({ status: 'invalid' } & SuppliedChecked)
  | { status: 'unsupported'; reason: string }
  | { status: 'error'; message: string };

/**
 * Checks a proof against the verification key that came with it. A pass
 * means the proof fits that key. It says nothing about which circuit the
 * key belongs to or where the key came from.
 */
export async function verifySuppliedKey(inputs: Required<ProofInputs>, engine: SuppliedKeyEngine): Promise<SuppliedResult> {
  const imported = importSuppliedKey(inputs);
  if (!imported.ok) return { status: 'unsupported', reason: imported.reason };
  const { protocol, curve, proof, key, publicSignals } = imported.value;
  try {
    const checked: SuppliedChecked = {
      protocol,
      curve,
      verifier: engine.identity,
      verificationKeySha256: sha256Hex(utf8(inputs.verificationKey)),
      publicInputsSha256: sha256Hex(utf8(inputs.publicInputs)),
      publicSignals,
    };
    const passed = await engine.verify(protocol, key, publicSignals, proof);
    if (passed !== true && passed !== false) throw new TypeError('the verifier did not return a yes or no answer');
    return { status: passed ? 'valid' : 'invalid', ...checked };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}
