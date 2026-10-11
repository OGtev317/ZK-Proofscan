import type { LoadedAdapter } from './adapter.js';
import type { VerificationResult } from './result.js';
import { asPaddedAscii } from './semaphore-v4/text.js';
import { sha256Hex, utf8 } from './sha256.js';
import { CURVE_NAME, SUPPLIED_KEY, SYSTEM_NAME } from './supplied-key/explanation.js';
import type { Curve, Protocol } from './supplied-key/importer.js';
import type { SuppliedResult } from './supplied-key/verify.js';

export const TOOL = { name: 'zk-proofscan', version: '0.0.0' } as const;

export interface ReportExplanation {
  adapter: { id: string; revision: number; sha256: string };
  review: LoadedAdapter['manifest']['review'];
  circuit: LoadedAdapter['manifest']['circuit'];
}

interface Common {
  reportVersion: 2;
  tool: typeof TOOL;
  input: { sha256: string };
}

interface SuppliedKeyVerification {
  verifier: { name: string; version: string };
  proofSystem: { protocol: Protocol; curve: Curve };
  verificationKeySha256: string;
  publicInputsSha256: string;
}

/**
 * A report carries a claim only when the verifier accepted the proof. There
 * is no timestamp: the same input and the same tool give the same report.
 *
 * `basis` says what a pass rests on. With `bundled-circuit` the keys and the
 * explanation ship with this tool for one known circuit. With `supplied-key`
 * the key came with the proof and the circuit is unknown, so a program must
 * not read `valid` there as a statement about any particular claim.
 */
export type Report =
  | (Common & {
      outcome: 'valid';
      basis: 'bundled-circuit';
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
      outcome: 'valid';
      basis: 'supplied-key';
      claim: string;
      hidden: string[];
      publicInputs: string[];
      verification: { result: 'passed' } & SuppliedKeyVerification;
      explanation: { review: { status: 'unreviewed'; note: string } };
      limits: string[];
      assumptions: string[];
    })
  | (Common & { outcome: 'invalid'; basis: 'supplied-key'; publicInputs: string[]; verification: { result: 'failed' } & SuppliedKeyVerification })
  | (Common & {
      outcome: 'invalid';
      basis: 'bundled-circuit';
      public: { name: string; value: string }[];
      verification: { result: 'failed'; verifier: { name: string; version: string }; verificationKeysSha256: string };
    })
  | (Common & { outcome: 'unsupported'; reason: string })
  | (Common & { outcome: 'error'; message: string });

/** A report for input that could not even be read, so there is nothing to hash. */
export function unreadReport(outcome: 'unsupported' | 'error', detail: string): Report {
  const common: Common = { reportVersion: 2, tool: TOOL, input: { sha256: 'not computed' } };
  return outcome === 'unsupported' ? { ...common, outcome, reason: detail } : { ...common, outcome, message: detail };
}

export function buildReport(proofText: string, result: VerificationResult, adapter: LoadedAdapter): Report {
  const common: Common = { reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(utf8(proofText)) } };
  if (result.status === 'unsupported') return { ...common, outcome: 'unsupported', reason: result.reason };
  if (result.status === 'error') return { ...common, outcome: 'error', message: result.message };

  const { manifest } = adapter;
  if (result.publicSignals.length !== manifest.publicFields.length) throw new Error('the adapter and the verification disagree on the public inputs');
  const verification = { verifier: result.verifier, verificationKeysSha256: result.artifact.sha256 };
  if (result.status === 'invalid') {
    return {
      ...common,
      outcome: 'invalid',
      basis: 'bundled-circuit',
      public: manifest.publicFields.map((field, i) => ({ name: field.name, value: result.publicSignals[i]! })),
      verification: { result: 'failed', ...verification },
    };
  }
  const messageIfText = asPaddedAscii(BigInt(result.message));
  const scopeIfText = asPaddedAscii(BigInt(result.scope));
  return {
    ...common,
    outcome: 'valid',
    basis: 'bundled-circuit',
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

/** The report for a proof checked against a verification key supplied with it. */
export function buildSuppliedKeyReport(proofText: string, result: SuppliedResult): Report {
  const common: Common = { reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(utf8(proofText)) } };
  if (result.status === 'unsupported') return { ...common, outcome: 'unsupported', reason: result.reason };
  if (result.status === 'error') return { ...common, outcome: 'error', message: result.message };
  const verification: SuppliedKeyVerification = {
    verifier: result.verifier,
    proofSystem: { protocol: result.protocol, curve: result.curve },
    verificationKeySha256: result.verificationKeySha256,
    publicInputsSha256: result.publicInputsSha256,
  };
  if (result.status === 'invalid') {
    return { ...common, outcome: 'invalid', basis: 'supplied-key', publicInputs: result.publicSignals, verification: { result: 'failed', ...verification } };
  }
  return {
    ...common,
    outcome: 'valid',
    basis: 'supplied-key',
    claim: SUPPLIED_KEY.claim,
    hidden: [...SUPPLIED_KEY.hidden],
    publicInputs: result.publicSignals,
    verification: { result: 'passed', ...verification },
    explanation: { review: { status: 'unreviewed', note: SUPPLIED_KEY.review } },
    limits: SUPPLIED_KEY.limits(result.protocol),
    assumptions: SUPPLIED_KEY.assumptions(result.protocol, result.curve),
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

const using = (verification: SuppliedKeyVerification): string =>
  `using ${verification.verifier.name} ${verification.verifier.version}, against the verification key supplied with the proof (${SYSTEM_NAME[verification.proofSystem.protocol]} on ${CURVE_NAME[verification.proofSystem.curve]}).`;
const suppliedFiles = (verification: SuppliedKeyVerification): string[] => [
  `Verification key file (SHA-256): ${verification.verificationKeySha256}`,
  `Public inputs file (SHA-256): ${verification.publicInputsSha256}`,
];
const numbered = (values: string[]): string[] => (values.length === 0 ? ['(none)'] : values.map((value, i) => `public input ${i + 1}: ${value}`));

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
      if (report.basis === 'supplied-key') {
        return [
          { heading: 'Claim', summary: 'None. The verifier rejected this proof, so it establishes nothing.', items: [], tone: 'fail' },
          { heading: 'Cryptographic verification', summary: `FAILED ${using(report.verification)}`, items: suppliedFiles(report.verification), tone: 'fail' },
          { heading: 'Public inputs that were checked', items: numbered(report.publicInputs), tone: 'plain' },
          file,
        ];
      }
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
      if (report.basis === 'supplied-key') {
        return [
          { heading: 'Claim', summary: report.claim, items: [], tone: 'caution' },
          { heading: 'Hidden by the proof', items: report.hidden, tone: 'plain' },
          { heading: 'Public', summary: SUPPLIED_KEY.publicNote, items: numbered(report.publicInputs), tone: 'plain' },
          { heading: 'Cryptographic verification', summary: `PASSED ${using(report.verification)}`, items: suppliedFiles(report.verification), tone: 'pass' },
          { heading: 'Explanation', summary: `NOT REVIEWED. ${report.explanation.review.note}`, items: [], tone: 'caution' },
          { heading: 'Limits', items: report.limits, tone: 'caution' },
          { heading: 'This result assumes', items: report.assumptions, tone: 'plain' },
          file,
        ];
      }
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
