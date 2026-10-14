import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { CairoEngine } from '../cairo/verify.js';
import { SWIFTNESS_VERSION, swiftnessBuild, swiftnessFailure, swiftnessResult } from '../cairo/swiftness.js';

export { SWIFTNESS_VERSION } from '../cairo/swiftness.js';

const TIMEOUT_MS = 120_000;
// The package holds one build of the verifier for each layout, hash and Stone version.
const packageRoot = (): string => dirname(createRequire(import.meta.url).resolve('swiftness'));

/** The compiled worker: beside this file when built, and in `dist` when this file is run from source. */
function workerFile(): URL {
  const beside = new URL('./cairo-worker.js', import.meta.url);
  return existsSync(beside) ? beside : new URL('../../dist/node/cairo-worker.js', import.meta.url);
}

export const swiftnessEngine: CairoEngine = {
  identity: { name: 'swiftness', version: SWIFTNESS_VERSION },
  verify(text, parameters, stone) {
    const build = join(packageRoot(), 'pkg', swiftnessBuild(parameters, stone));
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerFile(), {
        workerData: { glue: pathToFileURL(join(build, 'swiftness_wasm.js')).href, wasm: join(build, 'swiftness_wasm_bg.wasm'), text },
      });
      const timer = setTimeout(() => {
        void worker.terminate();
        reject(new Error('the Cairo verifier did not finish in time'));
      }, TIMEOUT_MS);
      const finish = (settle: () => void): void => {
        clearTimeout(timer);
        void worker.terminate();
        settle();
      };
      worker.once('message', (message: { ok: true; result: string } | { ok: false; loaded: boolean; message: string }) =>
        finish(() => {
          if (!message.ok) {
            if (!message.loaded) return reject(new Error('the Cairo verifier could not be started'));
            return reject(swiftnessFailure(message.message));
          }
          try {
            resolve(swiftnessResult(message.result));
          } catch (error) {
            reject(error as Error);
          }
        }),
      );
      worker.once('error', () => finish(() => reject(new Error('the Cairo verifier stopped unexpectedly'))));
      // Settling twice is harmless: after an answer this does nothing.
      worker.once('exit', () => finish(() => reject(new Error('the Cairo verifier stopped unexpectedly'))));
    });
  },
};
