/// <reference types="vite/client" />
import receiptUrl from '../tests/fixtures/risc-zero/nethermind-test-receipt.txt?url';
import membershipUrl from '../tests/fixtures/semaphore-v4-valid.json?url';
import cairoUrl from '../tests/fixtures/cairo/dynamic-stone6-96-bits.json?url';
import noirProofUrl from '../tests/fixtures/noir/multiplier-evm.proof?url';
import noirPublicUrl from '../tests/fixtures/noir/multiplier-evm.public_inputs?url';
import noirKeyUrl from '../tests/fixtures/noir/multiplier-evm.vk?url';
import { resolveTransaction } from '../src/chain/find.js';
import { explorerLinks, familyOf, NETWORKS, PAGE_RPCS, readTransactionReference, type ChainFamily } from '../src/chain/reference.js';
import { renderChainSource, type ChainSource } from '../src/chain/source.js';
import { MAX_EXPORT_CHARACTERS, writeExport } from '../src/export.js';
import { factLines, type TransactionFacts } from '../src/chain/facts.js';
import { explain, type Explained } from '../src/explain.js';
import { SAVED_EXAMPLES, type SavedExample } from './saved.js';
import { binaryBytes, isBinaryPart, MAX_PROOF_PART_CHARACTERS, MAX_PUBLIC_INPUTS_CHARACTERS, MAX_VERIFICATION_KEY_CHARACTERS, partFromBytes, type ProofInputs } from '../src/inputs.js';
import { reportSections, unreadReport, type Report } from '../src/report.js';
import type { Request, Response, ToPage } from './protocol.js';
import { runSwiftness } from './swiftness.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id}`);
  return node as T;
};
const proofFile = $<HTMLInputElement>('proof-file');
const proofText = $<HTMLTextAreaElement>('proof-text');
const publicFile = $<HTMLInputElement>('public-file');
const keyFile = $<HTMLInputElement>('key-file');
const checkButton = $<HTMLButtonElement>('check');
const exportFile = $<HTMLInputElement>('export-file');
const status = $<HTMLParagraphElement>('status');
const reportBox = $<HTMLElement>('report');
const rerunResult = $<HTMLParagraphElement>('rerun-result');
const sections = $<HTMLDivElement>('sections');
const download = $<HTMLButtonElement>('download');
const lookupText = $<HTMLInputElement>('lookup-text');
const lookupButton = $<HTMLButtonElement>('lookup');
const lookupNetwork = $<HTMLDivElement>('lookup-network');
/** The network chosen. */
const network = (): string => lookupNetwork.querySelector<HTMLInputElement>('input:checked')?.value ?? NETWORKS.ethereum[0]!;
const lookupNote = $<HTMLParagraphElement>('lookup-note');
const exampleLookup = $<HTMLButtonElement>('example-lookup');
const familyChoices = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="family"]'));
const plain = $<HTMLParagraphElement>('plain');
const lookupForm = $<HTMLFormElement>('lookup-form');
const networkSummary = $<HTMLSpanElement>('network-summary');
const statusCell = $<HTMLDivElement>('status-cell');
const factStatus = $<HTMLElement>('fact-status');
const factProof = $<HTMLElement>('fact-proof');
const statusNote = $<HTMLElement>('status-note');
const proofDetail = $<HTMLElement>('proof-detail');
const factSettlement = $<HTMLElement>('fact-settlement');
const settlementDetail = $<HTMLElement>('settlement-detail');
const provesBlock = $<HTMLDivElement>('proves-block');
const provesList = $<HTMLUListElement>('proves');
const unknownBlock = $<HTMLDivElement>('unknown-block');
const unknownList = $<HTMLUListElement>('unknown');
const factsBox = $<HTMLDivElement>('facts');
const recordedNote = $<HTMLParagraphElement>('recorded-note');
const explorers = $<HTMLParagraphElement>('explorer-links');
const savedExamples = $<HTMLDivElement>('saved-examples');
const sourceBox = $<HTMLDivElement>('source');
const share = $<HTMLButtonElement>('share');
const examples = [$<HTMLButtonElement>('example-semaphore'), $<HTMLButtonElement>('example-tampered'), $<HTMLButtonElement>('example-risc-zero'), $<HTMLButtonElement>('example-noir'), $<HTMLButtonElement>('example-cairo')] as const;

