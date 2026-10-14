import { stopSnarkjs } from '../snarkjs-engine.js';

/** Stops every verifier that keeps threads or files alive, so the process can exit. */
export async function stopEngines(): Promise<void> {
  await stopSnarkjs();
}
