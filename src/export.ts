import { ordered } from './canonical.js';
import { MAX_PUBLIC_INPUTS_CHARACTERS, MAX_VERIFICATION_KEY_CHARACTERS, type ProofInputs } from './inputs.js';
import type { Report } from './report.js';
import { MAX_SUPPLIED_PROOF_CHARACTERS } from './supplied-key/importer.js';

/**
 * A report together with the exact text of every file it was made from. A
 * proof checked with its own key carries its public inputs and that key.
 */
export interface EvidenceExport extends ProofInputs {
  exportVersion: 1;
  report: Report;
}

export const MAX_EXPORT_CHARACTERS = 786_432;

export function writeExport(inputs: string | ProofInputs, report: Report): string {
  const { proof, publicInputs, verificationKey } = typeof inputs === 'string' ? { proof: inputs } : inputs;
  const bundle: EvidenceExport = {
    exportVersion: 1,
    proof,
    ...(publicInputs === undefined ? {} : { publicInputs }),
    ...(verificationKey === undefined ? {} : { verificationKey }),
    report,
  };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

export type RerunResult =
  | { reproduced: true; report: Report }
  | { reproduced: false; kind: 'unreadable'; reason: string }
  | { reproduced: false; kind: 'different'; fields: string[]; report: Report };

/**
 * Repeats the check on the proof inside an export and compares the fresh
 * report with the recorded one. Nothing recorded in the export is trusted:
 * the recorded report is only compared against.
 */
export async function rerunExport(text: string, scan: (inputs: ProofInputs) => Promise<Report>): Promise<RerunResult> {
  const unreadable = (reason: string): RerunResult => ({ reproduced: false, kind: 'unreadable', reason });
  if (text.length > MAX_EXPORT_CHARACTERS) return unreadable('the export is too large');
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return unreadable('the export is not valid JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return unreadable('the export is not a JSON object');
  const bundle = parsed as Record<string, unknown>;
  if (bundle.exportVersion !== 1) return unreadable('the export version is not supported');
  // The largest proof text any format accepts; each format applies its own limit after this.
  if (typeof bundle.proof !== 'string' || bundle.proof.length > MAX_SUPPLIED_PROOF_CHARACTERS) return unreadable('the export does not contain a proof of supported size');
  const optional = (value: unknown, limit: number): value is string | undefined => value === undefined || (typeof value === 'string' && value.length <= limit);
  const { publicInputs, verificationKey } = bundle;
  if (!optional(publicInputs, MAX_PUBLIC_INPUTS_CHARACTERS) || !optional(verificationKey, MAX_VERIFICATION_KEY_CHARACTERS)) {
    return unreadable('the export holds public inputs or a verification key that is not text of supported size');
  }
  if (typeof bundle.report !== 'object' || bundle.report === null || Array.isArray(bundle.report)) return unreadable('the export does not contain a report');

  const report = await scan({ proof: bundle.proof, ...(publicInputs === undefined ? {} : { publicInputs }), ...(verificationKey === undefined ? {} : { verificationKey }) });
  const fresh = report as unknown as Record<string, unknown>;
  const recorded = bundle.report as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(fresh), ...Object.keys(recorded)])]
    .filter((key) => ordered(fresh[key]) !== ordered(recorded[key]))
    .sort();
  return fields.length === 0 ? { reproduced: true, report } : { reproduced: false, kind: 'different', fields, report };
}
