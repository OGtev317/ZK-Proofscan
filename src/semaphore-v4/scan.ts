import { buildReport, type Report } from '../report.js';
import type { BoundSemaphoreV4 } from './bind.js';
import { verifySemaphoreV4 } from './verify.js';

/** Verifies one proof file and explains the result with the bound adapter. */
export async function scanSemaphoreV4(proofText: string, bound: BoundSemaphoreV4): Promise<Report> {
  return buildReport(proofText, await verifySemaphoreV4(proofText, bound.keys, bound.engine), bound.adapter);
}
