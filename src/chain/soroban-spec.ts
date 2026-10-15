import xdrLib from '@stellar/js-xdr';
import { Address, scValToNative, StrKey, xdr } from '@stellar/stellar-base';

/**
 * A Soroban contract's interface, as its own code declares it (SEP-48: the
 * `contractspecv0` custom section of the contract's WebAssembly). It names
 * a function's parameters and an event's fields; it says nothing about what
 * the contract does or whether it does it correctly. A Stellar Asset
 * Contract is built into the network and has no code to read, so it is
 * given the standard token interface (SEP-41) instead.
 */
export interface ContractSpec {
  functions: Map<string, string[]>;
  events: { name: string; prefix: string[]; topics: string[]; data: string[]; format: 'single' | 'vec' | 'map' }[];
  /** Where the names came from, for a reader. */
  origin: 'contract interface' | 'standard token interface';
  /** What the code's own metadata says (`contractmetav0`): its toolchain, and under SEP-55 its source repository. */
  meta: Record<string, string>;
  /** SHA-256 of the contract's code, when it has code. */
  codeHash?: string;
}

const { XdrReader } = xdrLib as unknown as { XdrReader: new (buffer: Uint8Array) => { eof: boolean } };

/** The interface a contract's code declares, or undefined when it declares none that can be read. */
export function readContractSpec(wasm: Uint8Array): ContractSpec | undefined {
  let sections: ArrayBuffer[];
  let metaSections: ArrayBuffer[];
  try {
    const module = new WebAssembly.Module(wasm as Uint8Array<ArrayBuffer>);
    sections = WebAssembly.Module.customSections(module, 'contractspecv0');
    metaSections = WebAssembly.Module.customSections(module, 'contractmetav0');
  } catch {
    return undefined;
  }
  if (sections.length === 0 && metaSections.length === 0) return undefined;
  const spec: ContractSpec = { functions: new Map(), events: [], origin: 'contract interface', meta: readMeta(metaSections) };
  try {
    for (const section of sections) {
      const reader = new XdrReader(new Uint8Array(section));
      while (!reader.eof) {
        const entry = (xdr.ScSpecEntry as unknown as { read(reader: unknown): xdr.ScSpecEntry }).read(reader);
        const kind = entry.switch().name;
        if (kind === 'scSpecEntryFunctionV0') {
          const fn = entry.functionV0();
          spec.functions.set(fn.name().toString(), fn.inputs().map((input) => input.name().toString()));
        } else if (kind === 'scSpecEntryEventV0') {
          const event = entry.eventV0();
          const params = event.params();
          const location = (param: xdr.ScSpecEventParamV0): string => param.location().name;
          spec.events.push({
            name: event.name().toString(),
            prefix: event.prefixTopics().map((topic) => topic.toString()),
            topics: params.filter((param) => location(param) === 'scSpecEventParamLocationTopicList').map((param) => param.name().toString()),
            data: params.filter((param) => location(param) === 'scSpecEventParamLocationData').map((param) => param.name().toString()),
            format: event.dataFormat().name === 'scSpecEventDataFormatSingleValue' ? 'single' : event.dataFormat().name === 'scSpecEventDataFormatMap' ? 'map' : 'vec',
          });
        }
      }
    }
  } catch {
    return spec.functions.size === 0 && Object.keys(spec.meta).length === 0 ? undefined : spec;
  }
  return spec;
}

/** The code's metadata entries, kept only when key and value are short, plain text. */
function readMeta(sections: ArrayBuffer[]): Record<string, string> {
  const meta: Record<string, string> = {};
  try {
    for (const section of sections) {
      const reader = new XdrReader(new Uint8Array(section));
      while (!reader.eof && Object.keys(meta).length < 32) {
        const entry = (xdr.ScMetaEntry as unknown as { read(reader: unknown): xdr.ScMetaEntry }).read(reader).v0();
        const [key, value] = [entry.key().toString(), entry.val().toString()];
        if (/^[a-z_]{1,32}$/.test(key) && /^[\x20-\x7e]{1,120}$/.test(value)) meta[key] = value;
      }
    }
  } catch {
    // Whatever was read before the fault is kept.
  }
  return meta;
}

/** What a contract's code says about how and from what it was built, and what GitHub's record adds. */
export function describeBuild(spec: ContractSpec, attestation?: BuildAttestation): string | undefined {
  if (spec.origin !== 'contract interface') return undefined;
  const { meta } = spec;
  const tools = [meta.rsver === undefined ? undefined : `Rust ${meta.rsver}`, meta.rssdkver === undefined ? undefined : `soroban-sdk ${meta.rssdkver.split('#')[0]}`, meta.cliver === undefined ? undefined : `stellar-cli ${meta.cliver.split('#')[0]}`].filter((tool) => tool !== undefined);
  const built = tools.length === 0 ? 'Its code records no toolchain' : `Its code says it was built with ${tools.join(', ')}`;
  const repo = meta.source_repo;
  if (repo === undefined || !/^github:[A-Za-z0-9_.-]{1,39}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) return `${built}, and names no source repository (SEP-55), so its build cannot be traced to source.`;
  const claim = `${built}, and names ${repo} as its source repository (SEP-55)`;
  if (attestation === undefined) return `${claim}; that was not checked against GitHub's build attestations.`;
  if (!attestation.found) return `${claim}; GitHub has no build attestation for this exact code.`;
  if (!attestation.matches) return `${claim}; GitHub's attestation for this code names a different repository, so the claim does not hold.`;
  return `${claim}; GitHub's attestation for this exact code names that repository at commit ${attestation.commit}. The attestation's signature was not checked here, and it shows how the code was built, not that the source is correct or safe.`;
}

