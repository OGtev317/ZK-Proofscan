import { readFile } from 'node:fs/promises';
import { bindRecordedCircuit } from '../recorded/bind.js';
import { swiftnessEngine } from './cairo-engine.js';
import { bbJsEngine } from './noir-engine.js';
import { bbJsLegacyEngine } from './noir-legacy-engine.js';
import { loadKeyRegistry } from '../registry.js';
import { loadRiscZeroParameters } from '../risc-zero/parameters.js';
import type { Scanning } from '../scan.js';
import { bindSemaphoreV4, type AdapterLock, type BoundSemaphoreV4 } from '../semaphore-v4/bind.js';
import { arkGroth16, crossCheckedGroth16, crossCheckedSupplied } from '../ark-groth16.js';
import { snarkjsEngine, snarkjsSuppliedKeyEngine } from '../snarkjs-engine.js';

const file = (path: string): Promise<Uint8Array> => readFile(new URL(`../../${path}`, import.meta.url));

/** arkworks' Groth16 verifier, the second check on every Groth16 proof. */
export const arkGroth16Engine = arkGroth16(() => file('artifacts/ark-groth16/ark-groth16.wasm'));
/** Groth16 checks stand only when snarkjs and arkworks agree. */
export const groth16Engine = crossCheckedGroth16(snarkjsEngine, arkGroth16Engine);
export const suppliedKeyEngine = crossCheckedSupplied(snarkjsSuppliedKeyEngine, arkGroth16Engine);

/** The adapter, lock, key file and verifier shipped with this build, bound together. */
export async function bundledSemaphoreV4(): Promise<BoundSemaphoreV4> {
  const lock = JSON.parse(new TextDecoder().decode(await file('adapters/semaphore-v4/lock.json'))) as AdapterLock;
  return bindSemaphoreV4({
    adapterBytes: await file('adapters/semaphore-v4/adapter.json'),
    lock,
    keyBytes: await file('artifacts/semaphore-v4/verification-keys.json'),
    engine: groth16Engine,
  });
}

/** Everything this build checks with. */
/** Recorded key files kept in this repository, by registry artifact. */
const RECORDED_KEY_FILES: Record<string, string> = { 'zk-email-proof-of-twitter-verification-key': 'artifacts/zk-email-proof-of-twitter/verification-key.json' };

/** The text of a recorded key file, for a proof that was looked up without one. */
export async function recordedKeyText(artifactId: string): Promise<string> {
  const path = RECORDED_KEY_FILES[artifactId];
  if (path === undefined) throw new Error('no recorded key file for that call');
  return new TextDecoder('utf-8', { fatal: true }).decode(await file(path));
}

/**
 * The recorded keys of Stellar Private Payments, by registry artifact, as
 * their files are kept here. A Stellar lookup looks for them in a verifier
 * contract's code.
 */
export async function stellarPrivatePaymentsKeys(): Promise<{ artifactId: string; text: string }[]> {
  const registry = JSON.parse(new TextDecoder().decode(await file('registry/keys.json'))) as { artifacts: { id: string; provenance: { file: string } }[] };
  const entries = registry.artifacts.filter((artifact) => artifact.id.startsWith('stellar-private-payments-testnet-'));
  return Promise.all(
    entries.map(async (artifact) => ({
      artifactId: artifact.id,
      text: new TextDecoder('utf-8', { fatal: true }).decode(await file(`artifacts/stellar-private-payments/${artifact.provenance.file.split('/').pop()!}`)),
    })),
  );
}

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
  const riscZero = { parameters: loadRiscZeroParameters(await file('artifacts/risc-zero-groth16/parameters-3.0.0.json')), engine: groth16Engine };
  return { semaphoreV4: await bundledSemaphoreV4(), suppliedKey: suppliedKeyEngine, registry, recorded, riscZero, ultraHonk: bbJsEngine, ultraHonkLegacy: bbJsLegacyEngine, cairo: swiftnessEngine };
}
