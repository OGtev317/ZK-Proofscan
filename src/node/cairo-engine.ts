import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { CairoRejected, CairoUnreadable, type CairoEngine } from '../cairo/verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const SWIFTNESS_VERSION = '1.0.0';

const TIMEOUT_MS = 120_000;
const HASH_NAMES: Record<string, string> = {
  keccak256_masked160_lsb: 'keccak_160_lsb',
  keccak256_masked248_lsb: 'keccak_248_lsb',
  blake256_masked160_lsb: 'blake2s_160_lsb',
  blake256_masked248_lsb: 'blake2s_248_lsb',
};
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
    const build = join(packageRoot(), 'pkg', `swiftness_${parameters.layout}_${HASH_NAMES[parameters.commitmentHash]}_${stone}`);
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
            // The library's own words are not passed on: they can quote the file.
            return reject(message.message.startsWith('Proof verification failed') ? new CairoRejected('the verifier rejected the proof') : new CairoUnreadable('the verifier could not read the file'));
          }
          try {
            const parsed = JSON.parse(message.result) as { program_hash?: unknown; output_hash?: unknown; output?: unknown };
            // The package's build names the output list `output_hash`; the source names it `output`.
            resolve({ programHash: parsed.program_hash as string, output: (parsed.output ?? parsed.output_hash) as string[] });
          } catch {
            reject(new Error('the Cairo verifier returned something that is not JSON'));
          }
        }),
      );
      worker.once('error', () => finish(() => reject(new Error('the Cairo verifier stopped unexpectedly'))));
      // Settling twice is harmless: after an answer this does nothing.
      worker.once('exit', () => finish(() => reject(new Error('the Cairo verifier stopped unexpectedly'))));
    });
  },
};