/** Longer than any supported proof takes on a phone; a check that runs past it is stopped and reported as not checked. */
const TIME_LIMIT_MS = 300_000;
type Sendable = { kind: 'check'; inputs: ProofInputs } | { kind: 'rerun'; export: string } | { kind: 'lookup'; network: string; hash: string; saved?: string };
/**
 * Each check runs in a new worker that is discarded afterwards, so no
 * verifier instance, and nothing a malformed file did to one, outlasts the
 * check it was made for.
 */
const ask = (request: Sendable): Promise<Response> =>
  new Promise((resolve) => {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    const finish = (response: Response): void => {
      clearTimeout(timer);
      worker.terminate();
      resolve(response);
    };
    const timer = setTimeout(() => finish({ id: 0, ok: false, message: 'the check did not finish in time' }), TIME_LIMIT_MS);
    worker.onmessage = (event: MessageEvent<ToPage>) => {
      const message = event.data;
      if ('kind' in message && message.kind === 'cairo-on-page') {
        // This browser's worker ran out of stack; the page's own thread has more.
        void runSwiftness(message.build, message.text).then((outcome) => worker.postMessage({ kind: 'cairo-done', call: message.call, outcome }));
        return;
      }
      finish(message);
    };
    worker.onerror = () => finish({ id: 0, ok: false, message: 'the verification worker stopped' });
    worker.onmessageerror = () => finish({ id: 0, ok: false, message: 'the verification worker sent an answer that could not be read' });
    worker.postMessage({ ...request, id: 1 } satisfies Request);
  });

/** A proof file that is not text, such as a Noir proof, is held here; the text box is for text. */
let binaryProof: string | undefined;
function setProof(part: string): void {
  if (isBinaryPart(part)) {
    binaryProof = part;
    proofText.value = '';
    proofText.placeholder = `Binary proof file chosen (${binaryBytes(part)?.length ?? 0} bytes). Type here to check text instead.`;
  } else {
    binaryProof = undefined;
    proofText.placeholder = '';
    proofText.value = part;
  }
}
const proofPart = (): string => binaryProof ?? proofText.value;
proofText.addEventListener('input', () => {
  binaryProof = undefined;
  proofText.placeholder = '';
});

let current: { inputs: ProofInputs; report: Report; source?: ChainSource; address?: string } | undefined;

/** Everything shown comes through textContent: no file content is ever parsed as markup. */
/** The reader's view: what happened, the two verdicts, what the proof shows and what it does not. */
function present(explained: Explained): void {
  plain.textContent = explained.happened;
  plain.hidden = false;
  statusCell.hidden = explained.status === undefined;
  factStatus.textContent = explained.status?.text ?? '';
  statusNote.textContent = explained.status?.note ?? '';
  factProof.textContent = explained.proofCheck.text;
  factProof.className = explained.proofCheck.tone;
  proofDetail.textContent = explained.proofCheck.detail ?? '';
  factSettlement.textContent = explained.settlement.text;
  settlementDetail.textContent = explained.settlement.detail;
  const fill = (block: HTMLElement, list: HTMLUListElement, lines: string[]): void => {
    list.replaceChildren(
      ...lines.map((line) => {
        const entry = document.createElement('li');
        entry.textContent = line;
        return entry;
      }),
    );
    block.hidden = lines.length === 0;
  };
  fill(provesBlock, provesList, explained.proves);
  fill(unknownBlock, unknownList, explained.unknown);
}

/** A transaction that was read but holds no proof this tool reads: its facts, and nothing to check. */
function showFacts(facts: TransactionFacts): void {
  present(explain({ facts }));
  fillFacts(facts);
  sourceBox.hidden = true;
  sections.replaceChildren();
  reportBox.hidden = false;
  reportBox.dataset.outcome = 'no-proof';
}

/** The provider's account of the transaction, in the technical details. */
function fillFacts(facts: TransactionFacts): void {
  const title = document.createElement('h3');
  title.textContent = 'What the provider reported about the transaction';
  const list = document.createElement('dl');
  list.className = 'facts-list';
  for (const [label, value] of factLines(facts)) {
    const term = document.createElement('dt');
    term.textContent = label;
    const detail = document.createElement('dd');
    detail.textContent = value;
    list.append(term, detail);
  }
  factsBox.replaceChildren(title, list);
  factsBox.hidden = false;
}

