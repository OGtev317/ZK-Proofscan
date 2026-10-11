// Runs one Cairo verification and exits. A worker of its own means a fault
// in the verifier's WebAssembly cannot affect any other check, and a
// verification that never finishes can be stopped.
import { readFileSync } from 'node:fs';
import { parentPort, workerData } from 'node:worker_threads';

interface Glue {
  initSync(input: { module: Uint8Array }): unknown;
  parse_proof(text: string): string;
  verify_proof(parsed: string): string;
}
const { glue, wasm, text } = workerData as { glue: string; wasm: string; text: string };
try {
  const module = (await import(glue)) as Glue;
  module.initSync({ module: readFileSync(wasm) });
  parentPort!.postMessage({ ok: true, result: module.verify_proof(module.parse_proof(text)) });
} catch (error) {
  parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) });
}
