/// <reference types="vite/client" />
// Verification runs here so the page stays responsive. The worker fetches
// only its own bundled files and never sends a proof anywhere.
import adapterUrl from '../adapters/semaphore-v4/adapter.json?url';
import lockUrl from '../adapters/semaphore-v4/lock.json?url';
import keysUrl from '../artifacts/semaphore-v4/verification-keys.json?url';
import registryUrl from '../registry/keys.json?url';
import riscZeroUrl from '../artifacts/risc-zero-groth16/parameters-3.0.0.json?url';
import twitterAdapterUrl from '../adapters/zk-email-proof-of-twitter/adapter.json?url';
import twitterLockUrl from '../adapters/zk-email-proof-of-twitter/lock.json?url';
import { rerunExport } from '../src/export.js';
import { bindSemaphoreV4, type AdapterLock } from '../src/semaphore-v4/bind.js';
import { bindRecordedCircuit } from '../src/recorded/bind.js';
import { loadKeyRegistry } from '../src/registry.js';
import { loadRiscZeroParameters } from '../src/risc-zero/parameters.js';
import { scan, type Scanning } from '../src/scan.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../src/snarkjs-engine.js';
import type { Request, Response } from './protocol.js';

async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`could not load a bundled file (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

let binding: Promise<Scanning> | undefined;
const bound = (): Promise<Scanning> =>
  (binding ??= (async () => {
    const [adapterBytes, lockBytes, keyBytes, registryBytes, twitterAdapter, twitterLock, riscZeroBytes] = await Promise.all(
      [adapterUrl, lockUrl, keysUrl, registryUrl, twitterAdapterUrl, twitterLockUrl, riscZeroUrl].map(bytes),
    ) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    const lock = JSON.parse(new TextDecoder().decode(lockBytes)) as AdapterLock;
    const registry = loadKeyRegistry(registryBytes);
    const recorded = [
      bindRecordedCircuit({ adapterBytes: twitterAdapter, lock: JSON.parse(new TextDecoder().decode(twitterLock)) as AdapterLock, registry, verifier: snarkjsSuppliedKeyEngine.identity }),
    ];
    return { semaphoreV4: bindSemaphoreV4({ adapterBytes, lock, keyBytes, engine: snarkjsEngine }), suppliedKey: snarkjsSuppliedKeyEngine, registry, recorded, riscZero: { parameters: loadRiscZeroParameters(riscZeroBytes), engine: snarkjsEngine } };
  })());

const scope = self as unknown as { onmessage: ((event: MessageEvent<Request>) => void) | null; postMessage(message: Response): void };

// One request at a time: the verifier shares one set of curve workers.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event) => {
  const request = event.data;
  queue = queue.then(async () => {
    try {
      const scanning = await bound();
      if (request.kind === 'check') {
        scope.postMessage({ id: request.id, ok: true, kind: 'check', report: await scan(request.inputs, scanning) });
      } else {
        scope.postMessage({ id: request.id, ok: true, kind: 'rerun', result: await rerunExport(request.export, (inputs) => scan(inputs, scanning)) });
      }
    } catch (error) {
      scope.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
};