function show(report: Report, source?: ChainSource, recordedSource = false, facts?: TransactionFacts): void {
  present(explain(source === undefined ? { report } : { report, source, ...(facts === undefined ? {} : { facts }) }));
  if (facts === undefined) factsBox.hidden = true;
  else fillFacts(facts);
  if (source === undefined) {
    sourceBox.hidden = true;
    sourceBox.replaceChildren();
  } else {
    const [heading, ...lines] = renderChainSource(source, recordedSource).split('\n');
    const title = document.createElement('h3');
    title.textContent = 'Where the proof was found';
    const intro = document.createElement('p');
    intro.textContent = heading!;
    const list = document.createElement('ul');
    for (const line of lines) {
      const entry = document.createElement('li');
      entry.textContent = line.replace(/^\s*- /, '');
      list.append(entry);
    }
    sourceBox.replaceChildren(title, intro, list);
    sourceBox.hidden = false;
  }
  sections.replaceChildren(
    ...reportSections(report).map((section) => {
      const box = document.createElement('div');
      box.className = `section ${section.tone}`;
      const heading = document.createElement('h3');
      heading.textContent = section.heading;
      box.append(heading);
      if (section.summary !== undefined) {
        const summary = document.createElement('p');
        summary.className = 'summary';
        summary.textContent = section.summary;
        box.append(summary);
      }
      if (section.items.length > 0) {
        const list = document.createElement('ul');
        for (const item of section.items) {
          const entry = document.createElement('li');
          entry.textContent = item;
          list.append(entry);
        }
        box.append(list);
      }
      return box;
    }),
  );
  reportBox.hidden = false;
  reportBox.dataset.outcome = report.outcome;
}

function notChecked(message: string): void {
  current = undefined;
  explorers.hidden = true;
  rerunResult.hidden = true;
  download.hidden = true;
  share.hidden = true;
  show(unreadReport('error', message));
}

async function busy(label: string, work: () => Promise<void>): Promise<void> {
  const controls = [checkButton, proofFile, publicFile, keyFile, exportFile, lookupButton, exampleLookup, ...examples, ...savedExamples.querySelectorAll('button')];
  for (const control of controls) control.disabled = true;
  status.textContent = label;
  try {
    await work();
    status.textContent = 'Done.';
  } catch (error) {
    notChecked(error instanceof Error ? error.message : String(error));
    status.textContent = 'The check could not be completed.';
  } finally {
    for (const control of controls) control.disabled = false;
  }
}

async function readFile(file: File, limit: number): Promise<string> {
  if (file.size > limit * 4) throw new Error('the file is too large to be a supported file');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
}

/** One file of a check, text or binary, read the way the command line reads it. */
async function readPart(file: File, limit: number): Promise<string> {
  // A limit in characters is also the limit in bytes: no supported file needs more bytes than characters.
  if (file.size > limit) throw new Error('the file is too large to be a supported file');
  return partFromBytes(new Uint8Array(await file.arrayBuffer()));
}

/** The proof text together with the two extra files, when they are chosen. */
async function gather(proof: string): Promise<ProofInputs> {
  const [publicInputs, verificationKey] = [publicFile.files?.[0], keyFile.files?.[0]];
  return {
    proof,
    ...(publicInputs ? { publicInputs: await readPart(publicInputs, MAX_PUBLIC_INPUTS_CHARACTERS) } : {}),
    ...(verificationKey ? { verificationKey: await readPart(verificationKey, MAX_VERIFICATION_KEY_CHARACTERS) } : {}),
  };
}

async function check(proof: string): Promise<void> {
  await checkInputs(await gather(proof));
}
/** Only the most recent request may show its answer; an older one that finishes later is dropped. */
let latest = 0;
async function checkInputs(inputs: ProofInputs): Promise<void> {
  const mine = ++latest;
  const response = await ask({ kind: 'check', inputs });
  if (mine !== latest) return;
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== 'check') throw new Error('unexpected answer from the verification worker');
  current = { inputs, report: response.report };
  rerunResult.hidden = true;
  explorers.hidden = true;
  show(response.report);
  download.hidden = false;
  share.hidden = true;
}

