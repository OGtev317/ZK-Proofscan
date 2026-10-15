/// <reference types="vite/client" />
import receiptUrl from '../tests/fixtures/risc-zero/nethermind-test-receipt.txt?url';
import membershipUrl from '../tests/fixtures/semaphore-v4-valid.json?url';
import cairoUrl from '../tests/fixtures/cairo/dynamic-stone6-96-bits.json?url';
import noirProofUrl from '../tests/fixtures/noir/multiplier-evm.proof?url';
import noirPublicUrl from '../tests/fixtures/noir/multiplier-evm.public_inputs?url';
import noirKeyUrl from '../tests/fixtures/noir/multiplier-evm.vk?url';
import { resolveTransaction } from '../src/chain/find.js';
import { familyOf, NETWORKS, PAGE_RPCS, readTransactionReference, type ChainFamily } from '../src/chain/reference.js';
import { renderChainSource, type ChainSource } from '../src/chain/source.js';
import { MAX_EXPORT_CHARACTERS, writeExport } from '../src/export.js';
import { plainWords } from '../src/plain.js';
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
const sourceBox = $<HTMLDivElement>('source');
const share = $<HTMLButtonElement>('share');
const examples = [$<HTMLButtonElement>('example-semaphore'), $<HTMLButtonElement>('example-tampered'), $<HTMLButtonElement>('example-risc-zero'), $<HTMLButtonElement>('example-noir'), $<HTMLButtonElement>('example-cairo')] as const;

/** Longer than any supported proof takes on a phone; a check that runs past it is stopped and reported as not checked. */
const TIME_LIMIT_MS = 300_000;
type Sendable = { kind: 'check'; inputs: ProofInputs } | { kind: 'rerun'; export: string } | { kind: 'lookup'; network: string; hash: string };
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

let current: { inputs: ProofInputs; report: Report; source?: ChainSource; shared?: { network: string; hash: string } } | undefined;

/** Everything shown comes through textContent: no file content is ever parsed as markup. */
function show(report: Report, source?: ChainSource, recordedSource = false): void {
  plain.textContent = plainWords(report, source);
  plain.hidden = false;
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
  rerunResult.hidden = true;
  download.hidden = true;
  share.hidden = true;
  show(unreadReport('error', message));
}

async function busy(label: string, work: () => Promise<void>): Promise<void> {
  const controls = [checkButton, proofFile, publicFile, keyFile, exportFile, lookupButton, exampleLookup, ...examples];
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
function describeProvider(): void {
  const host = new URL(PAGE_RPCS[network()]!).hostname;
  lookupNote.textContent = `Looking up sends the transaction hash to ${host}, a public RPC, which can see that someone asked about it. The proof it finds is then checked on this device.`;
}
for (const choice of familyChoices) choice.addEventListener('change', () => chooseFamily(choice.value as ChainFamily));
lookupNetwork.addEventListener('change', describeProvider);
// A pasted link or hash picks its own family and network.
lookupText.addEventListener('input', () => {
  const reference = readTransactionReference(lookupText.value);
  if (reference === undefined) return;
  const chosen = familyChoices.find((choice) => choice.checked)?.value;
  if (reference.network !== undefined) chooseFamily(reference.family, reference.network);
  else if (chosen !== reference.family) chooseFamily(reference.family);
});

async function lookUp(): Promise<void> {
  const resolved = resolveTransaction(lookupText.value, network());
  if ('reason' in resolved) throw new Error(resolved.reason);
  const mine = ++latest;
  const response = await ask({ kind: 'lookup', network: resolved.network, hash: resolved.hash });
  if (mine !== latest) return;
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== 'lookup') throw new Error('unexpected answer from the verification worker');
  if (!response.found) throw new Error(response.reason);
  current = { inputs: response.inputs, report: response.report, source: response.source, shared: resolved };
  rerunResult.hidden = true;
  show(response.report, response.source);
  download.hidden = false;
  share.hidden = false;
  // The address now names this result, so it can be shared or reloaded.
  history.replaceState(null, '', `?network=${encodeURIComponent(resolved.network)}&tx=${encodeURIComponent(resolved.hash)}`);
}
lookupButton.addEventListener('click', () => void busy('Looking up the transaction, then checking its proof on this device…', lookUp));
exampleLookup.addEventListener('click', () => {
  lookupText.value = 'https://sepolia.etherscan.io/tx/0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787';
  chooseFamily('ethereum', 'sepolia');
  void busy('Looking up the transaction, then checking its proof on this device…', lookUp);
});
share.addEventListener('click', () => {
  if (current?.shared === undefined) return;
  const link = `${location.origin}${location.pathname}?network=${encodeURIComponent(current.shared.network)}&tx=${encodeURIComponent(current.shared.hash)}`;
  void navigator.clipboard.writeText(link).then(
    () => (status.textContent = 'Link copied. Opening it looks the transaction up again and checks its proof.'),
    () => (status.textContent = `Copy this link: ${link}`),
  );
});

// A shared link: look the transaction up as soon as the page opens.
{
  const params = new URLSearchParams(location.search);
  const network = params.get('network');
  const hash = params.get('tx');
  const family = network === null ? undefined : familyOf(network);
  chooseFamily(family ?? 'ethereum', family === undefined ? undefined : network!);
  if (family !== undefined && hash !== null) {
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
  link.download = `zk-proofscan-evidence-${current.report.input.sha256.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
