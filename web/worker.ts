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
import blocklistAdapterUrl from '../adapters/stellar-private-payments-blocklist/adapter.json?url';
import blocklistLockUrl from '../adapters/stellar-private-payments-blocklist/lock.json?url';
import { rerunExport } from '../src/export.js';
import { bindSemaphoreV4, type AdapterLock } from '../src/semaphore-v4/bind.js';
import { bindRecordedCircuit } from '../src/recorded/bind.js';
import { loadKeyRegistry } from '../src/registry.js';
import { loadRiscZeroParameters } from '../src/risc-zero/parameters.js';
import { scan, type Scanning } from '../src/scan.js';
import arkUrl from '../artifacts/ark-groth16/ark-groth16.wasm?url';
import { arkGroth16, crossCheckedGroth16, crossCheckedSupplied } from '../src/ark-groth16.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../src/snarkjs-engine.js';
import twitterKeyUrl from '../artifacts/zk-email-proof-of-twitter/verification-key.json?url';
import { sourcifyAbi } from '../src/chain/abi.js';
import { findProof } from '../src/chain/find.js';
import { PAGE_RPCS, STELLAR_ARCHIVE_RPC } from '../src/chain/reference.js';
import { recordedRpc } from '../src/chain/recorded.js';
import { httpRpc, type RpcClient } from '../src/chain/rpc.js';
import { SAVED_EXAMPLES } from './saved.js';
import { bytes, cairoEngine, legacyUltraHonkEngine, ultraHonkEngine } from './engines.js';
import type { CairoDone, Request, ToPage, ToWorker } from './protocol.js';
import type { SwiftnessOutcome } from './swiftness.js';

// Groth16 checks stand only when snarkjs and arkworks agree, as on the command line.
const ark = arkGroth16(() => bytes(arkUrl));
const groth16Engine = crossCheckedGroth16(snarkjsEngine, ark);
const suppliedKeyEngine = crossCheckedSupplied(snarkjsSuppliedKeyEngine, ark);

let binding: Promise<Scanning> | undefined;
const bound = (): Promise<Scanning> =>
  (binding ??= (async () => {
    const [adapterBytes, lockBytes, keyBytes, registryBytes, twitterAdapter, twitterLock, riscZeroBytes, blocklistAdapter, blocklistLock] = await Promise.all(
      [adapterUrl, lockUrl, keysUrl, registryUrl, twitterAdapterUrl, twitterLockUrl, riscZeroUrl, blocklistAdapterUrl, blocklistLockUrl].map(bytes),
    ) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
    const lock = JSON.parse(new TextDecoder().decode(lockBytes)) as AdapterLock;
    const registry = loadKeyRegistry(registryBytes);
    const recorded = [
      bindRecordedCircuit({ adapterBytes: twitterAdapter, lock: JSON.parse(new TextDecoder().decode(twitterLock)) as AdapterLock, registry, verifier: snarkjsSuppliedKeyEngine.identity }),
      bindRecordedCircuit({ adapterBytes: blocklistAdapter, lock: JSON.parse(new TextDecoder().decode(blocklistLock)) as AdapterLock, registry, verifier: snarkjsSuppliedKeyEngine.identity }),
    ];
    return { semaphoreV4: bindSemaphoreV4({ adapterBytes, lock, keyBytes, engine: groth16Engine }), suppliedKey: suppliedKeyEngine, registry, recorded, riscZero: { parameters: loadRiscZeroParameters(riscZeroBytes), engine: groth16Engine }, ultraHonk: ultraHonkEngine, ultraHonkLegacy: legacyUltraHonkEngine, cairo: cairoEngine(onPage) };
  })());

// The recorded key files a lookup may use, fetched only when it does.
const stellarKeyUrls = import.meta.glob<string>('../artifacts/stellar-private-payments/*_vk.json', { query: '?url', import: 'default' });
const text = async (url: string): Promise<string> => new TextDecoder('utf-8', { fatal: true }).decode(await bytes(url));
const recordedFiles = (scanning: Scanning) => ({
  keyText: async (artifactId: string): Promise<string> => {
    if (artifactId !== 'zk-email-proof-of-twitter-verification-key') throw new Error('no recorded key file for that call');
    return text(twitterKeyUrl);
  },
  stellarPrivatePaymentsKeys: () =>
    Promise.all(
      scanning.registry.artifacts
        .filter((artifact) => artifact.id.startsWith('stellar-private-payments-testnet-'))
        .map(async (artifact) => {
          const load = stellarKeyUrls[`../artifacts/stellar-private-payments/${artifact.provenance.file.split('/').pop()!}`];
          if (load === undefined) throw new Error('a recorded key file is missing from this build');
          return { artifactId: artifact.id, text: await text(await load()) };
        }),
    ),
});

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
      if (request.kind === 'lookup') {
        let rpc: RpcClient;
        let recorded: { recorded?: string } = {};
        const saved = request.saved === undefined ? undefined : SAVED_EXAMPLES.find((example) => example.id === request.saved);
        if (request.saved !== undefined) {
          // A saved example: the provider's recorded answers, read from this page's own files. Nothing leaves this device.
          if (saved === undefined || saved.network !== request.network || saved.hash !== request.hash) throw new Error('there is no such saved example');
          const answers = JSON.parse(await text(saved.url)) as { recorded: string; provider: string } & Record<string, unknown>;
          rpc = recordedRpc(answers, new URL(answers.provider).hostname);
          recorded = { recorded: answers.recorded };
        } else {
          // The only request that leaves this device: the transaction hash, to the page's named RPC for that network.
          const address = PAGE_RPCS[request.network];
          if (address === undefined) throw new Error('this page does not look up transactions on that network');
          rpc = httpRpc(address);
        }
        // A live Ethereum lookup may ask Sourcify to name an ordinary call's function; a saved example asks no one.
        const contractAbi = request.saved === undefined ? { contractAbi: sourcifyAbi() } : {};
        const liveStellar = request.saved === undefined && request.network.startsWith('stellar-');
        const archive = liveStellar && request.network === 'stellar-mainnet' && request.archive === true ? { archiveRpc: httpRpc(STELLAR_ARCHIVE_RPC) } : {};
        const found = await findProof(request.network, request.hash, rpc, { ...recordedFiles(scanning), ...contractAbi, inspectAvailability: liveStellar, ...archive });
        const availability = found.availability === undefined ? {} : { availability: found.availability };
        if (!found.found) scope.postMessage({ id: request.id, ok: true, kind: 'lookup', found: false, reason: found.reason, ...(found.facts === undefined ? {} : { facts: found.facts }), ...recorded, ...availability });
        else scope.postMessage({ id: request.id, ok: true, kind: 'lookup', found: true, source: found.source, inputs: found.inputs, report: await scan(found.inputs, scanning), ...(found.facts === undefined ? {} : { facts: found.facts }), ...recorded, ...availability });
      } else if (request.kind === 'check') {
        scope.postMessage({ id: request.id, ok: true, kind: 'check', report: await scan(request.inputs, scanning) });
      } else {
        scope.postMessage({ id: request.id, ok: true, kind: 'rerun', result: await rerunExport(request.export, (inputs) => scan(inputs, scanning)) });
      }
    } catch (error) {
      scope.postMessage({ id: request.id, ok: false, message: error instanceof Error ? error.message : String(error) });
    }
  });
};
