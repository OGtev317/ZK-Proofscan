import type { LoadedAdapter } from './adapter.js';
import type { VerificationResult } from './result.js';
import { asPaddedAscii } from './semaphore-v4/text.js';
import { sha256Hex, utf8 } from './sha256.js';

export const TOOL = { name: 'zk-proofscan', version: '0.0.0' } as const;

export interface ReportExplanation {
  adapter: { id: string; revision: number; sha256: string };
  review: LoadedAdapter['manifest']['review'];
  circuit: LoadedAdapter['manifest']['circuit'];
}

interface Common {
  reportVersion: 1;
  tool: typeof TOOL;
  input: { sha256: string };
}

/**
 * A report carries a claim only when the verifier accepted the proof. There
 * is no timestamp: the same input and the same tool give the same report.
 */
export type Report =
  | (Common & {
      outcome: 'valid';
      claim: string;
      hidden: string[];
      public: { name: string; meaning: string; value: string }[];
      proofFile: { message: string; messageIfText?: string; scope: string; scopeIfText?: string; merkleTreeDepth: number };
      verification: { result: 'passed'; verifier: { name: string; version: string }; verificationKeysSha256: string };
      explanation: ReportExplanation;
      /** Stated in every format, so a program reading the report sees the same boundary a person does. */
      applicationChecks: { id: string; status: 'not-performed'; description: string }[];
      limits: string[];
      assumptions: string[];
    })
  | (Common & {
      outcome: 'invalid';
      public: { name: string; value: string }[];
      verification: { result: 'failed'; verifier: { name: string; version: string }; verificationKeysSha256: string };
    })
  | (Common & { outcome: 'unsupported'; reason: string })
  | (Common & { outcome: 'error'; message: string });

export function buildReport(proofText: string, result: VerificationResult, adapter: LoadedAdapter): Report {
  const common: Common = { reportVersion: 1, tool: TOOL, input: { sha256: sha256Hex(utf8(proofText)) } };
  if (result.status === 'unsupported') return { ...common, outcome: 'unsupported', reason: result.reason };
  if (result.status === 'error') return { ...common, outcome: 'error', message: result.message };

  const { manifest } = adapter;
  if (result.publicSignals.length !== manifest.publicFields.length) throw new Error('the adapter and the verification disagree on the public inputs');
  const verification = { verifier: result.verifier, verificationKeysSha256: result.artifact.sha256 };
  if (result.status === 'invalid') {
    return {
      ...common,
      outcome: 'invalid',
      public: manifest.publicFields.map((field, i) => ({ name: field.name, value: result.publicSignals[i]! })),
      verification: { result: 'failed', ...verification },
    };
  }
  const messageIfText = asPaddedAscii(BigInt(result.message));
  const scopeIfText = asPaddedAscii(BigInt(result.scope));
  return {
    ...common,
    outcome: 'valid',
    claim: manifest.explanation.claim,
    hidden: manifest.explanation.hidden,
    public: manifest.publicFields.map((field, i) => ({ ...field, value: result.publicSignals[i]! })),
    proofFile: {
      message: result.message,
      ...(messageIfText === undefined ? {} : { messageIfText }),
      scope: result.scope,
      ...(scopeIfText === undefined ? {} : { scopeIfText }),
      merkleTreeDepth: result.artifact.merkleTreeDepth,
    },
    verification: { result: 'passed', ...verification },
    explanation: {
      adapter: { id: manifest.id, revision: manifest.revision, sha256: adapter.sha256 },
      review: manifest.review,
      circuit: manifest.circuit,
    },
    applicationChecks: manifest.explanation.applicationChecks.map((check) => ({ id: check.id, status: 'not-performed' as const, description: check.description })),
    limits: manifest.explanation.limits,
    assumptions: manifest.explanation.assumptions,
  };
}

