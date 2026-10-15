import { readFile } from 'node:fs/promises';
import { bbJsLegacyEngine as makeEngine, type LegacyModule } from '../noir/legacy-engine.js';

export { BB_JS_LEGACY_VERSION } from '../noir/legacy-engine.js';
/** The older verifier is installed beside the current one under its own name. */
export const BB_JS_LEGACY_PACKAGE = 'aztec-bb-js-0-87-0';

export const bbJsLegacyEngine = makeEngine(
  async () => (await import(BB_JS_LEGACY_PACKAGE)) as unknown as LegacyModule,
  () => readFile(new URL('../../artifacts/aztec-crs/bn254_g2.dat', import.meta.url)),
);
