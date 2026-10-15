import { readFile, stat, writeFile } from 'node:fs/promises';
import type { TransactionFacts } from '../chain/facts.js';
import { sourcifyAbi } from '../chain/abi.js';
import { stellarTomlCheck } from '../chain/stellar-assets.js';
import { findProof, resolveTransaction } from '../chain/find.js';
import { CHAINS, httpRpc, rpcUrlFromEnvironment } from '../chain/rpc.js';
import { renderChainSource, type ChainSource } from '../chain/source.js';
import { STELLAR_NETWORKS } from '../chain/stellar.js';
import { MAX_EXPORT_CHARACTERS, rerunExport, writeExport, type RerunResult } from '../export.js';
import { MAX_PROOF_PART_CHARACTERS, MAX_PUBLIC_INPUTS_CHARACTERS, MAX_VERIFICATION_KEY_CHARACTERS, partFromBytes, type ProofInputs } from '../inputs.js';
import { renderReport, unreadReport, type Report } from '../report.js';
import { scan } from '../scan.js';
import { bundledScanning, recordedKeyText, stellarPrivatePaymentsKeys } from './bundled.js';

export const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

class TooLarge extends Error {}

async function readText(path: string, limit: number): Promise<string> {
  if ((await stat(path)).size > limit * 4) throw new TooLarge();
  // A byte-order mark is kept, and then refused as not JSON, so the hash in
  // the report is always the hash of the file's exact bytes.
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await readFile(path));
}

/** Reads one file of a check as a part (see `partFromBytes`). */
async function readPart(path: string, limit: number): Promise<string> {
  // A limit in characters is also the limit in bytes: no supported file needs more bytes than characters.
  if ((await stat(path)).size > limit) throw new TooLarge();
  return partFromBytes(await readFile(path));
}

/** Checks proof text with the bundled adapter, keys and verifier. Never throws. */
export async function checkText(inputs: ProofInputs): Promise<Report> {
  try {
    return await scan(inputs, await bundledScanning());
  } catch (error) {
    return unreadReport('error', message(error));
  }
}

/** Where a check's files are. The last two go together, for a proof checked with its own key. */
export interface ProofPaths {
  proof: string;
  publicInputs?: string;
  verificationKey?: string;
}

/** Checks a proof from files. `inputs` is absent when a file could not be read. */
export async function checkFile(paths: ProofPaths): Promise<{ report: Report; inputs?: ProofInputs }> {
  const read = async (path: string, limit: number, what: string): Promise<string> => {
    try {
      return await readPart(path, limit);
    } catch (error) {
      // Text and JSON output must agree, including when nothing could be checked.
      throw error instanceof TooLarge ? unreadReport('unsupported', `the ${what} is too large`) : unreadReport('error', `could not read the ${what}: ${message(error)}`);
    }
  };
  let inputs: ProofInputs;
  try {
    inputs = {
      // The largest proof text any format accepts; each format applies its own limit after this.
      proof: await read(paths.proof, MAX_PROOF_PART_CHARACTERS, 'file'),
      ...(paths.publicInputs === undefined ? {} : { publicInputs: await read(paths.publicInputs, MAX_PUBLIC_INPUTS_CHARACTERS, 'public inputs file') }),
      ...(paths.verificationKey === undefined ? {} : { verificationKey: await read(paths.verificationKey, MAX_VERIFICATION_KEY_CHARACTERS, 'verification key file') }),
    };
  } catch (unread) {
    return { report: unread as Report };
  }
  return { report: await checkText(inputs), inputs };
}

/** Writes an export, never over an existing file: that file may be someone's evidence. */
export const saveExport = (path: string, inputs: ProofInputs, report: Report, source?: ChainSource): Promise<void> =>
  writeFile(path, writeExport(inputs, report, source), { flag: 'wx' });

export type LookedUp =
  | { kind: 'checked'; source: ChainSource; inputs: ProofInputs; report: Report; facts?: TransactionFacts }
  /** Nothing was checked, and the reason is not a fault in any proof. */
  | { kind: 'not-checked'; reason: string; facts?: TransactionFacts };

/** Every name `lookup` accepts. */
export const LOOKUP_CHAINS: readonly string[] = [...CHAINS.map((known) => known.name), ...STELLAR_NETWORKS.map((known) => known.name)];