const NETWORK_LABELS: Record<string, string> = {
  sepolia: 'Ethereum Sepolia (test network)',
  ethereum: 'Ethereum',
  base: 'Base',
  'base-sepolia': 'Base Sepolia (test network)',
  optimism: 'Optimism',
  arbitrum: 'Arbitrum One',
  polygon: 'Polygon',
  'stellar-testnet': 'Stellar testnet',
  'stellar-mainnet': 'Stellar mainnet',
};

/** Shows the networks of one family, choosing `network` if given. */
function chooseFamily(family: ChainFamily, network?: string): void {
  for (const choice of familyChoices) choice.checked = choice.value === family;
  const chosen = network ?? NETWORKS[family][0]!;
  lookupNetwork.replaceChildren(
    ...NETWORKS[family].map((name) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'network';
      input.value = name;
      input.checked = name === chosen;
      label.append(input, ` ${NETWORK_LABELS[name] ?? name}`);
      return label;
    }),
  );
  describeProvider();
}
/** The networks a lookup will ask, in order: a bare Stellar hash is tried on testnet, then mainnet, unless a network was chosen by hand. */
let chosenByHand = false;
function candidates(): string[] {
  const reference = readTransactionReference(lookupText.value);
  return reference?.family === 'stellar' && reference.network === undefined && !chosenByHand ? ['stellar-testnet', 'stellar-mainnet'] : [network()];
}
const host = (name: string): string => new URL(PAGE_RPCS[name]!).hostname;
function describeProvider(): void {
  const names = candidates();
  networkSummary.textContent = names.length > 1 ? 'Stellar testnet, then mainnet' : (NETWORK_LABELS[names[0]!] ?? names[0]!);
  const to = names.length > 1 ? `${host(names[0]!)}, then, if it is not found there, to ${host(names[1]!)}` : host(names[0]!);
  const sourcify = familyOf(names[0]!) === 'ethereum' ? ' If it holds no proof and calls an unfamiliar function, the contract\'s address is also sent to sourcify.dev to name that function.' : '';
  lookupNote.textContent = `Checking sends the transaction hash to ${to}, a public RPC that can see someone asked about it. Any proof found is checked on this device.${sourcify}`;
}
for (const choice of familyChoices)
  choice.addEventListener('change', () => {
    chosenByHand = true;
    chooseFamily(choice.value as ChainFamily);
  });
lookupNetwork.addEventListener('change', () => {
  chosenByHand = true;
  describeProvider();
});
// A pasted link or hash picks its own family and network.
lookupText.addEventListener('input', () => {
  const reference = readTransactionReference(lookupText.value);
  if (reference === undefined) return;
  const chosen = familyChoices.find((choice) => choice.checked)?.value;
  if (reference.network !== undefined) {
    chosenByHand = false;
    chooseFamily(reference.family, reference.network);
  } else if (chosen !== reference.family) {
    chosenByHand = false;
    chooseFamily(reference.family);
  } else describeProvider();
});

async function lookUp(): Promise<void> {
  // A new lookup replaces the last result as soon as it starts.
  reportBox.hidden = true;
  const mine = ++latest;
  const tried = candidates();
  let resolved: { network: string; hash: string } | undefined;
  let response: Response | undefined;
  for (const [index, name] of tried.entries()) {
    const next = resolveTransaction(lookupText.value, name);
    if ('reason' in next) throw new Error(next.reason);
    resolved = next;
    if (index > 0) status.textContent = `Not found on ${NETWORK_LABELS[tried[index - 1]!]}; trying ${NETWORK_LABELS[name]}…`;
    response = await ask({ kind: 'lookup', network: next.network, hash: next.hash });
    if (mine !== latest) return;
    const notFound = response.ok && response.kind === 'lookup' && !response.found && response.facts === undefined && response.reason.startsWith('the provider has no such transaction');
    if (!notFound) break;
  }
  if (response === undefined || resolved === undefined) throw new Error('no network to look the transaction up on');
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== 'lookup') throw new Error('unexpected answer from the verification worker');
  if (tried.length > 1) chooseFamily('stellar', resolved.network);
  presentLookup(response, `?network=${encodeURIComponent(resolved.network)}&tx=${encodeURIComponent(resolved.hash)}`);
}

