import type { TransactionFacts } from '../src/chain/facts.js';
import type { ChainSource } from '../src/chain/source.js';
import type { RerunResult } from '../src/export.js';
import type { ProofInputs } from '../src/inputs.js';
import type { Report } from '../src/report.js';
import type { SwiftnessOutcome } from './swiftness.js';

export type Request = { id: number; kind: 'check'; inputs: ProofInputs } | { id: number; kind: 'rerun'; export: string } | { id: number; kind: 'lookup'; network: string; hash: string; saved?: string };

export type Response =
  | { id: number; ok: true; kind: 'check'; report: Report }
  | { id: number; ok: true; kind: 'rerun'; result: RerunResult }
  | { id: number; ok: true; kind: 'lookup'; found: false; reason: string; facts?: TransactionFacts; recorded?: string }
  | { id: number; ok: true; kind: 'lookup'; found: true; source: ChainSource; inputs: ProofInputs; report: Report; facts?: TransactionFacts; recorded?: string }
  | { id: number; ok: false; message: string };

/** The worker asks the page to run one Cairo verifier build on the page's own thread. */
export type CairoOnPage = { kind: 'cairo-on-page'; call: number; build: string; text: string };
export type CairoDone = { kind: 'cairo-done'; call: number; outcome: SwiftnessOutcome };

export type ToPage = Response | CairoOnPage;
export type ToWorker = Request | CairoDone;
