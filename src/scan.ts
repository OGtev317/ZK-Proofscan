import type { ProofInputs } from './inputs.js';
import { buildSuppliedKeyReport, TOOL, type Report } from './report.js';
import type { BoundSemaphoreV4 } from './semaphore-v4/bind.js';
import { scanSemaphoreV4 } from './semaphore-v4/scan.js';
import { sha256Hex, utf8 } from './sha256.js';
import type { SuppliedKeyEngine } from './supplied-key/verify.js';
import { verifySuppliedKey } from './supplied-key/verify.js';

/** Everything a check needs besides the files being checked. */
export interface Scanning {
  semaphoreV4: BoundSemaphoreV4;
  suppliedKey: SuppliedKeyEngine;
}

const unsupported = (proof: string, reason: string): Report => ({ reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(utf8(proof)) }, outcome: 'unsupported', reason });

/**
 * Checks one proof. A proof that comes with public inputs and a verification
 * key is checked against that key. A proof on its own is read as a format
 * this tool has bundled keys for. The two never mix: a supplied key is never
 * used for a bundled format, so it cannot stand in for the pinned keys.
 */
export async function scan(inputs: ProofInputs, scanning: Scanning): Promise<Report> {
  const { proof, publicInputs, verificationKey } = inputs;
  if (publicInputs === undefined && verificationKey === undefined) {
    const report = await scanSemaphoreV4(proof, scanning.semaphoreV4);
    // Say what is missing when the file is plainly a snarkjs proof.
    if (report.outcome === 'unsupported' && /"protocol"\s*:\s*"(groth16|plonk|fflonk)"/.test(proof.slice(0, 65_536))) {
      return unsupported(proof, 'this looks like a proof that needs its own public inputs file and verification key file, and they were not given');
    }
    return report;
  }
  if (publicInputs === undefined || verificationKey === undefined) {
    return unsupported(proof, 'a proof checked with its own verification key needs both a public inputs file and a verification key file');
  }
  return buildSuppliedKeyReport(proof, await verifySuppliedKey({ proof, publicInputs, verificationKey }, scanning.suppliedKey));
}