export type BuildAttestation = { found: false } | { found: true; matches: boolean; commit?: string };

/** The standard token interface (SEP-41), and the admin functions of a Stellar Asset Contract. */
export const STANDARD_TOKEN_SPEC: ContractSpec = {
  origin: 'standard token interface',
  meta: {},
  functions: new Map<string, string[]>([
    ['transfer', ['from', 'to', 'amount']],
    ['transfer_from', ['spender', 'from', 'to', 'amount']],
    ['approve', ['from', 'spender', 'amount', 'expiration_ledger']],
    ['burn', ['from', 'amount']],
    ['burn_from', ['spender', 'from', 'amount']],
    ['mint', ['to', 'amount']],
    ['clawback', ['from', 'amount']],
    ['set_admin', ['new_admin']],
    ['set_authorized', ['id', 'authorize']],
    ['balance', ['id']],
    ['allowance', ['from', 'spender']],
  ]),
  events: [],
};

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_TEXT = 360;

/** A value for a reader: addresses as Stellar writes them, numbers in full, long bytes and lists shortened. */
export function showScVal(value: xdr.ScVal, depth = 0): string {
  try {
    const kind = value.switch().name;
    if (kind === 'scvAddress') return Address.fromScAddress(value.address()).toString();
    if (kind === 'scvBytes') {
      const bytes = new Uint8Array(value.bytes());
      const hex = Array.from(bytes.subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
      return bytes.length > 8 ? `0x${hex}… (${bytes.length} bytes)` : `0x${hex}`;
    }
    if (kind === 'scvVec') {
      const items = value.vec() ?? [];
      return depth > 2 ? '[…]' : `[${items.slice(0, 4).map((item) => showScVal(item, depth + 1)).join(', ')}${items.length > 4 ? `, … ${items.length} in all` : ''}]`;
    }
    if (kind === 'scvMap') {
      const entries = value.map() ?? [];
      if (depth > 2) return '{…}';
      return `{${entries
        .slice(0, 6)
        .map((entry) => {
          const key = entry.key().switch().name === 'scvSymbol' ? entry.key().sym().toString() : showScVal(entry.key(), depth + 1);
          return `${NAME.test(key) ? key : '?'}: ${showScVal(entry.val(), depth + 1)}`;
        })
        .join(', ')}${entries.length > 6 ? ', …' : ''}}`;
    }
    const native = scValToNative(value) as unknown;
    if (typeof native === 'bigint' || typeof native === 'number' || typeof native === 'boolean') return String(native);
    if (typeof native === 'string') return NAME.test(native) && kind === 'scvSymbol' ? native : JSON.stringify(native.length > 40 ? `${native.slice(0, 40)}…` : native);
    if (native === null || native === undefined) return 'nothing';
    return kind.replace(/^scv/, '').toLowerCase();
  } catch {
    return '?';
  }
}

const cap = (text: string): string => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…)` : text);

/** A contract call with its arguments named by the contract's interface, or numbered when there is none. */
export function describeInvocation(name: string, args: xdr.ScVal[], spec: ContractSpec | undefined): string {
  if (!NAME.test(name)) return 'a call to a function with an unusual name';
  const names = spec?.functions.get(name);
  const labelled = names !== undefined && names.length === args.length;
  return cap(`${name}(${args.map((arg, index) => `${labelled && NAME.test(names[index]!) ? names[index] : `argument ${index + 1}`}: ${showScVal(arg)}`).join(', ')})`);
}

/** A contract event, its fields named by the contract's interface where one matches, else shown as they are. */
export function describeContractEvent(event: xdr.ContractEvent, spec: ContractSpec | undefined): string | undefined {
  try {
    const contractId = event.contractId();
    if (event.type().name !== 'contract' || contractId === null || contractId === undefined) return undefined;
    const contract = StrKey.encodeContract(contractId as unknown as Buffer);
    const body = event.body().v0();
    const topics = body.topics();
    const symbols = topics.map((topic) => (topic.switch().name === 'scvSymbol' ? topic.sym().toString() : undefined));
    const match = spec?.events.find((candidate) => candidate.prefix.length > 0 && candidate.prefix.every((prefix, index) => symbols[index] === prefix) && topics.length === candidate.prefix.length + candidate.topics.length);
    if (match !== undefined && NAME.test(match.name)) {
      const fields: string[] = match.topics.map((name, index) => `${NAME.test(name) ? name : '?'}: ${showScVal(topics[match.prefix.length + index]!)}`);
      const data = body.data();
      if (match.format === 'single' && match.data.length === 1) fields.push(`${match.data[0]}: ${showScVal(data)}`);
      else if (match.format === 'vec' && data.switch().name === 'scvVec') (data.vec() ?? []).forEach((item, index) => fields.push(`${match.data[index] ?? `value ${index + 1}`}: ${showScVal(item)}`));
      else if (match.format === 'map' && data.switch().name === 'scvMap') for (const entry of data.map() ?? []) fields.push(`${entry.key().switch().name === 'scvSymbol' && NAME.test(entry.key().sym().toString()) ? entry.key().sym().toString() : '?'}: ${showScVal(entry.val())}`);
      else fields.push(`data: ${showScVal(data)}`);
      return cap(`event ${match.name}(${fields.join(', ')}) from contract ${contract}`);
    }
    const label = symbols[0] !== undefined && NAME.test(symbols[0]) ? `event "${symbols[0]}"` : 'an event';
    return cap(`${label} from contract ${contract}, not named by an interface: topics ${showScVal(xdr.ScVal.scvVec(topics))}, data ${showScVal(body.data())}`);
  } catch {
    return undefined;
  }
}
