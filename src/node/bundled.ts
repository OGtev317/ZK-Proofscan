import { readFile } from 'node:fs/promises';
import { bindSemaphoreV4, type AdapterLock, type BoundSemaphoreV4 } from '../semaphore-v4/bind.js';
import { snarkjsEngine } from '../snarkjs-engine.js';

const file = (path: string): Promise<Uint8Array> => readFile(new URL(`../../${path}`, import.meta.url));

/** The adapter, lock, key file and verifier shipped with this build, bound together. */
export async function bundledSemaphoreV4(): Promise<BoundSemaphoreV4> {
  const lock = JSON.parse(new TextDecoder().decode(await file('adapters/semaphore-v4/lock.json'))) as AdapterLock;
  return bindSemaphoreV4({
    adapterBytes: await file('adapters/semaphore-v4/adapter.json'),
    lock,
    keyBytes: await file('artifacts/semaphore-v4/verification-keys.json'),
    engine: snarkjsEngine,
  });
}
