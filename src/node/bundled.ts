import { readFile } from 'node:fs/promises';
import { bindRecordedCircuit } from '../recorded/bind.js';
import { loadKeyRegistry } from '../registry.js';
import type { Scanning } from '../scan.js';
import { bindSemaphoreV4, type AdapterLock, type BoundSemaphoreV4 } from '../semaphore-v4/bind.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../snarkjs-engine.js';

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

/** Everything this build checks with. */
/** Adapters for circuits whose key the user supplies and the registry records. */
export const RECORDED_ADAPTERS = ['zk-email-proof-of-twitter'] as const;

export async function bundledScanning(): Promise<Scanning> {
  const registry = loadKeyRegistry(await file('registry/keys.json'));
  const recorded = await Promise.all(
    RECORDED_ADAPTERS.map(async (id) =>
      bindRecordedCircuit({
        adapterBytes: await file(`adapters/${id}/adapter.json`),
        lock: JSON.parse(new TextDecoder().decode(await file(`adapters/${id}/lock.json`))) as AdapterLock,
        registry,
        verifier: snarkjsSuppliedKeyEngine.identity,
      }),
    ),
  );
  return { semaphoreV4: await bundledSemaphoreV4(), suppliedKey: snarkjsSuppliedKeyEngine, registry, recorded };
}
