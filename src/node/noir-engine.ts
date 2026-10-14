import { readFile } from 'node:fs/promises';
import { bbJsEngine as makeEngine, type BbJsModule } from '../noir/bb-engine.js';

export { AZTEC_G2_SHA256, BB_JS_VERSION } from '../noir/bb-engine.js';

/**
 * The setup files Barretenberg's own downloader fetched from Aztec's servers
 * on 2026-10-11, pinned by SHA-256. Verifying reads only the G2 point; the
 * others are kept for making test proofs.
 */
export const AZTEC_CRS_SHA256: Record<string, string> = {
  'bn254_g1_compressed.dat': 'fad8203ae1fd103658d4bb33b2b4cf126a28352b5de4684737cff23cc15fb94b',
  'bn254_g2.dat': '01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f',
  'grumpkin_g1_v2.flat.dat': '64236c9455e75aeea77a94587ea607eed2e978d2609a421d66bf10bb9698b8fd',
  grumpkin_size: '0f255ec16482c343fd099ba9668863778be40dc166a6856b1d470e0bc97cc6fd',
};

export const bbJsEngine = makeEngine(
  async () => (await import('@aztec/bb.js')) as unknown as BbJsModule,
  () => readFile(new URL('../../artifacts/aztec-crs/bn254_g2.dat', import.meta.url)),
);
