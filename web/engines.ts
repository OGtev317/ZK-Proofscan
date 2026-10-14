/// <reference types="vite/client" />
// The Noir and Cairo verifiers as the page runs them. Each check runs in a
// worker of its own that the page discards afterwards (see main.ts), so no
// state of one verifier instance carries over to another check.
import g2Url from '../artifacts/aztec-crs/bn254_g2.dat?url';
import barretenbergWasmUrl from 'virtual:barretenberg-wasm';
import { SWIFTNESS_VERSION, swiftnessBuild, swiftnessFailure, swiftnessResult } from '../src/cairo/swiftness.js';
import type { CairoEngine } from '../src/cairo/verify.js';
import { bbJsEngine, type BbJsModule } from '../src/noir/bb-engine.js';
import type { UltraHonkEngine } from '../src/noir/verify.js';
import { runSwiftness, type SwiftnessOutcome } from './swiftness.js';

export async function bytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`could not load a bundled file (${response.status})`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Barretenberg's browser build, given its WebAssembly from this page's own address instead of the copy inlined in the library. */
export const ultraHonkEngine: UltraHonkEngine = bbJsEngine(
  async () => (await import('@aztec/bb.js')) as unknown as BbJsModule,
  () => bytes(g2Url),
  barretenbergWasmUrl,
);

/**
 * The Cairo verifier, run in this worker. Measured on WebKit: a worker's
 * stack is too small for some proofs, while the page's own thread is not, so
 * a run that exhausts the stack is repeated there by `onPage`.
 */
export function cairoEngine(onPage: (build: string, text: string) => Promise<SwiftnessOutcome>): CairoEngine {
  return {
    identity: { name: 'swiftness', version: SWIFTNESS_VERSION },
    async verify(text, parameters, stone) {
      const build = swiftnessBuild(parameters, stone);
      let outcome = await runSwiftness(build, text);
      if (!outcome.ok && outcome.stackExhausted) outcome = await onPage(build, text);
      if (!outcome.ok) {
        if (!outcome.loaded) throw new Error('the Cairo verifier could not be started');
        throw swiftnessFailure(outcome.message);
      }
      return swiftnessResult(outcome.result);
    },
  };
}
