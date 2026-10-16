import registryUrl from '../registry/keys.json?url';
import { loadKeyRegistry } from '../src/registry.js';
import { circuitDirectory, proofProfile } from '../src/profiles.js';
import { transactionStory } from '../src/story.js';
import type { TransactionFacts } from '../src/chain/facts.js';
import type { ChainSource } from '../src/chain/source.js';
import type { Report } from '../src/report.js';
import type { LookupAvailability } from '../src/chain/availability.js';
import type { AuthorizationNode, PreviewResult } from '../src/chain/preview.js';

const get = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const node = (tag: string, text: string): HTMLElement => {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
};
const list = (lines: string[]): HTMLUListElement => {
  const result = document.createElement('ul');
  result.append(...lines.map((text) => node('li', text)));
  return result;
};
const detail = (label: string, text: string): HTMLDetailsElement => {
  const element = document.createElement('details');
  element.append(node('summary', label), node('p', text));
  return element;
};

/** All outside text is rendered as textContent, never HTML. */
export function renderLenses(facts?: TransactionFacts, report?: Report, source?: ChainSource): void {
  const storyBox = get('transaction-story');
  storyBox.replaceChildren();
  // Structured movements are read for Stellar only; an Ethereum transaction's token activity is in its facts.
  const storied = facts?.family === 'stellar' ? facts : undefined;
  storyBox.hidden = storied === undefined;
  if (storied !== undefined) {
    const story = transactionStory(storied);
    storyBox.append(node('h3', 'Transaction story'), node('p', story.title), node('p', story.evidence));
    const flow = document.createElement('ol');
    flow.className = 'movement-flow';
    flow.setAttribute('aria-label', 'Recorded asset movements');
    for (const movement of story.movements) {
      const item = document.createElement('li');
      const short = (address: string | undefined, fallback: string): string => address === undefined ? fallback : `${address.slice(0, 7)}…${address.slice(-5)}`;
      item.append(node('strong', movement.amount), node('p', `${short(movement.from, 'Created')} → ${short(movement.to, 'Destroyed')}`), detail('Movement and full addresses', movement.label));
      flow.append(item);
    }
    storyBox.append(flow, node('h4', 'Fee charged'), node('p', story.fee));
    if (story.permissions.length) storyBox.append(node('h4', 'Permissions granted'), list(story.permissions));
    if (story.contracts.length) storyBox.append(detail('Contracts involved', story.contracts.join('\n')));
    storyBox.append(detail('Limits of this story', story.notes.join('\n')));
    storyBox.append(detail('Terms in this report', 'Proof check: a verifier checked the proof against a key or program. Settlement: whether the transaction was finalized, as reported separately. Witness: private inputs, not recovered here. Allowance: permission for another address to spend tokens.'));
  }
  const profile = report === undefined ? undefined : proofProfile(report, source);
  const box = get('proof-profile');
  const content = get('profile-content');
  content.replaceChildren();
  box.hidden = profile === undefined;
  if (profile !== undefined) {
    content.append(node('h3', profile.title), node('p', profile.purpose), node('p', `Verifier: ${profile.verifier}`), node('p', `Registry entry: ${profile.registryReview}`), node('p', `Explanation: ${profile.explanationReview}`));
    if (profile.key) content.append(node('p', `Recorded key: ${profile.key}`));
    if (profile.circuitSource) content.append(detail('Circuit source reference', profile.circuitSource));
    content.append(node('h4', 'Public inputs'), list(profile.inputs.length ? profile.inputs.map((input) => `${input.name}: ${input.meaning}`) : ['No reviewed meanings for these inputs are recorded.']));
    if (profile.deployment) content.append(detail('Deployment and code identity', `${profile.deployment.network}: ${profile.deployment.contract}\nCode SHA-256: ${profile.deployment.codeHash ?? 'not available'}\n${profile.deployment.identity}`));
    content.append(node('h4', 'What this does not establish'), list(profile.limits));
  }
}

