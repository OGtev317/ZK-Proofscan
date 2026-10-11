#!/usr/bin/env node
import { checkFile, message, renderRerun, rerunCode, rerunFile, saveExport } from './node/run.js';
import { stopSnarkjs } from './snarkjs-engine.js';
import { renderReport, type Report } from './report.js';

const USAGE = `Usage:
  zk-proofscan check <semaphore-v4-proof.json> [--json] [--export <file>]
  zk-proofscan rerun <export.json>`;

// Exit codes keep "the proof is wrong" apart from "the check did not happen".
const EXIT: Record<Report['outcome'], number> = { valid: 0, invalid: 1, unsupported: 2, error: 3 };
const USAGE_ERROR = 64;

const print = (report: Report, json: boolean): void => console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));

async function check(path: string, json: boolean, exportPath: string | undefined): Promise<number> {
  const { report, text } = await checkFile(path);
  print(report, json);
  if (exportPath !== undefined && text !== undefined) {
    try {
      await saveExport(exportPath, text, report);
    } catch (error) {
      console.error(`The export was not written: ${message(error)}`);
      return EXIT.error;
    }
  } else if (exportPath !== undefined) {
    console.error('The export was not written: the proof file could not be read.');
  }
  return EXIT[report.outcome];
}

async function rerun(path: string): Promise<number> {
  const result = await rerunFile(path);
  console.log(renderRerun(result));
  return rerunCode(result);
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
