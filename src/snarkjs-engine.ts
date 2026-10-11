import { groth16 } from 'snarkjs';
import type { Groth16Engine } from './semaphore-v4/verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const SNARKJS_VERSION = '0.7.6';

export const snarkjsEngine: Groth16Engine = {
  identity: { name: 'snarkjs', version: SNARKJS_VERSION },
  verify: (key, publicSignals, proof) => groth16.verify(key as never, publicSignals as never, proof as never),
};

/** snarkjs keeps worker threads alive for the curve; a process must stop them to exit. */
export async function stopSnarkjs(): Promise<void> {
  const curve = (globalThis as { curve_bn128?: { terminate(): Promise<void> } }).curve_bn128;
  if (curve) await curve.terminate();
}
