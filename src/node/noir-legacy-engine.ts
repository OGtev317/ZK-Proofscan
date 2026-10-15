import { readFile } from 'node:fs/promises';
import { GENERATOR, pinnedG2 } from '../noir/bb-engine.js';
import type { LegacyUltraHonkEngine } from '../noir/legacy.js';

/** The pinned older verifier, installed beside the current one under its own name. A test checks this against the installed package. */
export const BB_JS_LEGACY_VERSION = '0.87.0';
export const BB_JS_LEGACY_PACKAGE = 'aztec-bb-js-0-87-0';

interface LegacyApi {
  srsInitSrs(points: unknown, count: number, g2: unknown): Promise<void>;
  acirVerifyUltraKeccakHonk(proof: Uint8Array, key: unknown): Promise<boolean>;
  acirVerifyUltraKeccakZKHonk(proof: Uint8Array, key: unknown): Promise<boolean>;
  destroy(): Promise<void>;
}
interface LegacyModule {
  Barretenberg: { ['new']: (options: { threads: number }) => Promise<LegacyApi> };
  RawBuffer: new (bytes: Uint8Array) => unknown;
}

/** The second-group point a verification's soundness rests on: the same pinned file the current verifier uses. */
let g2: Promise<Uint8Array> | undefined;

export const bbJsLegacyEngine: LegacyUltraHonkEngine = {
  identity: { name: '@aztec/bb.js', version: BB_JS_LEGACY_VERSION },
  /**
   * Every call runs in a new instance, as with the current verifier. The
   * setup points are handed to the instance directly, so the library's own
   * downloader, which would fetch them, is never used.
   */
  async verify(variant, key, publicInputs, proof) {
    // A failed read is not kept: the next check tries again.
    const point = await (g2 ??= readFile(new URL('../../artifacts/aztec-crs/bn254_g2.dat', import.meta.url))
      .then(pinnedG2)
      .catch((error: unknown) => {
        g2 = undefined;
        throw error;
      }));
    const { Barretenberg, RawBuffer } = (await import(BB_JS_LEGACY_PACKAGE)) as LegacyModule;
    const api = await Barretenberg.new({ threads: 1 });
    try {
      await api.srsInitSrs(new RawBuffer(GENERATOR), 1, new RawBuffer(point));
      // The verifier takes the public inputs followed by the proof.
      const whole = new Uint8Array(publicInputs.length + proof.length);
      whole.set(publicInputs, 0);
      whole.set(proof, publicInputs.length);
      const check = variant === 'keccak' ? api.acirVerifyUltraKeccakHonk(whole, new RawBuffer(key)) : api.acirVerifyUltraKeccakZKHonk(whole, new RawBuffer(key));
      // Setup is done, so a throw from here on is the verifier faulting on these files.
      return await check.catch(() => false);
    } finally {
      await api.destroy().catch(() => undefined);
    }
  },
};
