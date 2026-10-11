import type { RerunResult } from '../src/export.js';
import type { Report } from '../src/report.js';

export type Request = { id: number; kind: 'check'; proof: string } | { id: number; kind: 'rerun'; export: string };

export type Response =
  | { id: number; ok: true; kind: 'check'; report: Report }
  | { id: number; ok: true; kind: 'rerun'; result: RerunResult }
  | { id: number; ok: false; message: string };
