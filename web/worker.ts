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
import arkUrl from '../artifacts/ark-groth16/ark-groth16.wasm?url';
import { arkGroth16, crossCheckedGroth16, crossCheckedSupplied } from '../src/ark-groth16.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../src/snarkjs-engine.js';
import { bytes, cairoEngine, ultraHonkEngine } from './engines.js';
import type { CairoDone, Request, ToPage, ToWorker } from './protocol.js';
import type { SwiftnessOutcome } from './swiftness.js';

// Groth16 checks stand only when snarkjs and arkworks agree, as on the command line.
const ark = arkGroth16(() => bytes(arkUrl));
const groth16Engine = crossCheckedGroth16(snarkjsEngine, ark);
const suppliedKeyEngine = crossCheckedSupplied(snarkjsSuppliedKeyEngine, ark);

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
    return { semaphoreV4: bindSemaphoreV4({ adapterBytes, lock, keyBytes, engine: groth16Engine }), suppliedKey: suppliedKeyEngine, registry, recorded, riscZero: { parameters: loadRiscZeroParameters(riscZeroBytes), engine: groth16Engine }, ultraHonk: ultraHonkEngine, cairo: cairoEngine(onPage) };
  })());

const scope = self as unknown as { onmessage: ((event: MessageEvent<ToWorker>) => void) | null; postMessage(message: ToPage): void };

/** Runs one Cairo verifier build on the page's own thread and waits for its answer. */
const onPageCalls = new Map<number, (outcome: SwiftnessOutcome) => void>();
let nextCall = 1;
function onPage(build: string, text: string): Promise<SwiftnessOutcome> {
  return new Promise((resolve) => {
    const call = nextCall++;
    onPageCalls.set(call, resolve);
    scope.postMessage({ kind: 'cairo-on-page', call, build, text });
  });
}
const finishOnPage = (done: CairoDone): void => {
  onPageCalls.get(done.call)?.(done.outcome);
  onPageCalls.delete(done.call);
};

// One request at a time: the verifier shares one set of curve workers.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (event) => {
  if (event.data.kind === 'cairo-done') return finishOnPage(event.data);
  const request: Request = event.data;
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
