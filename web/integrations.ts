import { defineLumenLenzReport, type LumenLenzReportElement } from '../src/browser/index.js';
import { prepareWalletReview, matchesWalletReview, type LocalReviewTicket } from '../src/integrations/wallet-review.js';
import type { ToPage } from './protocol.js';
import { SAVED_EXAMPLES } from './saved.js';

defineLumenLenzReport();
const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const card = document.querySelector('lumenlenz-report') as LumenLenzReportElement;
let worker: Worker | undefined;
let requestId = 0;
function clear(): void { requestId++; worker?.terminate(); worker = undefined; card.clear(); get('embed-status').textContent = ''; }
function load(saved: string): void {
  clear();
  const example = SAVED_EXAMPLES.find((item) => item.id === saved)!;
  const id = ++requestId;
  get('embed-status').textContent = 'Reading saved provider data locally…';
  worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<ToPage>) => {
    const result = event.data;
    if (!('id' in result) || result.id !== requestId || result.id !== id) return;
    if (!result.ok) { get('embed-status').textContent = 'The saved example could not be read.'; return; }
    if (result.kind !== 'lookup') return;
    get('embed-status').textContent = `Saved provider answers recorded ${result.recorded ?? 'previously'}, not a fresh network query. ${result.found ? 'Proof checked by the local worker; the component only displays its result.' : 'No supported proof; transaction facts only.'}`;
    if (result.found) card.result = { report: result.report, source: result.source, ...(result.facts ? { facts: result.facts } : {}) };
    else if (result.facts) card.result = { facts: result.facts };
    else card.clear();
    worker?.terminate(); worker = undefined;
  };
  worker.onerror = () => { clear(); get('embed-status').textContent = 'The local worker could not start.'; };
  worker.postMessage({ kind: 'lookup', id, saved, hash: example.hash, network: example.network });
}
get('embed-proof').addEventListener('click', () => load('stellar-private-payment'));
get('embed-swap').addEventListener('click', () => load('stellar-soroswap'));
get('embed-clear').addEventListener('click', clear);
const input = get<HTMLTextAreaElement>('review-xdr');
const ack = get<HTMLInputElement>('review-ack');
const confirm = get<HTMLButtonElement>('review-confirm');
const radios = [...document.querySelectorAll<HTMLInputElement>('[name="review-network"]')];
const network = (): string => radios.find((radio) => radio.checked)!.value;
let ticket: LocalReviewTicket | undefined;
const reset = (): void => { ticket = undefined; ack.checked = false; ack.disabled = true; confirm.disabled = true; get('review-details').replaceChildren(); get('review-status').textContent = ''; };
input.addEventListener('input', reset);
radios.forEach((radio) => radio.addEventListener('change', reset));
get('review-local').addEventListener('click', () => {
  reset();
  const result = prepareWalletReview(input.value, network());
  if (result.kind === 'not-reviewed') { get('review-status').textContent = result.reason; return; }
  ticket = result;
  const details = document.createElement('pre');
  details.textContent = JSON.stringify(result.preview, null, 2);
  get('review-details').append(details);
  get('review-status').textContent = result.note;
  ack.disabled = false;
});
ack.addEventListener('change', () => { confirm.disabled = !ack.checked || !ticket; });
confirm.addEventListener('click', () => {
  if (!ack.checked || !ticket || !matchesWalletReview(ticket, input.value, network())) { reset(); get('review-status').textContent = 'The envelope or network changed. Review again.'; return; }
  get('review-status').textContent = 'Acknowledged locally for this exact envelope and network. No wallet invoked; nothing signed or submitted. This ticket is not an authorization or safety decision.';
});
window.addEventListener('pagehide', () => { clear(); reset(); input.value = ''; });
