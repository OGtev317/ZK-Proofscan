#!/usr/bin/env node
import { readFile, stat, writeFile } from 'node:fs/promises';
import { MAX_EXPORT_CHARACTERS, rerunExport, writeExport } from './export.js';
import { bundledSemaphoreV4 } from './node/bundled.js';
import { stopSnarkjs } from './node/snarkjs-engine.js';
import { renderReport, type Report } from './report.js';
import { MAX_PROOF_CHARACTERS } from './semaphore-v4/importer.js';
import { scanSemaphoreV4 } from './semaphore-v4/scan.js';

const USAGE = `Usage:
  zk-proofscan check <semaphore-v4-proof.json> [--json] [--export <file>]
  zk-proofscan rerun <export.json>`;

// Exit codes keep "the proof is wrong" apart from "the check did not happen".
const EXIT: Record<Report['outcome'], number> = { valid: 0, invalid: 1, unsupported: 2, error: 3 };
const USAGE_ERROR = 64;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class TooLarge extends Error {}

async function readText(path: string, limit: number): Promise<string> {
  if ((await stat(path)).size > limit * 4) throw new TooLarge();
  return new TextDecoder('utf-8', { fatal: true }).decode(await readFile(path));
}

async function check(path: string, json: boolean, exportPath: string | undefined): Promise<number> {
  let text: string;
  try {
    text = await readText(path, MAX_PROOF_CHARACTERS);
  } catch (error) {
    if (error instanceof TooLarge) {
      console.log('Not checked: this is not a supported proof file (the file is too large).\nThis says nothing about whether a proof is valid.');
      return EXIT.unsupported;
    }
    console.log(`Not checked: the verification could not be completed (could not read the file: ${message(error)}).\nThis says nothing about whether a proof is valid.`);
    return EXIT.error;
  }
  const bound = await bundledSemaphoreV4();
  const report = await scanSemaphoreV4(text, bound);
  console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));
  if (exportPath !== undefined) {
    try {
      // Never overwrite: an existing export may be someone's evidence.
      await writeFile(exportPath, writeExport(text, report), { flag: 'wx' });
    } catch (error) {
      console.error(`The export was not written: ${message(error)}`);
      return EXIT.error;
    }
  }
  return EXIT[report.outcome];
}

async function rerun(path: string): Promise<number> {
  const text = await readText(path, MAX_EXPORT_CHARACTERS).catch((error: unknown) => {
    throw new Error(`could not read the export: ${error instanceof TooLarge ? 'the file is too large' : message(error)}`);
  });
  const bound = await bundledSemaphoreV4();
  const result = await rerunExport(text, (proof) => scanSemaphoreV4(proof, bound));
  if (result.reproduced) {
    console.log(`REPRODUCED: checking the proof again gave the same report (outcome: ${result.report.outcome}).\n`);
    console.log(renderReport(result.report));
    return 0;
  }
  if (result.kind === 'unreadable') {
    console.log(`Not rerun: ${result.reason}.`);
    return 2;
  }
  console.log(`NOT REPRODUCED: checking the proof again gave a different report.\nSections that differ: ${result.fields.join(', ')}.`);
  console.log('A difference in "tool" or "explanation" can mean a different version of this tool made the export.\n');
  console.log(`Report from this run:\n${renderReport(result.report)}`);
  return 1;
}

async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const paths: string[] = [];
  let json = false;
  let exportPath: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--export' && rest[i + 1] !== undefined) exportPath = rest[++i];
    else if (arg.startsWith('-')) return USAGE_ERROR;
    else paths.push(arg);
  }
  if (paths.length !== 1) return USAGE_ERROR;
  if (command === 'check') return check(paths[0]!, json, exportPath);
  if (command === 'rerun' && !json && exportPath === undefined) return rerun(paths[0]!);
  return USAGE_ERROR;
}

try {
  const code = await main(process.argv.slice(2));
  if (code === USAGE_ERROR) console.error(USAGE);
  process.exitCode = code;
} catch (error) {
  console.log(`Not checked: the verification could not be completed (${message(error)}).\nThis says nothing about whether a proof is valid.`);
  process.exitCode = EXIT.error;
} finally {
  await stopSnarkjs();
}
