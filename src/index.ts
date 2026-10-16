/**
 * LumenLenz as a library, for Node 22 or later. The same checks the
 * command line, the tool server and the page run: a proof is verified on
 * this machine, and a looked-up transaction's network data is kept apart
 * from that check. Nothing here signs, sends or writes to any network.
 *
 *   import { checkProof, lookUp, explain } from 'lumenlenz';
 *   const report = await checkProof({ proof, publicInputs, verificationKey });
 *   const found = await lookUp('https://stellar.expert/explorer/testnet/tx/…');
 *
 * Call `stop()` when done, so verifier threads let the process exit.
 */
import type { ProofInputs } from './inputs.js';
import { checkFile, checkText, lookupAndCheck, rerunText, type LookedUp, type ProofPaths } from './node/run.js';
import { stopEngines } from './node/stop.js';
import type { Report } from './report.js';

/** Checks a proof given as file contents. Never throws: a failure to check is an `error` report. */
export const checkProof = (inputs: ProofInputs): Promise<Report> => checkText(inputs);

/** Checks a proof from files on disk, read the way the command line reads them. */
export const checkFiles = (paths: ProofPaths): ReturnType<typeof checkFile> => checkFile(paths);

/**
 * Looks a transaction up and checks any proof it holds. `transaction` is a
 * hash or a block explorer link; `network` is needed for a bare hash. The
 * provider comes from `env` as on the command line (ALCHEMY_API_KEY or
 * LUMENLENZ_RPC_URL for Ethereum chains; STELLAR_RPC_URL, or the public
 * testnet RPC, for stellar-testnet; STELLAR_MAINNET_RPC_URL for
 * stellar-mainnet). Read-only.
 */
export const lookUp = (transaction: string, options: { network?: string; env?: Record<string, string | undefined> } = {}): Promise<LookedUp> =>
  lookupAndCheck(options.network, transaction, options.env ?? process.env);

/** Repeats the check recorded in an evidence export and says whether the report is reproduced. */
export const rerun = (exportText: string): ReturnType<typeof rerunText> => rerunText(exportText);

/** Stops verifier threads so the process can exit. */
export const stop = (): Promise<void> => stopEngines();

export { explain, explainedText, type Explained } from './explain.js';
export { plainWords } from './plain.js';
export { renderReport, REPORT_VERSION, TOOL, type Report } from './report.js';
export { writeExport, type RerunResult } from './export.js';
export { readTransactionReference, explorerLinks, NETWORKS, type TransactionReference } from './chain/reference.js';
export { renderChainSource, type ChainSource } from './chain/source.js';
export { plainFacts, factLines, type TransactionFacts } from './chain/facts.js';
export type { ProofInputs } from './inputs.js';
export type { LookedUp, ProofPaths } from './node/run.js';
export { transactionStory, type TransactionStory } from './story.js';
export { proofProfile, circuitDirectory, reviewText, type ProofProfile } from './profiles.js';
export { inspectStellarTransaction, simulateStellarTransaction, type TransactionPreview, type PreviewResult, type SimulationResult } from './chain/preview.js';
export { decodeSoroswapSwap, type SwapExplanation } from './chain/swaps.js';
export type { LookupAvailability } from './chain/availability.js';
