import { GENERATOR, pinnedG2 } from './bb-engine.js';
import type { LegacyUltraHonkEngine, LegacyUltraHonkVariant } from './legacy.js';

/** The pinned older verifier. A test checks this against the installed package. */
export const BB_JS_LEGACY_VERSION = '0.87.0';

/** The verifier's own entry points in its WebAssembly, one per variant. */
const EXPORTS: Record<LegacyUltraHonkVariant, string> = { keccak: 'acir_verify_ultra_keccak_honk', 'keccak-zk': 'acir_verify_ultra_keccak_zk_honk' };

interface SyncApi {
  srsInitSrs(points: unknown, count: number, g2: unknown): void;
  wasm: { callWasmExport(name: string, args: unknown[], outputSizes: number[]): Uint8Array[] };
}
/** The parts of @aztec/bb.js 0.87.0 used here, the same in its Node and browser builds. */
export interface LegacyModule {
  BarretenbergSync: { ['new']: (wasmPath?: string) => Promise<SyncApi> };
  RawBuffer: new (bytes: Uint8Array) => unknown;
}

/** As the library writes a byte vector for its WebAssembly: a 4-byte big-endian length, then the bytes. */
function vector(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + bytes.length);
  new DataView(out.buffer).setUint32(0, bytes.length);
  out.set(bytes, 4);
  return out;
}

/**
 * Barretenberg 0.87.0's UltraHonk verifier, through its in-thread API, so
 * it runs the same way on the command line and in the page's worker and
 * starts no workers of its own. That API offers the Keccak verifier with
 * hiding but not without, so both are called by their entry point in the
 * library's WebAssembly, with arguments laid out as the library lays them
 * out. `load` imports the library, `g2` reads the pinned setup point, and
 * `wasmPath` is where the browser build finds its WebAssembly.
 */
export function bbJsLegacyEngine(load: () => Promise<LegacyModule>, g2: () => Promise<Uint8Array>, wasmPath?: string): LegacyUltraHonkEngine {
  let point: Promise<Uint8Array> | undefined;
  return {
    identity: { name: '@aztec/bb.js', version: BB_JS_LEGACY_VERSION },
    /**
     * Every call runs in a new instance, so nothing one input does to an
     * instance can affect another check. The setup points are handed to the
     * instance directly; the library's own downloader is never used. A
     * failure to read the setup point or start an instance is thrown.
     */
    async verify(variant, key, publicInputs, proof) {
      // A failed read is not kept: the next check tries again.
      const g2Point = await (point ??= g2()
        .then(pinnedG2)
        .catch((error: unknown) => {
          point = undefined;
          throw error;
        }));
      const { BarretenbergSync, RawBuffer } = await load();
      const api = await BarretenbergSync.new(wasmPath);
      api.srsInitSrs(new RawBuffer(GENERATOR), 1, new RawBuffer(g2Point));
      // The verifier takes the public inputs followed by the proof, and the key as it is.
      const whole = new Uint8Array(publicInputs.length + proof.length);
      whole.set(publicInputs, 0);
      whole.set(proof, publicInputs.length);
      try {
        const [answer] = api.wasm.callWasmExport(EXPORTS[variant], [vector(whole), new RawBuffer(key)], [1]);
        return answer?.[0] === 1;
      } catch {
        // Setup is done, so a throw here is the verifier faulting on these files: it does not accept them.
        return false;
      }
    },
  };
}
