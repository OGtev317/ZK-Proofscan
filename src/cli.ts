#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { bundledSemaphoreV4Keys } from './node/keys.js';
import { snarkjsEngine, stopSnarkjs } from './node/snarkjs-engine.js';
import type { VerificationResult } from './result.js';
import { MAX_PROOF_CHARACTERS } from './semaphore-v4/importer.js';
import { verifySemaphoreV4 } from './semaphore-v4/verify.js';

// Exit codes keep "the proof is wrong" apart from "the check did not happen".
const EXIT: Record<VerificationResult['status'], number> = { valid: 0, invalid: 1, unsupported: 2, error: 3 };

async function check(path: string): Promise<VerificationResult> {
  let text: string;
  try {
    if ((await stat(path)).size > MAX_PROOF_CHARACTERS * 4) return { status: 'unsupported', reason: 'the file is too large to be a supported proof' };
    text = new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
  } catch (error) {
    return { status: 'error', message: `could not read the file: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    return await verifySemaphoreV4(text, await bundledSemaphoreV4Keys(), snarkjsEngine);
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : String(error) };
  }
}

function describe(result: VerificationResult): string {
  switch (result.status) {
    case 'valid':
    case 'invalid':
      return [
        result.status === 'valid' ? 'Cryptographic verification: PASSED' : 'Cryptographic verification: FAILED (the verifier rejected this proof)',
        `Format: Semaphore v4, tree depth ${result.artifact.merkleTreeDepth}`,
        `Verifier: ${result.verifier.name} ${result.verifier.version}`,
        `Verification keys (SHA-256): ${result.artifact.sha256}`,
        'Public inputs given to the verifier:',
        `  group root:     ${result.publicSignals[0]}`,
        `  nullifier:      ${result.publicSignals[1]}`,
        `  hashed message: ${result.publicSignals[2]}`,
        `    (message in the file: ${result.message})`,
        `  hashed scope:   ${result.publicSignals[3]}`,
        `    (scope in the file: ${result.scope})`,
        'Not checked: whether any application accepts this group root, and whether this nullifier was already used.',
      ].join('\n');
    case 'unsupported':
      return `Not checked: this is not a supported proof file (${result.reason}).\nThis says nothing about whether a proof is valid.`;
    case 'error':
      return `Not checked: the verification could not be completed (${result.message}).\nThis says nothing about whether a proof is valid.`;
  }
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const paths = args.filter((arg) => arg !== '--json');
if (paths.length !== 1 || paths[0]!.startsWith('-')) {
  console.error('Usage: zk-proofscan [--json] <semaphore-v4-proof.json>');
  process.exitCode = 64;
} else {
  const result = await check(paths[0]!);
  console.log(json ? JSON.stringify(result, null, 2) : describe(result));
  await stopSnarkjs();
  process.exitCode = EXIT[result.status];
}
