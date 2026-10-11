import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { UltraHonkEngine } from '../noir/verify.js';

/** The pinned verifier. A test checks this against the installed package. */
export const BB_JS_VERSION = '5.2.1';

/**
 * The setup files Barretenberg needs, as its own downloader fetched them
 * from Aztec's servers on 2026-10-11, pinned by SHA-256. They ship with
 * this tool so that a check never downloads anything. The G2 file is the
 * one a verification's soundness rests on.
 */
export const AZTEC_CRS_SHA256: Record<string, string> = {
  'bn254_g1_compressed.dat': 'fad8203ae1fd103658d4bb33b2b4cf126a28352b5de4684737cff23cc15fb94b',
  'bn254_g2.dat': '01797bfc4de5a96f0e516a9ea4537d18786dc30cb991aca4274c95822b69c32f',
  'grumpkin_g1_v2.flat.dat': '64236c9455e75aeea77a94587ea607eed2e978d2609a421d66bf10bb9698b8fd',
  grumpkin_size: '0f255ec16482c343fd099ba9668863778be40dc166a6856b1d470e0bc97cc6fd',
};
/** The number of points in the G1 file, the least Barretenberg accepts. */
const SRS_SIZE = 2 ** 17;

type Verifier = { verifyProof(data: { proof: Uint8Array; publicInputs: string[]; verificationKey: Uint8Array }, options: { verifierTarget: string }): Promise<boolean> };

/**
 * A private copy of the pinned setup files. The copy is made because the
 * library writes a cache beside them, and it is private to this process so
 * no other process can alter what is verified against. With the files in
 * place the library does not use the network.
 */
let setup: Promise<string> | undefined;
async function setupDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'zk-proofscan-crs-'));
  try {
    for (const [name, expected] of Object.entries(AZTEC_CRS_SHA256)) {
      const bytes = await readFile(new URL(`../../artifacts/aztec-crs/${name}`, import.meta.url));
      const actual = createHash('sha256').update(bytes).digest('hex');
      if (actual !== expected) throw new Error(`the setup file ${name} has SHA-256 ${actual}, expected ${expected}`);
      await writeFile(join(directory, name), bytes, { flag: 'wx', mode: 0o600 });
    }
    return directory;
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

export const bbJsEngine: UltraHonkEngine = {
  identity: { name: '@aztec/bb.js', version: BB_JS_VERSION },
  /**
   * Every call runs in a new instance of Barretenberg's WebAssembly build.
   * Measured: one instance fed thousands of malformed inputs eventually
   * fails with a memory error, so no instance is reused and one input can
   * never affect the check of another. A new instance takes about 0.1 s.
   */
  async verify(variant, key, publicInputs, proof) {
    const directory = await (setup ??= setupDirectory());
    const { Barretenberg, BackendType, UltraHonkVerifierBackend } = await import('@aztec/bb.js');
    // The WebAssembly build, not the native program the package also ships:
    // the native one fetches its own setup files.
    const api = await Barretenberg.new({ threads: 1, crsPath: directory, srsSize: SRS_SIZE, backend: BackendType.Wasm });
    try {
      return await (new UltraHonkVerifierBackend(api) as unknown as Verifier).verifyProof({ proof, publicInputs, verificationKey: key }, { verifierTarget: variant });
    } finally {
      await api.destroy().catch(() => undefined);
    }
  },
};

/** Removes the private setup files. */
export async function stopNoir(): Promise<void> {
  const made = setup;
  setup = undefined;
  if (made === undefined) return;
  const directory = await made.catch(() => undefined);
  if (directory !== undefined) await rm(directory, { recursive: true, force: true });
}
