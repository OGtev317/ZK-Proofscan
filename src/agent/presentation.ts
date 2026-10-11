import type { RerunResult } from '../export.js';
import { renderReport, type Report } from '../report.js';

/** Host-rendered evidence, not model-authored prose or a new verification. */
export interface CheckPresentation {
  operation: 'check';
  outcome: Report['outcome'];
  evidenceText: string;
}

/** Call only with a fresh result from the configured local engine. */
export function presentCheck(report: Report): CheckPresentation {
  return { operation: 'check', outcome: report.outcome, evidenceText: renderReport(report) };
}

export type RerunPresentation =
  | { operation: 'rerun'; reproduced: true; fresh: CheckPresentation }
  | { operation: 'rerun'; reproduced: false; kind: 'different'; fields: string[]; fresh: CheckPresentation }
  | { operation: 'rerun'; reproduced: false; kind: 'unreadable'; reason: string };

/** Never render an export's recorded report as freshly verified evidence. */
export function presentRerun(result: RerunResult): RerunPresentation {
  if (result.reproduced) {
    return { operation: 'rerun', reproduced: true, fresh: presentCheck(result.report) };
  }
  if (result.kind === 'unreadable') {
    return { operation: 'rerun', reproduced: false, kind: 'unreadable', reason: result.reason };
  }
  return {
    operation: 'rerun', reproduced: false, kind: 'different',
    fields: [...result.fields], fresh: presentCheck(result.report),
  };
}
