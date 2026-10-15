import type { VerifierIdentity } from './result.js';
import { sha256Hex } from './sha256.js';
import type { Groth16Engine } from './semaphore-v4/verify.js';
import type { SuppliedKeyEngine } from './supplied-key/verify.js';

/** The arkworks release the module is built from. A test checks this against the build's lock file. */
export const ARK_GROTH16_VERSION = '0.6.0';
/** SHA-256 of `artifacts/ark-groth16/ark-groth16.wasm`, built by `scripts/build-ark-groth16.sh`. */
export const ARK_GROTH16_WASM_SHA256 = 'bee54115f999da60d06a830988da829b95acc91515dd5c1bc69c0a58eeaad7e8';

export const ARK_IDENTITY: VerifierIdentity = { name: 'ark-groth16', version: ARK_GROTH16_VERSION };

const CURVES: Record<string, { id: number; bytes: number }> = { bn128: { id: 1, bytes: 32 }, bls12381: { id: 2, bytes: 48 } };
const SCALAR_BYTES = 32;

/** A number written as its decimal digits, as snarkjs writes them, in `bytes` big-endian bytes. */
function number(value: unknown, bytes: number): Uint8Array {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) throw new ArkLayout();
  const hex = BigInt(value).toString(16);
  if (hex.length > bytes * 2) throw new ArkLayout();
  return Uint8Array.from(hex.padStart(bytes * 2, '0').match(/../g)!, (pair) => Number.parseInt(pair, 16));
}
class ArkLayout extends Error {}

/**
 * A point as snarkjs reads it: x and y, optionally followed by z = 1, or by
 * z = 0 for the point at infinity, which is written to arkworks with zero
 * coordinates.
 */
function g1(point: unknown, bytes: number): Uint8Array[] {
  if (!Array.isArray(point) || (point.length !== 2 && point.length !== 3)) throw new ArkLayout();
  if (point[2] === '0') return [Uint8Array.of(1), new Uint8Array(bytes * 2)];
  if (point.length === 3 && point[2] !== '1') throw new ArkLayout();
  return [Uint8Array.of(0), number(point[0], bytes), number(point[1], bytes)];
}
function g2(point: unknown, bytes: number): Uint8Array[] {
  if (!Array.isArray(point) || (point.length !== 2 && point.length !== 3) || !point.every((pair) => Array.isArray(pair) && pair.length === 2)) throw new ArkLayout();
  const [x, y, z] = point as string[][];
  if (z !== undefined && z[0] === '0' && z[1] === '0') return [Uint8Array.of(1), new Uint8Array(bytes * 4)];
  if (z !== undefined && (z[0] !== '1' || z[1] !== '0')) throw new ArkLayout();
  // snarkjs writes each coordinate of the second group as [c0, c1], as arkworks reads them.
  return [Uint8Array.of(0), number(x![0], bytes), number(x![1], bytes), number(y![0], bytes), number(y![1], bytes)];
}