export interface ReportSection {
  heading: string;
  /** A short statement shown beside the heading, if any. */
  summary?: string;
  items: string[];
  /** How the section should be weighed: a pass, a failure, a caution, or neutral. */
  tone: 'pass' | 'fail' | 'caution' | 'plain';
}

const NOTHING = 'This says nothing about whether a proof is valid.';
const asText = (text: string | undefined): string => (text === undefined ? '' : ` (if this number encodes text, it reads: ${JSON.stringify(text)})`);

/**
 * The report as ordered sections. The command line and the browser page both
 * render from this, so neither can show a section the other leaves out.
 */
export function reportSections(report: Report): ReportSection[] {
  const file: ReportSection = { heading: 'Proof file', summary: `SHA-256 ${report.input.sha256}`, items: [], tone: 'plain' };
  switch (report.outcome) {
    case 'unsupported':
      return [{ heading: 'Not checked', summary: `This is not a supported proof file (${report.reason}).`, items: [NOTHING], tone: 'caution' }, file];
    case 'error':
      return [{ heading: 'Not checked', summary: `The verification could not be completed (${report.message}).`, items: [NOTHING], tone: 'caution' }, file];
    case 'invalid':
      return [
        { heading: 'Claim', summary: 'None. The verifier rejected this proof, so it establishes nothing.', items: [], tone: 'fail' },
        {
          heading: 'Cryptographic verification',
          summary: `FAILED using ${report.verification.verifier.name} ${report.verification.verifier.version}.`,
          items: [`Verification keys (SHA-256): ${report.verification.verificationKeysSha256}`],
          tone: 'fail',
        },
        { heading: 'Public inputs that were checked', items: report.public.map((field) => `${field.name}: ${field.value}`), tone: 'plain' },
        file,
      ];
    case 'valid': {
      const { explanation, verification } = report;
      const reviewed = explanation.review.status === 'reviewed';
      return [
        { heading: 'Claim', summary: report.claim, items: [], tone: 'plain' },
        { heading: 'Hidden by the proof', items: report.hidden, tone: 'plain' },
        {
          heading: 'Public',
          items: [
            ...report.public.map((field) => `${field.name}: ${field.value} — ${field.meaning}`),
            `message in the file: ${report.proofFile.message}${asText(report.proofFile.messageIfText)}`,
            `scope in the file: ${report.proofFile.scope}${asText(report.proofFile.scopeIfText)}`,
            `tree depth: ${report.proofFile.merkleTreeDepth}`,
          ],
          tone: 'plain',
        },
        {
          heading: 'Cryptographic verification',
          summary: `PASSED using ${verification.verifier.name} ${verification.verifier.version}.`,
          items: [`Verification keys (SHA-256): ${verification.verificationKeysSha256}`],
          tone: 'pass',
        },
        {
          heading: 'Explanation',
          summary: reviewed
            ? `Reviewed by ${explanation.review.reviewer} on ${explanation.review.date}. ${explanation.review.note}`
            : `NOT REVIEWED. ${explanation.review.note}`,
          items: [
            `Adapter ${explanation.adapter.id} revision ${explanation.adapter.revision} (SHA-256 ${explanation.adapter.sha256})`,
            `Circuit: ${explanation.circuit.name}, ${explanation.circuit.source}`,
            `Keys and circuit: ${explanation.circuit.linkToArtifacts}`,
          ],
          tone: reviewed ? 'plain' : 'caution',
        },
        { heading: 'Application checks not performed', items: report.applicationChecks.map((check) => check.description), tone: 'caution' },
        { heading: 'Limits', items: report.limits, tone: 'caution' },
        { heading: 'This result assumes', items: report.assumptions, tone: 'plain' },
        file,
      ];
    }
  }
}

export function renderReport(report: Report): string {
  return reportSections(report)
    .flatMap((section) => [
      section.summary === undefined ? `${section.heading}:` : `${section.heading}: ${section.summary}`,
      ...section.items.map((item) => `  - ${item}`),
    ])
    .join('\n');
}
