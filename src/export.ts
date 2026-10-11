import type { Report } from './report.js';
import { MAX_PROOF_CHARACTERS } from './semaphore-v4/importer.js';

/** A report together with the exact proof text it was made from. */
export interface EvidenceExport {
  exportVersion: 1;
  proof: string;
  report: Report;
}

export const MAX_EXPORT_CHARACTERS = 65_536;

export function writeExport(proofText: string, report: Report): string {
  const bundle: EvidenceExport = { exportVersion: 1, proof: proofText, report };
  return `${JSON.stringify(bundle, null, 2)}\n`;
}

/** JSON with object keys sorted, so the order fields were written in does not matter. */
function ordered(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner) ?? 'undefined';
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
export async function rerunExport(text: string, scan: (proofText: string) => Promise<Report>): Promise<RerunResult> {
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
  if (typeof bundle.proof !== 'string' || bundle.proof.length > MAX_PROOF_CHARACTERS) return unreadable('the export does not contain a proof of supported size');
  if (typeof bundle.report !== 'object' || bundle.report === null || Array.isArray(bundle.report)) return unreadable('the export does not contain a report');

  const report = await scan(bundle.proof);
  const fresh = report as unknown as Record<string, unknown>;
  const recorded = bundle.report as Record<string, unknown>;
  const fields = [...new Set([...Object.keys(fresh), ...Object.keys(recorded)])]
    .filter((key) => ordered(fresh[key]) !== ordered(recorded[key]))
    .sort();
  return fields.length === 0 ? { reproduced: true, report } : { reproduced: false, kind: 'different', fields, report };
}
