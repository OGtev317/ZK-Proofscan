import { MAX_EXPORT_CHARACTERS, writeExport } from '../src/export.js';
import { MAX_PROOF_PART_CHARACTERS, MAX_PUBLIC_INPUTS_CHARACTERS, MAX_VERIFICATION_KEY_CHARACTERS, type ProofInputs } from '../src/inputs.js';
import { reportSections, unreadReport, type Report } from '../src/report.js';
import type { Request, Response } from './protocol.js';

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

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let nextId = 1;
const waiting = new Map<number, (response: Response) => void>();
worker.onmessage = (event: MessageEvent<Response>) => {
  waiting.get(event.data.id)?.(event.data);
  waiting.delete(event.data.id);
};
worker.onerror = () => {
  for (const settle of waiting.values()) settle({ id: 0, ok: false, message: 'the verification worker stopped' });
  waiting.clear();
};
type Sendable = { kind: 'check'; inputs: ProofInputs } | { kind: 'rerun'; export: string };
const ask = (request: Sendable): Promise<Response> =>
  new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, resolve);
    worker.postMessage({ ...request, id } satisfies Request);
  });

let current: { inputs: ProofInputs; report: Report } | undefined;

/** Everything shown comes through textContent: no file content is ever parsed as markup. */
function show(report: Report): void {
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
  show(unreadReport('error', message));
}

async function busy(label: string, work: () => Promise<void>): Promise<void> {
  const controls = [checkButton, proofFile, publicFile, keyFile, exportFile];
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

/** The proof text together with the two extra files, when they are chosen. */
async function gather(proof: string): Promise<ProofInputs> {
  const [publicInputs, verificationKey] = [publicFile.files?.[0], keyFile.files?.[0]];
  return {
    proof,
    ...(publicInputs ? { publicInputs: await readFile(publicInputs, MAX_PUBLIC_INPUTS_CHARACTERS) } : {}),
    ...(verificationKey ? { verificationKey: await readFile(verificationKey, MAX_VERIFICATION_KEY_CHARACTERS) } : {}),
  };
}

async function check(proof: string): Promise<void> {
  const inputs = await gather(proof);
  const response = await ask({ kind: 'check', inputs });
  if (!response.ok) throw new Error(response.message);
  if (response.kind !== 'check') throw new Error('unexpected answer from the verification worker');
  current = { inputs, report: response.report };
  rerunResult.hidden = true;
  show(response.report);
  download.hidden = false;
}

checkButton.addEventListener('click', () => {
  void busy('Checking on this device…', () => check(proofText.value));
});

proofFile.addEventListener('change', () => {
  const file = proofFile.files?.[0];
  if (!file) return;
  void busy('Checking on this device…', async () => {
    const text = await readFile(file, MAX_PROOF_PART_CHARACTERS);
    proofText.value = text;
    await check(text);
  });
});

// Choosing either extra file checks again once a proof is there.
for (const extra of [publicFile, keyFile]) {
  extra.addEventListener('change', () => {
    if (proofText.value !== '') void busy('Checking on this device…', () => check(proofText.value));
  });
}

exportFile.addEventListener('change', () => {
  const file = exportFile.files?.[0];
  if (!file) return;
  void busy('Repeating the check on this device…', async () => {
    const response = await ask({ kind: 'rerun', export: await readFile(file, MAX_EXPORT_CHARACTERS) });
    if (!response.ok) throw new Error(response.message);
    if (response.kind !== 'rerun') throw new Error('unexpected answer from the verification worker');
    const { result } = response;
    current = undefined;
    download.hidden = true;
    rerunResult.hidden = false;
    if (result.reproduced) {
      rerunResult.className = 'pass';
      rerunResult.textContent = `REPRODUCED: checking the proof again gave the same report (outcome: ${result.report.outcome}).`;
      show(result.report);
    } else if (result.kind === 'unreadable') {
      rerunResult.className = 'fail';
      rerunResult.textContent = `Not rerun: ${result.reason}.`;
      sections.replaceChildren();
      reportBox.hidden = false;
      reportBox.dataset.outcome = 'unreadable';
    } else {
      rerunResult.className = 'fail';
      rerunResult.textContent = `NOT REPRODUCED: checking the proof again gave a different report. Sections that differ: ${result.fields.join(', ')}. The report below is from this run.`;
      show(result.report);
    }
  });
});

download.addEventListener('click', () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([writeExport(current.inputs, current.report)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `zk-proofscan-evidence-${current.report.input.sha256.slice(0, 12)}.json`;
  link.click();
  URL.revokeObjectURL(url);
});