/** The input the module reads (see `verifiers/ark-groth16/src/lib.rs`). */
export function encode(key: unknown, publicSignals: string[], proof: unknown): Uint8Array {
  const k = key as Record<string, unknown>;
  const p = proof as Record<string, unknown>;
  const curve = CURVES[String(k.curve)];
  if (curve === undefined || !Array.isArray(k.IC) || k.IC.length !== publicSignals.length + 1) throw new ArkLayout();
  const count = new Uint8Array(4);
  new DataView(count.buffer).setUint32(0, publicSignals.length);
  const parts = [
    Uint8Array.of(curve.id),
    count,
    ...g1(k.vk_alpha_1, curve.bytes),
    ...g2(k.vk_beta_2, curve.bytes),
    ...g2(k.vk_gamma_2, curve.bytes),
    ...g2(k.vk_delta_2, curve.bytes),
    ...k.IC.flatMap((point: unknown) => g1(point, curve.bytes)),
    ...g1(p.pi_a, curve.bytes),
    ...g2(p.pi_b, curve.bytes),
    ...g1(p.pi_c, curve.bytes),
    ...publicSignals.map((signal) => number(signal, SCALAR_BYTES)),
  ];
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

interface Exports {
  memory: WebAssembly.Memory;
  alloc(size: number): number;
  verify(pointer: number, length: number): number;
}

/**
 * arkworks' Groth16 verifier, given the module's bytes. Every call runs in a
 * new instance, so nothing one input does to an instance can affect another
 * check. Resolves true or false for the verifier's answer; an input it
 * refuses as not well formed (a number outside the field, a point off the
 * curve or outside its subgroup) is a rejection. Rejects if the module
 * cannot be loaded or traps.
 */
export function arkGroth16(wasm: () => Promise<Uint8Array>): { identity: VerifierIdentity; verify(key: unknown, publicSignals: string[], proof: unknown): Promise<boolean> } {
  let module: Promise<WebAssembly.Module> | undefined;
  const load = async (): Promise<WebAssembly.Module> => {
    const bytes = await wasm();
    const actual = sha256Hex(bytes);
    if (actual !== ARK_GROTH16_WASM_SHA256) throw new Error(`the arkworks verifier module has SHA-256 ${actual}, expected ${ARK_GROTH16_WASM_SHA256}`);
    return WebAssembly.compile(bytes as Uint8Array<ArrayBuffer>);
  };
  return {
    identity: ARK_IDENTITY,
    async verify(key, publicSignals, proof) {
      let input: Uint8Array;
      try {
        input = encode(key, publicSignals, proof);
      } catch (error) {
        if (error instanceof ArkLayout) return false;
        throw error;
      }
      const instance = await WebAssembly.instantiate(await (module ??= load()), {});
      const exports = instance.exports as unknown as Exports;
      const pointer = exports.alloc(input.length);
      new Uint8Array(exports.memory.buffer, pointer, input.length).set(input);
      // A trap here is the verifier failing to run, and is thrown.
      const answer = exports.verify(pointer, input.length);
      if (answer === 1) return true;
      if (answer === 0 || (answer < 0 && answer >= -4)) return false;
      throw new Error('the arkworks verifier gave an answer it does not define');
    },
  };
}

/** Thrown when the two verifiers give different answers: never a verdict on the proof. */
export class VerifiersDisagree extends Error {}

const both = (first: VerifierIdentity, second: VerifierIdentity): VerifierIdentity => ({ ...first, alsoCheckedBy: second });
const disagree = (first: VerifierIdentity, firstSays: boolean, second: VerifierIdentity): VerifiersDisagree =>
  new VerifiersDisagree(`the two Groth16 verifiers disagree: ${first.name} ${firstSays ? 'accepts' : 'rejects'} the proof and ${second.name} ${firstSays ? 'rejects' : 'accepts'} it`);

/** A Groth16 engine whose answer stands only when arkworks gives the same one. */
export function crossCheckedGroth16(first: Groth16Engine, second: ReturnType<typeof arkGroth16>): Groth16Engine {
  return {
    identity: both(first.identity, second.identity),
    async verify(key, publicSignals, proof) {
      const [a, b] = [await first.verify(key, publicSignals, proof), await second.verify(key, publicSignals, proof)];
      if (a !== b) throw disagree(first.identity, a, second.identity);
      return a;
    },
  };
}

/** The same for a supplied key: Groth16 proofs are checked by both; PLONK and FFLONK by the first only. */
export function crossCheckedSupplied(first: SuppliedKeyEngine, second: ReturnType<typeof arkGroth16>): SuppliedKeyEngine & { identityFor(protocol: string): VerifierIdentity } {
  return {
    identity: first.identity,
    identityFor: (protocol) => (protocol === 'groth16' ? both(first.identity, second.identity) : first.identity),
    async verify(protocol, key, publicSignals, proof) {
      const a = await first.verify(protocol, key, publicSignals, proof);
      if (protocol !== 'groth16') return a;
      const b = await second.verify(key, publicSignals, proof);
      if (a !== b) throw disagree(first.identity, a, second.identity);
      return a;
    },
  };
}
