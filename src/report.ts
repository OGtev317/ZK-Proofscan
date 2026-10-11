import type { AdapterReview, LoadedAdapter } from './adapter.js';
import { readPublicInput } from './recorded/reading.js';
import type { RecognisedKey } from './registry.js';
import type { VerificationResult } from './result.js';
import { asPaddedAscii } from './semaphore-v4/text.js';
import { partBytes } from './inputs.js';
import { sha256Hex } from './sha256.js';
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
  proofSystem: { protocol: Protocol; curve: Curve; variant?: string };
  verificationKeySha256: string;
  verificationKeyContentSha256: string;
  publicInputsSha256: string;
}

/**
 * Whether a supplied key is one this tool has on record. A match answers
 * "which published key is this" and nothing else: provenance, the link to
 * circuit source, the review of the record and the review of any
 * explanation are separate statements.
 */
export type KeyRecognition =
  | { match: 'none' }
  | {
      match: 'exact';
      registry: { revision: number; sha256: string };
      artifact: RecognisedKey['artifact'];
      key: string;
      /** The explanation this tool holds for the circuit, and whether this report uses it. */
      explanation: { adapter: string; review: AdapterReview; applied: boolean } | null;
    };

/**
 * A report carries a claim only when the verifier accepted the proof. There
 * is no timestamp: the same input and the same tool give the same report.
 *
 * `basis` says what a pass rests on. With `bundled-circuit` the keys and the
 * explanation ship with this tool for one known circuit. With
 * `recorded-circuit` the key came with the proof, is an exact match to a
 * recorded key, and an explanation bound to that key is applied. With
 * `supplied-key` the key came with the proof and no explanation is applied,
 * so a program must not read `valid` there as a statement about any claim.
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
      basis: 'recorded-circuit';
      claim: string;
      hidden: string[];
      public: { name: string; meaning: string; value: string; valueIfText?: string; valueAsAddress?: string }[];
      verification: { result: 'passed' } & SuppliedKeyVerification;
      keyRecognition: KeyRecognition & { match: 'exact' };
      explanation: ReportExplanation;
      /** Checks this tool did not make. Each is needed before the claim supports a decision. */
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
      keyRecognition: KeyRecognition;
      explanation: { review: { status: 'unreviewed'; note: string } };
      limits: string[];
      assumptions: string[];
    })
  | (Common & { outcome: 'invalid'; basis: 'supplied-key'; publicInputs: string[]; verification: { result: 'failed' } & SuppliedKeyVerification; keyRecognition: KeyRecognition })
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
  const common: Common = { reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(partBytes(proofText)) } };
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
export function buildSuppliedKeyReport(
  proofText: string,
  result: SuppliedResult,
  recognise: (contentSha256: string) => KeyRecognition,
  /** The explanation bound to this exact key, if this build has one. */
  explain: (contentSha256: string) => LoadedAdapter | undefined = () => undefined,
): Report {
  const common: Common = { reportVersion: 2, tool: TOOL, input: { sha256: sha256Hex(partBytes(proofText)) } };
  if (result.status === 'unsupported') return { ...common, outcome: 'unsupported', reason: result.reason };
  if (result.status === 'error') return { ...common, outcome: 'error', message: result.message };
  const verification: SuppliedKeyVerification = {
    verifier: result.verifier,
    proofSystem: { protocol: result.protocol, curve: result.curve, ...(result.variant === undefined ? {} : { variant: result.variant }) },
    verificationKeySha256: result.verificationKeySha256,
    verificationKeyContentSha256: result.verificationKeyContentSha256,
    publicInputsSha256: result.publicInputsSha256,
  };
  const keyRecognition = recognise(result.verificationKeyContentSha256);
  const recognised = keyRecognition.match === 'exact';
  if (result.status === 'invalid') {
    return { ...common, outcome: 'invalid', basis: 'supplied-key', publicInputs: result.publicSignals, verification: { result: 'failed', ...verification }, keyRecognition };
  }
  const adapter = explain(result.verificationKeyContentSha256);
  if (adapter !== undefined && keyRecognition.match === 'exact') {
    const { manifest } = adapter;
    // An explanation with the wrong number of names would mislabel the inputs.
    if (manifest.publicFields.length !== result.publicSignals.length) throw new Error('the adapter and the verification disagree on the public inputs');
    return {
      ...common,
      outcome: 'valid',
      basis: 'recorded-circuit',
      claim: manifest.explanation.claim,
      hidden: manifest.explanation.hidden,
      public: manifest.publicFields.map(({ name, meaning, reading }, i) => {
        const value = result.publicSignals[i]!;
        const read = reading === undefined ? undefined : readPublicInput(value, reading);
        return { name, meaning, value, ...(read?.kind === 'text' ? { valueIfText: read.value } : {}), ...(read?.kind === 'address' ? { valueAsAddress: read.value } : {}) };
      }),
      verification: { result: 'passed', ...verification },
      keyRecognition,
      explanation: { adapter: { id: manifest.id, revision: manifest.revision, sha256: adapter.sha256 }, review: manifest.review, circuit: manifest.circuit },
      applicationChecks: manifest.explanation.applicationChecks.map((check) => ({ id: check.id, status: 'not-performed' as const, description: check.description })),
      limits: manifest.explanation.limits,
      assumptions: manifest.explanation.assumptions,
    };
  }
  return {
    ...common,
    outcome: 'valid',
    basis: 'supplied-key',
    claim: SUPPLIED_KEY.claim(recognised),
    hidden: [...SUPPLIED_KEY.hidden],
    publicInputs: result.publicSignals,
    verification: { result: 'passed', ...verification },
    keyRecognition,
    explanation: { review: { status: 'unreviewed', note: SUPPLIED_KEY.review } },
    limits: SUPPLIED_KEY.limits(result.protocol, recognised),
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
  `using ${verification.verifier.name} ${verification.verifier.version}, against the verification key supplied with the proof (${SYSTEM_NAME[verification.proofSystem.protocol]} on ${CURVE_NAME[verification.proofSystem.curve]}${verification.proofSystem.variant === undefined ? '' : `, variant ${verification.proofSystem.variant}`}).`;
const suppliedFiles = (verification: SuppliedKeyVerification): string[] => [
  `Verification key file (SHA-256): ${verification.verificationKeySha256}`,
  `Public inputs file (SHA-256): ${verification.publicInputsSha256}`,
];
const LINK: Record<RecognisedKey['artifact']['circuitLink']['status'], string> = { established: 'Established', 'partly-established': 'Partly established', unconfirmed: 'Unconfirmed' };
const reviewLine = (review: { status: 'unreviewed' | 'reviewed'; note: string; reviewer?: string; date?: string }): string =>
  review.status === 'reviewed' ? `Reviewed by ${review.reviewer} on ${review.date}. ${review.note}` : `NOT REVIEWED. ${review.note}`;

/** One line for each separate question about a supplied key. */
function keySection(recognition: KeyRecognition, verification: SuppliedKeyVerification): ReportSection {
  const content = `Content SHA-256 (the key itself, whatever its file's spacing): ${verification.verificationKeyContentSha256}`;
  if (recognition.match === 'none') {
    return {
      heading: 'Verification key',
      summary: 'Not recognised. It matches no key recorded in this tool. That is not a sign that anything is wrong with it.',
      items: [content],
      tone: 'caution',
    };
  }
  const { artifact, explanation } = recognition;
  const { provenance } = artifact;
  return {
    heading: 'Verification key',
    summary: `Recognised: an exact match to a recorded key (${artifact.description}; ${recognition.key}).`,
    items: [
      content,
      `Where the recorded key came from: ${provenance.publisher}, package ${provenance.package} ${provenance.version}, file ${provenance.file} (SHA-256 ${provenance.sha256}), ${provenance.url}`,
      `Circuit the publisher names: ${artifact.circuit.name}, ${artifact.circuit.source}`,
      `Tied to that circuit source: ${LINK[artifact.circuitLink.status]}. ${artifact.circuitLink.note}`,
      `This record: ${reviewLine(artifact.entryReview)}`,
      explanation === null
        ? 'Explanation of the circuit: this tool has none.'
        : explanation.applied
          ? `Explanation of the circuit: adapter ${explanation.adapter}, applied to this report. ${reviewLine(explanation.review)}`
          : `Explanation of the circuit: this tool has one (adapter ${explanation.adapter}), which this report does not apply. ${reviewLine(explanation.review)}`,
      `Registry revision ${recognition.registry.revision} (SHA-256 ${recognition.registry.sha256})`,
    ],
    tone: 'plain',
  };
}

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
          keySection(report.keyRecognition, report.verification),
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
      if (report.basis === 'recorded-circuit') {
        const { explanation } = report;
        const wasReviewed = explanation.review.status === 'reviewed';
        return [
          { heading: 'Claim', summary: report.claim, items: [], tone: 'plain' },
          { heading: 'Hidden by the proof', items: report.hidden, tone: 'plain' },
          {
            heading: 'Public',
            items: report.public.map((field) => `${field.name}: ${field.value}${asText(field.valueIfText)}${field.valueAsAddress === undefined ? '' : ` (written as an address: ${field.valueAsAddress})`} — ${field.meaning}`),
            tone: 'plain',
          },
          { heading: 'Cryptographic verification', summary: `PASSED ${using(report.verification)}`, items: suppliedFiles(report.verification), tone: 'pass' },
          keySection(report.keyRecognition, report.verification),
          {
            heading: 'Explanation',
            summary: reviewLine(explanation.review),
            items: [
              `Adapter ${explanation.adapter.id} revision ${explanation.adapter.revision} (SHA-256 ${explanation.adapter.sha256})`,
              `Circuit: ${explanation.circuit.name}, ${explanation.circuit.source}`,
              `Keys and circuit: ${explanation.circuit.linkToArtifacts}`,
            ],
            tone: wasReviewed ? 'plain' : 'caution',
          },
          { heading: 'Checks not performed', items: report.applicationChecks.map((check) => check.description), tone: 'caution' },
          { heading: 'Limits', items: report.limits, tone: 'caution' },
          { heading: 'This result assumes', items: report.assumptions, tone: 'plain' },
          file,
        ];
      }
      if (report.basis === 'supplied-key') {
        return [
          { heading: 'Claim', summary: report.claim, items: [], tone: 'caution' },
          { heading: 'Hidden by the proof', items: report.hidden, tone: 'plain' },
          { heading: 'Public', summary: SUPPLIED_KEY.publicNote, items: numbered(report.publicInputs), tone: 'plain' },
          { heading: 'Cryptographic verification', summary: `PASSED ${using(report.verification)}`, items: suppliedFiles(report.verification), tone: 'pass' },
          keySection(report.keyRecognition, report.verification),
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
