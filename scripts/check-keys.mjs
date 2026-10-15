// Checks that each bundled verification key is the one contained in the
// proving key Semaphore publishes for that tree depth. Downloads the public
// proving keys (about 0.3 to 12 MB each) into a temporary folder.
//
//   node scripts/check-keys.mjs            # all depths, writes the record
//   node scripts/check-keys.mjs 3 10       # some depths, prints only
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { zKey } from 'snarkjs';

const VERSION = '4.13.0';
const BASE = `https://snark-artifacts.pse.dev/semaphore/${VERSION}`;
const requested = process.argv.slice(2).map(Number);
const depths = requested.length > 0 ? requested : Array.from({ length: 32 }, (_, i) => i + 1);

const keysPath = new URL('../artifacts/semaphore-v4/verification-keys.json', import.meta.url);
const keysBytes = await readFile(keysPath);
const all = JSON.parse(keysBytes.toString());
const dir = await mkdtemp(join(tmpdir(), 'lumenlenz-zkeys-'));
const results = [];
try {
  for (const depth of depths) {
    const url = `${BASE}/semaphore-${depth}.zkey`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const path = join(dir, `semaphore-${depth}.zkey`);
    await writeFile(path, bytes);
    const fromZkey = await zKey.exportVerificationKey(path);
    const bundled = { ...all, vk_delta_2: all.vk_delta_2[depth - 1], IC: all.IC[depth - 1] };
    const matches = isDeepStrictEqual(JSON.parse(JSON.stringify(fromZkey)), bundled);
    results.push({ depth, url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), matches });
    console.log(`depth ${String(depth).padStart(2)}  ${matches ? 'matches' : 'DIFFERS'}  ${bytes.length} bytes`);
    await rm(path);
  }
} finally {
  await rm(dir, { recursive: true, force: true });
  await globalThis.curve_bn128?.terminate();
}

const allMatch = results.every((result) => result.matches);
if (requested.length === 0) {
  const record = {
    checked: new Date().toISOString().slice(0, 10),
    statement: 'Each bundled verification key equals the key exported from the proving key published at the listed URL.',
    verificationKeysSha256: createHash('sha256').update(keysBytes).digest('hex'),
    provingKeyVersion: VERSION,
    tool: 'snarkjs zKey.exportVerificationKey',
    allMatch,
    provingKeys: results,
  };
  await writeFile(new URL('../artifacts/semaphore-v4/proving-key-check.json', import.meta.url), `${JSON.stringify(record, null, 2)}\n`);
}
process.exitCode = allMatch ? 0 : 1;
