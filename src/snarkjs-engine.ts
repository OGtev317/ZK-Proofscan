import * as snarkjs from 'snarkjs';
import type { Groth16Engine } from './semaphore-v4/verify.js';
import type { SuppliedKeyEngine } from './supplied-key/verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const SNARKJS_VERSION = '0.7.6';

const identity = { name: 'snarkjs', version: SNARKJS_VERSION };
type Verify = (key: never, publicSignals: never, proof: never) => Promise<boolean>;
const verifiers = snarkjs as unknown as Record<'groth16' | 'plonk' | 'fflonk', { verify: Verify }>;

export const snarkjsEngine: Groth16Engine = {
  identity,
  verify: (key, publicSignals, proof) => verifiers.groth16.verify(key as never, publicSignals as never, proof as never),
};

export const snarkjsSuppliedKeyEngine: SuppliedKeyEngine = {
  identity,
  verify: (protocol, key, publicSignals, proof) => verifiers[protocol].verify(key as never, publicSignals as never, proof as never),
};

/** snarkjs keeps worker threads alive for each curve; a process must stop them to exit. */
export async function stopSnarkjs(): Promise<void> {
  const curves = globalThis as { curve_bn128?: { terminate(): Promise<void> }; curve_bls12381?: { terminate(): Promise<void> } };
  await curves.curve_bn128?.terminate();
  await curves.curve_bls12381?.terminate();
}
