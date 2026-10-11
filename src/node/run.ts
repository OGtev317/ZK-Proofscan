import { readFile, stat, writeFile } from 'node:fs/promises';
import { MAX_EXPORT_CHARACTERS, rerunExport, writeExport, type RerunResult } from '../export.js';
import { renderReport, unreadReport, type Report } from '../report.js';
import { MAX_PROOF_CHARACTERS } from '../semaphore-v4/importer.js';
import { scanSemaphoreV4 } from '../semaphore-v4/scan.js';
import { bundledSemaphoreV4 } from './bundled.js';

export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class TooLarge extends Error {}

async function readText(path: string, limit: number): Promise<string> {
  if ((await stat(path)).size > limit * 4) throw new TooLarge();
  // A byte-order mark is kept, and then refused as not JSON, so the hash in
  // the report is always the hash of the file's exact bytes.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path));
}

/** Checks proof text with the bundled adapter, keys and verifier. Never throws. */
export async function checkText(text: string): Promise<Report> {
  try {
    return await scanSemaphoreV4(text, await bundledSemaphoreV4());
  } catch (error) {
    return unreadReport('error', message(error));
  }
}

/** Checks a proof file. `text` is absent when the file could not be read. */
export async function checkFile(path: string): Promise<{ report: Report; text?: string }> {
  let text: string;
  try {
    text = await readText(path, MAX_PROOF_CHARACTERS);
  } catch (error) {
    // Text and JSON output must agree, including when nothing could be checked.
    return { report: error instanceof TooLarge ? unreadReport('unsupported', 'the file is too large') : unreadReport('error', `could not read the file: ${message(error)}`) };
  }
  return { report: await checkText(text), text };
}

/** Writes an export, never over an existing file: that file may be someone's evidence. */
export const saveExport = (path: string, text: string, report: Report): Promise<void> => writeFile(path, writeExport(text, report), { flag: 'wx' });

export async function rerunText(text: string): Promise<RerunResult> {
  const bound = await bundledSemaphoreV4();
  return rerunExport(text, (proof) => scanSemaphoreV4(proof, bound));
}

export async function rerunFile(path: string): Promise<RerunResult> {
  const text = await readText(path, MAX_EXPORT_CHARACTERS).catch((error: unknown) => {
    throw new Error(`could not read the export: ${error instanceof TooLarge ? 'the file is too large' : message(error)}`);
  });
  return rerunText(text);
}

export function renderRerun(result: RerunResult): string {
  if (result.reproduced) return `REPRODUCED: checking the proof again gave the same report (outcome: ${result.report.outcome}).\n\n${renderReport(result.report)}`;
  if (result.kind === 'unreadable') return `Not rerun: ${result.reason}.`;
  return [
    `NOT REPRODUCED: checking the proof again gave a different report.\nSections that differ: ${result.fields.join(', ')}.`,
    'A difference in "tool" or "explanation" can mean a different version of this tool made the export.\n',
    `Report from this run:\n${renderReport(result.report)}`,
  ].join('\n');
}

/** 0 reproduced, 1 different, 2 unreadable. */
export const rerunCode = (result: RerunResult): number => (result.reproduced ? 0 : result.kind === 'unreadable' ? 2 : 1);
