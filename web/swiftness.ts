/// <reference types="vite/client" />
// Runs one build of the Cairo verifier. Used by the verification worker,
// and by the page itself when a browser's worker has too little stack.

interface Glue {
  default(input: { module_or_path: string }): Promise<unknown>;
  parse_proof(text: string): unknown;
  verify_proof(parsed: unknown): string;
}

export type SwiftnessOutcome = { ok: true; result: string } | { ok: false; loaded: boolean; stackExhausted: boolean; message: string };

// One build of the verifier for each layout, hash and Stone version, kept
// as files. Only the build a proof needs is fetched.
const glues = import.meta.glob<string>('../node_modules/swiftness/dist/pkg/*/swiftness_wasm.js', { query: '?url', import: 'default' });
const wasms = import.meta.glob<string>('../node_modules/swiftness/dist/pkg/*/swiftness_wasm_bg.wasm', { query: '?url', import: 'default' });

let runs = 0;

/**
 * Each run imports the build under an address of its own, so it gets a new
 * module and a new WebAssembly instance: nothing a malformed file did to one
 * instance can affect another check.
 */
export async function runSwiftness(build: string, text: string): Promise<SwiftnessOutcome> {
  const folder = `../node_modules/swiftness/dist/pkg/${build}`;
  const glue = glues[`${folder}/swiftness_wasm.js`];
  const wasm = wasms[`${folder}/swiftness_wasm_bg.wasm`];
  const failed = (loaded: boolean, error: unknown): SwiftnessOutcome => ({
    ok: false,
    loaded,
    stackExhausted: error instanceof RangeError && /call stack/i.test(error.message),
    message: error instanceof Error ? error.message : String(error),
  });
  if (glue === undefined || wasm === undefined) return failed(false, new Error('no such build'));
  let module: Glue;
  try {
    runs += 1;
    const address = `${await glue()}?run=${runs}`;
    module = (await import(/* @vite-ignore */ address)) as Glue;
    await module.default({ module_or_path: await wasm() });
  } catch (error) {
    return failed(false, error);
  }
  try {
    return { ok: true, result: module.verify_proof(module.parse_proof(text)) };
  } catch (error) {
    return failed(true, error);
  }
}