/** Links to inspect the transaction elsewhere; opening one leaves this page. */
function showExplorers(network: string, hash: string): void {
  const links = explorerLinks(network, hash);
  explorers.replaceChildren(
    'Inspect it elsewhere: ',
    ...links.flatMap((link, index) => {
      const anchor = document.createElement('a');
      anchor.href = link.url;
      anchor.textContent = link.label;
      anchor.rel = 'noopener noreferrer';
      anchor.target = '_blank';
      return index === 0 ? [anchor] : [', ', anchor];
    }),
  );
  explorers.hidden = links.length === 0;
}

/** Shows a lookup's answer, live or saved; `address` is the page address that repeats it. */
function presentLookup(response: Extract<Response, { kind: 'lookup' }>, address: string): void {
  const query = new URLSearchParams(address);
  const saved = SAVED_EXAMPLES.find((example) => example.id === query.get('example'));
  const network = saved?.network ?? query.get('network');
  const hash = saved?.hash ?? query.get('tx');
  if (network !== null && hash !== null) showExplorers(network, hash);
  recordedNote.hidden = response.recorded === undefined;
  recordedNote.textContent =
    response.recorded === undefined
      ? ''
      : `Saved example. The provider's answers were recorded on ${response.recorded} and replayed here; nothing was fetched now. Any proof was checked again on this device. Whether the transaction can still be fetched from the network was not checked.`;
  if (!response.found && response.facts !== undefined) {
    // Read, but holding no proof this tool reads: show what it was rather than an error.
    current = undefined;
    rerunResult.hidden = true;
    download.hidden = true;
    share.hidden = true;
    showFacts(response.facts);
    history.replaceState(null, '', address);
    return;
  }
  if (!response.found) throw new Error(response.reason);
  current = { inputs: response.inputs, report: response.report, source: response.source, address };
  rerunResult.hidden = true;
  show(response.report, response.source, false, response.facts);
  download.hidden = false;
  share.hidden = false;
  // The address now names this result, so it can be shared or reloaded.
  history.replaceState(null, '', address);
}

/** A saved example: the recorded answers, replayed through the same lookup. Nothing is sent anywhere. */
async function runSaved(example: SavedExample): Promise<void> {
  reportBox.hidden = true;
  const mine = ++latest;
  lookupText.value = example.hash;
  chosenByHand = true;
  chooseFamily('stellar', example.network);
  const response = await ask({ kind: 'lookup', network: example.network, hash: example.hash, saved: example.id });
  if (mine !== latest) return;
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== 'lookup') throw new Error('unexpected answer from the verification worker');
  presentLookup(response, `?example=${encodeURIComponent(example.id)}`);
}
for (const example of SAVED_EXAMPLES) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'quiet';
  button.id = `saved-${example.id}`;
  button.textContent = example.label;
  button.addEventListener('click', () => void busy('Replaying the saved example and checking any proof on this device…', () => runSaved(example)));
  savedExamples.append(button);
}
// Enter or the button: the form is never submitted anywhere.
lookupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!lookupButton.disabled) void busy('Looking up the transaction, then checking any proof on this device…', lookUp);
});
exampleLookup.addEventListener('click', () => {
  lookupText.value = 'https://sepolia.etherscan.io/tx/0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787';
  chosenByHand = false;
  chooseFamily('ethereum', 'sepolia');
  void busy('Looking up the transaction, then checking its proof on this device…', lookUp);
});
share.addEventListener('click', () => {
  if (current?.address === undefined) return;
  const link = `${location.origin}${location.pathname}${current.address}`;
  void navigator.clipboard.writeText(link).then(
    () => (status.textContent = 'Link copied. Opening it looks the transaction up again and checks its proof.'),
    () => (status.textContent = `Copy this link: ${link}`),
  );
});

// A shared link: look the transaction up as soon as the page opens.
{
  const params = new URLSearchParams(location.search);
  const saved = SAVED_EXAMPLES.find((example) => example.id === params.get('example'));
  if (saved !== undefined) void busy('Replaying the saved example and checking any proof on this device…', () => runSaved(saved));
  const network = params.get('network');
  const hash = params.get('tx');
  const family = network === null ? undefined : familyOf(network);
  chooseFamily(family ?? 'stellar', family === undefined ? undefined : network!);
  if (family !== undefined && hash !== null) {
    // The link names its network, so only that one is asked.
    chosenByHand = true;
    lookupText.value = hash;
    void busy('Looking up the shared transaction, then checking its proof on this device…', lookUp);
  }
}