export function renderAvailability(value?: LookupAvailability): void {
  const box = get('availability');
  box.replaceChildren();
  box.hidden = value === undefined;
  if (value === undefined) return;
  box.append(node('p', 'Provider availability'), list(value.attempts.map((attempt) => `${attempt.provider}: ${attempt.result}${attempt.window === undefined ? '; history window not reported' : `; ledgers ${attempt.window.oldestLedger}–${attempt.window.latestLedger}${attempt.window.ledgerRetentionWindow === undefined ? '' : ` (retention ${attempt.window.ledgerRetentionWindow} ledgers)`}`}`)), node('p', value.note));
}

function invocationTree(nodes: AuthorizationNode[]): HTMLUListElement {
  const result = document.createElement('ul');
  for (const entry of nodes) {
    const item = document.createElement('li');
    item.append(node('p', `${entry.contract === undefined ? '' : `${entry.contract}: `}${entry.call}`));
    if (entry.children.length) item.append(invocationTree(entry.children));
    result.append(item);
  }
  return result;
}

export function setupLenses(): void {
  const directory = get<HTMLDetailsElement>('circuit-directory');
  let loaded = false;
  directory.addEventListener('toggle', () => {
    if (!directory.open || loaded) return;
    loaded = true;
    const content = get('directory-content');
    content.textContent = 'Loading the pinned local registry…';
    void fetch(registryUrl).then(async (response) => {
      if (!response.ok) throw new Error('registry not available');
      const registry = loadKeyRegistry(new Uint8Array(await response.arrayBuffer()));
      content.replaceChildren(node('p', 'A directory of recorded keys, not a security endorsement. Registry and explanation reviews are separate.'));
      for (const entry of circuitDirectory(registry)) {
        const item = document.createElement('details');
        item.append(node('summary', entry.title), node('p', entry.review), node('p', entry.link), node('p', entry.explanation), node('p', `Circuit source: ${entry.source}`), detail(`${entry.keys.length} recorded keys`, entry.keys.join(', ')));
        content.append(item);
      }
    }).catch(() => { loaded = false; content.textContent = 'The pinned registry could not be loaded or its integrity check failed.'; });
  });

  const input = get<HTMLTextAreaElement>('unsigned-xdr');
  const inspect = get<HTMLButtonElement>('inspect-xdr');
  const output = get('preview-result');
  const choices = [...document.querySelectorAll<HTMLInputElement>('input[name="preview-network"]')];
  const network = (): string => choices.find((choice) => choice.checked)!.value;
  let epoch = 0;
  let inspected: PreviewResult | undefined;
  const reset = (): void => {
    epoch++;
    inspected = undefined;
    output.replaceChildren();
    output.hidden = true;
  };
  input.addEventListener('input', reset);
  choices.forEach((choice) => choice.addEventListener('change', reset));
  get('clear-xdr').addEventListener('click', () => { input.value = ''; reset(); });
  inspect.addEventListener('click', () => {
    const mine = ++epoch;
    inspected = undefined;
    output.textContent = 'Inspecting locally…'; output.hidden = false;
    const text = input.value;
    const selected = network();
    void import('../src/chain/preview.js').then(({ inspectStellarTransaction }) => {
      if (mine !== epoch) return;
      inspected = inspectStellarTransaction(text, selected);
      output.replaceChildren();
      if (inspected.kind === 'not-inspected') { output.textContent = inspected.reason; return; }
      output.append(node('h3', 'Requested actions — not submitted'), node('p', `Selected network: ${inspected.network}; transaction source: ${inspected.source}`), node('p', `Fee payer: ${inspected.feePayer}; maximum fee: ${inspected.maxFeeStroops} stroops; envelope signatures: ${inspected.signatures}`));
      for (const operation of inspected.operations) {
        output.append(node('p', operation.description));
        if (operation.contract) output.append(node('p', `Contract: ${operation.contract}`));
        for (const auth of operation.authorizations) output.append(node('p', `Requested signer: ${auth.signer}`), invocationTree([auth.invocation]));
      }
      output.append(list(inspected.warnings));
    }).catch(() => { if (mine === epoch) output.textContent = 'The local inspector could not start.'; });
  });
}