/**
 * Finds a proof in a transaction and checks it here. Read-only. `pasted` is
 * a transaction hash or a block explorer link; `chainName` may be left out
 * when the link names the network. An Ethereum chain needs a provider
 * configured in the environment. Stellar's test network uses
 * `STELLAR_RPC_URL` if set, and otherwise the Foundation's public RPC; its
 * main network needs `STELLAR_MAINNET_RPC_URL`.
 */
export async function lookupAndCheck(chainName: string | undefined, pasted: string, env: Record<string, string | undefined>): Promise<LookedUp> {
  if (chainName !== undefined && !LOOKUP_CHAINS.includes(chainName)) return { kind: 'not-checked', reason: `the chain must be one of ${LOOKUP_CHAINS.join(', ')}` };
  const resolved = resolveTransaction(pasted, chainName);
  if ('reason' in resolved) return { kind: 'not-checked', reason: resolved.reason };
  const chain = CHAINS.find((known) => known.name === resolved.network);
  const stellar = STELLAR_NETWORKS.find((known) => known.name === resolved.network);
  const address = chain === undefined ? env[stellar!.rpcVariable] || stellar!.defaultRpc : rpcUrlFromEnvironment(chain, env);
  if (address === undefined) {
    return {
      kind: 'not-checked',
      reason: chain === undefined ? `no RPC is configured for ${stellar!.name}; set ${stellar!.rpcVariable} in the environment to the RPC you choose` : 'no chain data provider is configured; set ALCHEMY_API_KEY or ZK_PROOFSCAN_RPC_URL in the environment',
    };
  }
  let found;
  try {
    // Sourcify names an ordinary call's function; ZK_PROOFSCAN_SOURCIFY=off asks it nothing.
    const contractAbi = env.ZK_PROOFSCAN_SOURCIFY === 'off' ? {} : { contractAbi: sourcifyAbi() };
    // An issued Stellar asset is checked against its issuer's stellar.toml; ZK_PROOFSCAN_STELLAR_TOML=off fetches none.
    const stellarAssetInfo = env.ZK_PROOFSCAN_STELLAR_TOML === 'off' ? {} : { stellarAssetInfo: stellarTomlCheck() };
    found = await findProof(resolved.network, resolved.hash, httpRpc(address), { keyText: recordedKeyText, stellarPrivatePaymentsKeys, ...contractAbi, ...stellarAssetInfo });
  } catch (error) {
    return { kind: 'not-checked', reason: message(error) };
  }
  if (!found.found) return { kind: 'not-checked', reason: found.reason, ...(found.facts === undefined ? {} : { facts: found.facts }) };
  return { kind: 'checked', source: found.source, inputs: found.inputs, report: await checkText(found.inputs), ...(found.facts === undefined ? {} : { facts: found.facts }) };
}

export const renderLookup = (source: ChainSource, report: Report): string => `${renderChainSource(source)}\n\n${renderReport(report)}`;

export async function rerunText(text: string): Promise<RerunResult> {
  const scanning = await bundledScanning();
  return rerunExport(text, (inputs) => scan(inputs, scanning));
}

export async function rerunFile(path: string): Promise<RerunResult> {
  const text = await readText(path, MAX_EXPORT_CHARACTERS).catch((error: unknown) => {
    throw new Error(`could not read the export: ${error instanceof TooLarge ? 'the file is too large' : message(error)}`);
  });
  return rerunText(text);
}

export function renderRerun(result: RerunResult): string {
  if (!result.reproduced && result.kind === 'unreadable') return `Not rerun: ${result.reason}.`;
  // A source in an export is repeated as recorded, and marked as unchecked.
  const source = result.source === undefined ? '' : `${renderChainSource(result.source, true)}\n\n`;
  if (result.reproduced) return `REPRODUCED: checking the proof again gave the same report (outcome: ${result.report.outcome}).\n\n${source}${renderReport(result.report)}`;
  return [
    `NOT REPRODUCED: checking the proof again gave a different report.\nSections that differ: ${result.fields.join(', ')}.`,
    'A difference in "tool", "reportVersion", "basis" or "explanation" can mean a different version of this tool made the export.\n',
    `${source}Report from this run:\n${renderReport(result.report)}`,
  ].join('\n');
}

/** 0 reproduced, 1 different, 2 unreadable. */
export const rerunCode = (result: RerunResult): number => (result.reproduced ? 0 : result.kind === 'unreadable' ? 2 : 1);