checkButton.addEventListener('click', () => {
  void busy('Checking on this device…', () => check(proofPart()));
});

proofFile.addEventListener('change', () => {
  const file = proofFile.files?.[0];
  if (!file) return;
  void busy('Checking on this device…', async () => {
    const part = await readPart(file, MAX_PROOF_PART_CHARACTERS);
    setProof(part);
    await check(part);
  });
});

async function fetchPart(url: string): Promise<string> {
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`could not load the example (${response.status})`);
  return partFromBytes(new Uint8Array(await response.arrayBuffer()));
}
/**
 * A test proof shipped with the page, with its other files if it has any.
 * They are fetched from the page's own address and checked like chosen files.
 */
async function example(urls: { proof: string; publicInputs?: string; verificationKey?: string }, change: (text: string) => string = (text) => text): Promise<void> {
  const proof = change(await fetchPart(urls.proof));
  const inputs: ProofInputs = {
    proof,
    ...(urls.publicInputs === undefined ? {} : { publicInputs: await fetchPart(urls.publicInputs) }),
    ...(urls.verificationKey === undefined ? {} : { verificationKey: await fetchPart(urls.verificationKey) }),
  };
  // Files chosen earlier are not part of an example.
  for (const input of [proofFile, publicFile, keyFile]) input.value = '';
  setProof(proof);
  await checkInputs(inputs);
}
/** One number of the proof raised by one, which is enough for the verifier to reject it. */
function altered(text: string): string {
  const proof = JSON.parse(text) as { nullifier: string };
  proof.nullifier = (BigInt(proof.nullifier) + 1n).toString();
  return `${JSON.stringify(proof, null, 2)}\n`;
}
examples[0].addEventListener('click', () => void busy('Checking on this device…', () => example({ proof: membershipUrl })));
examples[1].addEventListener('click', () => void busy('Checking on this device…', () => example({ proof: membershipUrl }, altered)));
examples[2].addEventListener('click', () => void busy('Checking on this device…', () => example({ proof: receiptUrl })));
examples[3].addEventListener('click', () => void busy('Checking on this device…', () => example({ proof: noirProofUrl, publicInputs: noirPublicUrl, verificationKey: noirKeyUrl })));
examples[4].addEventListener('click', () => void busy('Checking on this device… A Cairo proof can take a minute.', () => example({ proof: cairoUrl })));

// Choosing either extra file checks again once a proof is there.
for (const extra of [publicFile, keyFile]) {
  extra.addEventListener('change', () => {
    if (proofPart() !== '') void busy('Checking on this device…', () => check(proofPart()));
  });
}

exportFile.addEventListener('change', () => {
  const file = exportFile.files?.[0];
  if (!file) return;
  void busy('Repeating the check on this device…', async () => {
    const mine = ++latest;
    const response = await ask({ kind: 'rerun', export: await readFile(file, MAX_EXPORT_CHARACTERS) });
    if (mine !== latest) return;
    if (!response.ok) throw new Error(response.message);
    if (response.kind !== 'rerun') throw new Error('unexpected answer from the verification worker');
    const { result } = response;
    current = undefined;
    download.hidden = true;
    share.hidden = true;
    rerunResult.hidden = false;
    if (result.reproduced) {
      rerunResult.className = 'pass';
      rerunResult.textContent = `REPRODUCED: checking the proof again gave the same report (outcome: ${result.report.outcome}).`;
      show(result.report, result.source, true);
    } else if (result.kind === 'unreadable') {
      rerunResult.className = 'fail';
      rerunResult.textContent = `Not rerun: ${result.reason}.`;
      sections.replaceChildren();
      plain.hidden = true;
      sourceBox.hidden = true;
      reportBox.hidden = false;
      reportBox.dataset.outcome = 'unreadable';
    } else {
      rerunResult.className = 'fail';
      rerunResult.textContent = `NOT REPRODUCED: checking the proof again gave a different report. Sections that differ: ${result.fields.join(', ')}. The report below is from this run.`;
      show(result.report, result.source, true);
    }
  });
});

download.addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([writeExport(current.inputs, current.report, current.source)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `lumenlenz-evidence-${current.report.input.sha256.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
