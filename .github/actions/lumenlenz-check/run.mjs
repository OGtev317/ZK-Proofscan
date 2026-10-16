import { realpath, stat, readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkProof, stop } from '../../../dist/index.js';
import { prepareWalletReview } from '../../../dist/integrations/wallet-review.js';

/** No shell interpolation, network lookup, raw-input logs, artifacts or credential use. */
export async function checkFixture(options, workspace) {
  if (options.public !== 'true') throw new Error('Explicit public-fixture consent required');
  if (!['proof', 'inspect'].includes(options.mode)) throw new Error('Unsupported check mode');
  const allowed = options.mode === 'proof' ? ['valid', 'invalid', 'unsupported', 'error'] : ['inspected'];
  if (!allowed.includes(options.expected)) throw new Error('Unsupported expected outcome');
  const root = await realpath(workspace);
  const load = async (name) => {
    if (typeof name !== 'string' || !name || isAbsolute(name) || name.includes('\0')) throw new Error('Invalid fixture path');
    const path = await realpath(resolve(root, name));
    const rel = relative(root, path);
    if (rel === '..' || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Fixture must stay inside workspace');
    const info = await stat(path);
    if (!info.isFile() || info.size > 5_000_000) throw new Error('Fixture must be a bounded regular file');
    return readFile(path, 'utf8');
  };
  let actual;
  if (options.mode === 'inspect') {
    if (!['stellar-testnet', 'stellar-mainnet'].includes(options.network) || options.inputs || options.key) throw new Error('Invalid inspection options');
    const review = prepareWalletReview(await load(options.fixture), options.network);
    actual = review.kind === 'local-review' ? 'inspected' : 'not-inspected';
  } else {
    if (options.network || Boolean(options.inputs) !== Boolean(options.key)) throw new Error('Invalid proof options');
    const report = await checkProof({ proof: await load(options.fixture), ...(options.inputs ? { publicInputs: await load(options.inputs), verificationKey: await load(options.key) } : {}) });
    actual = report.outcome;
  }
  return { matches: actual === options.expected, actual, note: options.mode === 'inspect' ? 'Unsigned structure inspected only; no safety verdict, signing or submission.' : 'Proof outcome only; circuit trust, application correctness and settlement are separate.' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await checkFixture({ fixture: process.env.LL_FIXTURE, public: process.env.LL_PUBLIC, mode: process.env.LL_MODE, expected: process.env.LL_EXPECTED, network: process.env.LL_NETWORK, inputs: process.env.LL_INPUTS, key: process.env.LL_KEY }, process.env.GITHUB_WORKSPACE);
    // Only fixed outcome labels are logged, never user-supplied paths, reports or XDR.
    console.log(`LumenLenz: ${result.actual}; ${result.matches ? 'matched expectation' : 'DID NOT match expectation'}. ${result.note}`);
    process.exitCode = result.matches ? 0 : 1;
  } catch { console.error('LumenLenz check refused or could not complete. Check public-fixture consent, bounded workspace-relative paths, and explicit mode/network/outcome. No verdict established.'); process.exitCode = 1; }
  finally { await stop(); }
}
