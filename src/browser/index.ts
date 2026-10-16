import { explain } from '../explain.js';
import { transactionStory } from '../story.js';
import type { TransactionFacts } from '../chain/facts.js';
import type { ChainSource } from '../chain/source.js';
import type { Report } from '../report.js';

export type ReportCardInput = { report: Report; source?: ChainSource; facts?: TransactionFacts } | { facts: TransactionFacts };
export interface LumenLenzReportElement extends HTMLElement { result: ReportCardInput | undefined; clear(): void }

/** Framework-neutral, display-only component. No network, wallet, storage, HTML parsing or auto-registration. */
export function defineLumenLenzReport(registry: CustomElementRegistry = customElements): CustomElementConstructor {
  const previous = registry.get('lumenlenz-report');
  if (previous) return previous;
  class ReportCard extends HTMLElement implements LumenLenzReportElement {
    #result: ReportCardInput | undefined;
    set result(value: ReportCardInput | undefined) { this.#result = value; this.render(); }
    get result(): ReportCardInput | undefined { return this.#result; }
    connectedCallback(): void { this.render(); }
    clear(): void { this.#result = undefined; this.replaceChildren(); }
    disconnectedCallback(): void { this.clear(); }
    render(): void {
      this.replaceChildren();
      this.setAttribute('role', 'region');
      this.setAttribute('aria-label', 'LumenLenz supplied report');
      if (!this.#result) { this.append(this.text('p', 'No report supplied.')); return; }
      try {
        if (JSON.stringify(this.#result).length > 262_144) throw new Error('report too large');
        const view = explain(this.#result);
        this.append(this.text('h3', 'LumenLenz report'), this.text('p', 'Supplied report. This display component does not verify proofs or authenticate execution data. Experimental, unaudited; explanations are not reviewed.'));
        const replaceLocalClaim = (text: string): string => text.replaceAll('on this device', 'as recorded in the supplied report').replaceAll('Checked on this device', 'Recorded check');
        this.append(this.text('p', replaceLocalClaim(view.summary)));
        const verdicts = document.createElement('dl');
        for (const [label, value] of [['Network data', view.status?.text ?? 'Not applicable'], ['Proof check (supplied report)', view.proofCheck.text], ['Settlement (reported)', view.settlement.text]]) verdicts.append(this.text('dt', label!), this.text('dd', value!));
        this.append(verdicts);
        if (view.status) this.append(this.text('p', view.status.note));
        this.append(this.text('p', view.settlement.detail));
        if (this.#result.facts?.family === 'stellar') {
          const story = transactionStory(this.#result.facts);
          this.append(this.text('h4', 'Recorded asset movements'), this.text('p', story.evidence));
          for (const movement of story.movements) this.append(this.text('p', movement.label));
          this.append(this.text('p', `Fee charged: ${story.fee}`));
          for (const permission of story.permissions) this.append(this.text('p', permission));
          for (const change of this.#result.facts.contractChanges ?? []) this.append(this.text('p', `${change.contract}: ${change.description} ${change.evidence}`));
        }
        for (const [title, lines] of [['What the supplied report establishes', view.proves], ['What remains unknown', view.unknown]] as const) {
          if (!lines.length) continue;
          const list = document.createElement('ul');
          list.append(...lines.map((line) => this.text('li', line)));
          this.append(this.text('h4', title), list);
        }
      } catch { this.replaceChildren(this.text('p', 'This supplied report could not be rendered. No verification was performed.')); }
    }
    text(tag: string, text: string): HTMLElement { const element = document.createElement(tag); element.textContent = text; return element; }
  }
  registry.define('lumenlenz-report', ReportCard);
  return ReportCard;
}
