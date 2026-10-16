#!/usr/bin/env node
import { plainFacts, renderFacts } from './chain/facts.js';
import { checkFile, lookupAndCheck, message, renderLookup, renderRerun, rerunCode, rerunFile, saveExport, type ProofPaths } from './node/run.js';
import { stopEngines } from './node/stop.js';
import { renderReport, type Report } from './report.js';
import { readFile, stat } from 'node:fs/promises';
import { inspectStellarTransaction } from './chain/preview.js';
import { availabilityText } from './chain/availability.js';

const USAGE = `Usage:
  lumenlenz check <proof.json> [--json] [--export <file>]
  lumenlenz check <proof> --public <public inputs> --key <verification key> [--json] [--export <file>]
  lumenlenz rerun <export.json>
  lumenlenz lookup <transaction hash or explorer link> [--chain <name>] [--json] [--export <file>]
  lumenlenz inspect <unsigned-xdr-file> --chain stellar-testnet|stellar-mainnet [--json]

The first form checks a Semaphore v4 proof against keys bundled with this
tool; a Cairo STARK proof in the Stone prover's JSON layout, which needs no
key; or a RISC Zero Groth16 receipt written as three lines of hex (seal,
image ID, SHA-256 of the journal), against RISC Zero's version 3.0.0
verifier parameters.

The second form checks a proof against the verification key you give: a
Groth16, PLONK or FFLONK proof written by snarkjs, or an UltraHonk proof
written by Barretenberg for a Noir program (its proof, public_inputs and vk
files; version 5.2.1, or 0.87.0 with the Keccak transcript). Unless the key is one this tool has on record with an explanation,
it cannot say what the circuit checks.

lookup asks a chain data provider for a transaction, reads a proof out of it
and checks that proof here. It only reads, and sends the transaction hash to
that provider. Give the hash, or the transaction's page on a block explorer
(Etherscan and its kin, stellar.expert, Stellar Lab, stellarchain.io), whose
address names the network; a bare hash needs --chain. Chains: ethereum, sepolia, base, base-sepolia, optimism,
arbitrum and polygon, which need ALCHEMY_API_KEY or LUMENLENZ_RPC_URL in
the environment; stellar-testnet, which uses STELLAR_RPC_URL if set and
otherwise the Stellar Development Foundation's public testnet RPC; and
stellar-mainnet, which needs STELLAR_MAINNET_RPC_URL, an RPC you choose.`;

// Exit codes keep "the proof is wrong" apart from "the check did not happen".
const EXIT: Record<Report['outcome'], number> = { valid: 0, invalid: 1, unsupported: 2, error: 3 };
const USAGE_ERROR = 64;

const print = (report: Report, json: boolean): void => console.log(json ? JSON.stringify(report, null, 2) : renderReport(report));

async function check(paths: ProofPaths, json: boolean, exportPath: string | undefined): Promise<number> {
  const { report, inputs } = await checkFile(paths);
  print(report, json);
  if (exportPath !== undefined && inputs !== undefined) {
    try {
      await saveExport(exportPath, inputs, report);
    } catch (error) {
      console.error(`The export was not written: ${message(error)}`);
      return EXIT.error;
    }
  } else if (exportPath !== undefined) {
    console.error('The export was not written: a file could not be read.');
  }
  return EXIT[report.outcome];
}

async function lookup(transaction: string, chain: string | undefined, json: boolean, exportPath: string | undefined): Promise<number> {
  const found = await lookupAndCheck(chain, transaction, process.env);
  const availability = found.availability === undefined ? {} : { availability: found.availability };
  const availabilityDetails = !json && found.availability !== undefined ? `\n\n${availabilityText(found.availability)}` : '';
  if (found.kind === 'not-checked' && found.facts !== undefined) {
    // The transaction was read; it holds no proof this tool reads.
    console.log(json ? JSON.stringify({ lookup: 'no-supported-proof', reason: found.reason, facts: found.facts, ...availability }, null, 2) : `${renderFacts(found.facts)}\n\n${plainFacts(found.facts)}${availabilityDetails}`);
    return EXIT.unsupported;
  }
  if (found.kind === 'not-checked') {
    console.log(json ? JSON.stringify({ lookup: 'not-checked', reason: found.reason, ...availability }, null, 2) : `Not checked: ${found.reason}.\nThis says nothing about whether a proof is valid.${availabilityDetails}`);
    return EXIT.error;
  }
  // What else the transaction did, as the provider reported it, follows the report.
  const activity = found.facts === undefined || json ? '' : `\n\n${renderFacts(found.facts).replace(/^No supported proof found\. /, '')}`;
  console.log(json ? JSON.stringify({ source: found.source, report: found.report, ...(found.facts === undefined ? {} : { facts: found.facts }), ...availability }, null, 2) : `${renderLookup(found.source, found.report)}${activity}${availabilityDetails}`);
  if (exportPath !== undefined) {
    try {
      await saveExport(exportPath, found.inputs, found.report, found.source);
    } catch (error) {
      console.error(`The export was not written: ${message(error)}`);
      return EXIT.error;
    }
  }
  return EXIT[found.report.outcome];
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
  let publicInputs: string | undefined;
  let verificationKey: string | undefined;
  let chain: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--export' && rest[i + 1] !== undefined) exportPath = rest[++i];
    else if (arg === '--public' && rest[i + 1] !== undefined) publicInputs = rest[++i];
    else if (arg === '--key' && rest[i + 1] !== undefined) verificationKey = rest[++i];
    else if (arg === '--chain' && rest[i + 1] !== undefined) chain = rest[++i];
    else if (arg.startsWith('-')) return USAGE_ERROR;
    else paths.push(arg);
  }
  if (paths.length !== 1) return USAGE_ERROR;
  if (command === 'inspect') {
    if (chain === undefined || publicInputs !== undefined || verificationKey !== undefined || exportPath !== undefined) return USAGE_ERROR;
    if ((await stat(paths[0]!)).size > 262_144) throw new Error('the transaction XDR file is too large');
    const text = await readFile(paths[0]!, 'utf8');
    const preview = inspectStellarTransaction(text, chain);
    console.log(json ? JSON.stringify(preview, null, 2) : preview.kind === 'not-inspected' ? preview.reason : ['Local inspection - NOT submitted or verified', `Network (chosen): ${preview.network}`, `Source: ${preview.source}`, `Fee payer: ${preview.feePayer}; maximum fee ${preview.maxFeeStroops} stroops`, ...preview.operations.map((op) => `${op.description}${op.contract ? ` on ${op.contract}` : ''}`), ...preview.warnings, 'Authorization trees:', JSON.stringify(preview.operations.flatMap((op) => op.authorizations), null, 2)].join('\n'));
    return preview.kind === 'inspected' ? 0 : EXIT.error;
  }
  const extra = { ...(publicInputs === undefined ? {} : { publicInputs }), ...(verificationKey === undefined ? {} : { verificationKey }) };
  if (command === 'lookup') return publicInputs === undefined && verificationKey === undefined ? lookup(paths[0]!, chain, json, exportPath) : USAGE_ERROR;
  if (chain !== undefined) return USAGE_ERROR;
  if (command === 'check') return check({ proof: paths[0]!, ...extra }, json, exportPath);
  if (command === 'rerun' && !json && exportPath === undefined && publicInputs === undefined && verificationKey === undefined) return rerun(paths[0]!);
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
  await stopEngines();
}
