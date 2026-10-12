import { looksLikeCairoProof, verifyCairo, type CairoEngine } from './cairo/verify.js';
import { isBinaryPart, partBytes, type ProofInputs } from './inputs.js';
import { looksLikeLegacyKey, verifyLegacyUltraHonk, type LegacyUltraHonkEngine } from './noir/legacy.js';
import { verifyUltraHonk, type UltraHonkEngine } from './noir/verify.js';
import type { BoundRecordedCircuit } from './recorded/bind.js';
import type { KeyRegistry } from './registry.js';
import { buildCairoReport, buildRiscZeroReport, buildSuppliedKeyReport, TOOL, type KeyRecognition, type Report } from './report.js';
import { looksLikeRiscZeroReceipt, verifyRiscZero, type RiscZeroBound } from './risc-zero/verify.js';
import type { BoundSemaphoreV4 } from './semaphore-v4/bind.js';
import { scanSemaphoreV4 } from './semaphore-v4/scan.js';
import { sha256Hex } from './sha256.js';
import type { SuppliedKeyEngine } from './supplied-key/verify.js';
import { verifySuppliedKey } from './supplied-key/verify.js';

/** Everything a check needs besides the files being checked. */
export interface Scanning {
  semaphoreV4: BoundSemaphoreV4;
  suppliedKey: SuppliedKeyEngine;
  registry: KeyRegistry;
  /** Explanations bound to single recorded keys. */
  recorded: BoundRecordedCircuit[];
  /** RISC Zero's Groth16 receipt verifier parameters, pinned, and the verifier to use them with. */
  riscZero: RiscZeroBound;
  /** Absent where Barretenberg is not available, such as the browser page. */
  ultraHonk?: UltraHonkEngine;
  /** Barretenberg 0.87.0, for the older proofs a current version does not read. Absent on the browser page. */
  ultraHonkLegacy?: LegacyUltraHonkEngine;
  /** Absent where the Cairo verifier is not available, such as the browser page. */
  cairo?: CairoEngine;
}

const unsupported = (proof: string, reason: string): Report => ({ reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(partBytes(proof)) }, outcome: 'unsupported', reason });

/**
 * Checks one proof. A proof that comes with public inputs and a verification
 * key is checked against that key. A proof on its own is read as a format
 * this tool has bundled keys for. The two never mix: a supplied key is never
 * used for a bundled format, so it cannot stand in for the pinned keys.
 */
export async function scan(inputs: ProofInputs, scanning: Scanning): Promise<Report> {
  const { proof, publicInputs, verificationKey } = inputs;
  if (publicInputs === undefined && verificationKey === undefined) {
    // A Cairo proof is one file and needs no key: a STARK has no trusted setup.
    if (!isBinaryPart(proof) && looksLikeCairoProof(proof)) {
      if (scanning.cairo === undefined) return unsupported(proof, 'this is a Cairo proof, which this build cannot check; use the command line');
      return buildCairoReport(proof, await verifyCairo(proof, scanning.cairo));
    }
    // A RISC Zero receipt is one file, checked against parameters pinned in this tool.
    if (!isBinaryPart(proof) && looksLikeRiscZeroReceipt(proof)) return buildRiscZeroReport(proof, await verifyRiscZero(proof, scanning.riscZero));
    if (isBinaryPart(proof)) return unsupported(proof, 'this is a binary proof, which needs its own public inputs file and verification key file, and they were not given');
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
  const { registry, semaphoreV4, recorded } = scanning;
  // A binary proof with a key is an UltraHonk proof as Barretenberg writes it; a text one is snarkjs's.
  let result;
  if (isBinaryPart(proof)) {
    if (scanning.ultraHonk === undefined) return unsupported(proof, 'this is a binary proof, which this build cannot check; use the command line');
    // The key says which version of Barretenberg wrote it, and each version's verifier reads only its own.
    if (looksLikeLegacyKey(partBytes(verificationKey))) {
      if (scanning.ultraHonkLegacy === undefined) return unsupported(proof, 'this is a binary proof, which this build cannot check; use the command line');
      result = await verifyLegacyUltraHonk({ proof, publicInputs, verificationKey }, scanning.ultraHonkLegacy);
    } else result = await verifyUltraHonk({ proof, publicInputs, verificationKey }, scanning.ultraHonk);
  } else {
    result = await verifySuppliedKey({ proof, publicInputs, verificationKey }, scanning.suppliedKey);
  }
  // An explanation is applied only for the exact key it is bound to, on the proof system it was written for.
  const explain = (contentSha256: string): BoundRecordedCircuit | undefined =>
    (result.status === 'valid' || result.status === 'invalid') && result.protocol === 'groth16' && result.curve === 'bn128'
      ? recorded.find((bound) => bound.keyContentSha256 === contentSha256)
      : undefined;
  const recognise = (contentSha256: string): KeyRecognition => {
    const found = registry.find(contentSha256);
    if (found === undefined) return { match: 'none' };
    const named = found.artifact.explanationAdapter;
    const bound = explain(contentSha256);
    // Review status is reported as the adapter states it, never upgraded.
    const explanation =
      bound !== undefined && bound.artifactId === found.artifact.id && bound.adapter.manifest.id === named
        ? { adapter: bound.adapter.manifest.id, review: bound.adapter.manifest.review, applied: true }
        : named === semaphoreV4.adapter.manifest.id
          ? { adapter: named, review: semaphoreV4.adapter.manifest.review, applied: false }
          : null;
    return { match: 'exact', registry: { revision: registry.revision, sha256: registry.sha256 }, artifact: found.artifact, key: found.label, explanation };
  };
  return buildSuppliedKeyReport(proof, result, recognise, (contentSha256) => {
    const bound = explain(contentSha256);
    return bound !== undefined && registry.find(contentSha256)?.artifact.id === bound.artifactId ? bound.adapter : undefined;
  });
}
