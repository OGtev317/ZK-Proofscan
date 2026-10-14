import { sha256Hex } from '../sha256.js';
import type { UltraHonkEngine } from './verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const BB_JS_VERSION = '5.2.1';

/**
 * The SHA-256 of Aztec's G2 setup point, `artifacts/aztec-crs/bn254_g2.dat`.
 * A verification's soundness rests on this point.
 */
export const AZTEC_G2_SHA256 = '01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f';

/**
 * The first point of the setup: the curve's generator, (1, 2). Measured on
 * @aztec/bb.js 5.2.1 and 0.87.0: verifying needs no other point of the
 * first group, so no other is loaded.
 */
export const GENERATOR = new Uint8Array(64);
GENERATOR[31] = 1;
GENERATOR[63] = 2;

/** Checks the G2 setup point against its pinned hash. */
export function pinnedG2(bytes: Uint8Array): Uint8Array {
  const actual = sha256Hex(bytes);
  if (actual !== AZTEC_G2_SHA256) throw new Error(`the setup file bn254_g2.dat has SHA-256 ${actual}, expected ${AZTEC_G2_SHA256}`);
  return bytes;
}

interface Api {
  srsInitSrs(command: { pointsBuf: Uint8Array; numPoints: number; g2Point: Uint8Array }): Promise<unknown>;
  destroy(): Promise<void>;
}
type Verifier = { verifyProof(data: { proof: Uint8Array; publicInputs: string[]; verificationKey: Uint8Array }, options: { verifierTarget: string }): Promise<boolean> };
/** The parts of @aztec/bb.js used here, the same in its Node and browser builds. */
export interface BbJsModule {
  Barretenberg: { ['new']: (options: { threads: number; backend: unknown; skipSrsInit: boolean; wasmPath?: string }) => Promise<Api> };
  BackendType: { Wasm: unknown };
  UltraHonkVerifierBackend: new (api: Api) => unknown;
}

/**
 * An UltraHonk engine over @aztec/bb.js. `load` imports the library and
 * `g2` reads the pinned setup point; `wasmPath` is where the browser build
 * finds its WebAssembly.
 */
export function bbJsEngine(load: () => Promise<BbJsModule>, g2: () => Promise<Uint8Array>, wasmPath?: string): UltraHonkEngine {
  let point: Promise<Uint8Array> | undefined;
  return {
    identity: { name: '@aztec/bb.js', version: BB_JS_VERSION },
    /**
     * Every call runs in a new instance of Barretenberg's WebAssembly build.
     * Measured: one instance fed thousands of malformed inputs eventually
     * fails with a memory error, so no instance is reused and one input can
     * never affect the check of another. The setup points are handed to the
     * instance directly, so the library's own downloader, which would fetch
     * them from Aztec's servers, is never used. A failure to read the setup
     * point or start an instance is thrown.
     */
    async verify(variant, key, publicInputs, proof) {
      const g2Point = await (point ??= g2().then(pinnedG2));
      const { Barretenberg, BackendType, UltraHonkVerifierBackend } = await load();
      // The WebAssembly build, not the native program the Node package also ships:
      // the native one fetches its own setup files.
      const api = await Barretenberg.new({ threads: 1, backend: BackendType.Wasm, skipSrsInit: true, ...(wasmPath === undefined ? {} : { wasmPath }) });
      try {
        await api.srsInitSrs({ pointsBuf: GENERATOR, numPoints: 1, g2Point });
        // Setup is done, so a throw from here on is the verifier faulting on
        // these files: it does not accept them. Measured: it throws for some
        // proofs made as another variant.
        return await (new UltraHonkVerifierBackend(api) as Verifier).verifyProof({ proof, publicInputs, verificationKey: key }, { verifierTarget: variant }).catch(() => false);
      } finally {
        await api.destroy().catch(() => undefined);
      }
    },
  };
}
