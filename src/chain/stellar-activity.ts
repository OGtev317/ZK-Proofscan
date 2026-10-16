import { Address, scValToNative, StrKey, xdr } from '@stellar/stellar-sdk';
import { stellarAmount } from './movement.js';
export { stellarAmount, describeMovement } from './movement.js';

/**
 * What a Stellar transaction did, as the network data records it: the fee
 * charged, the memo, each operation's outcome, and the token movements its
 * successful execution emitted as standard events (CAP-67 and SEP-41:
 * transfer, mint, burn, clawback). Diagnostic events are not read: they
 * are debugging output, not a record of what happened. All of it is the
 * provider's word; none is checked here.
 */
export interface StellarActivity {
  /** Events that are not standard token movements, for naming by their contract's interface. */
  others: xdr.ContractEvent[];
  /** The fee charged, in XLM. */
  fee?: string;
  memo?: string;
  /** One line per operation, saying whether it succeeded and, if not, why. */
  outcomes: string[];
  movements: Movement[];
  /** More movements were recorded than are listed. */
  more: boolean;
  moreOtherEvents?: boolean;
}

export interface Movement {
  /** Contract that emitted this event, not a token name supplied by a caller. */
  tokenContract?: string;
  kind: 'transfer' | 'mint' | 'burn' | 'clawback' | 'approve';
  /** For an allowance: the last ledger it holds for. */
  until?: number;
  /** The asset: XLM, an issued asset (code and issuer), or a token contract with no asset of its own. */
  asset: { kind: 'native' } | { kind: 'issued'; code: string; issuer: string } | { kind: 'contract'; contract: string };
  from?: string;
  to?: string;
  amount: bigint;
}

const MAX_MOVEMENTS = 20;
const MAX_OTHER_EVENTS = 10;
const words = (name: string): string => name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

const native = (value: xdr.ScVal): unknown => {
  try {
    return scValToNative(value);
  } catch {
    return undefined;
  }
};
const account = (value: xdr.ScVal): string | undefined => {
  try {
    return value.switch().name === 'scvAddress' ? Address.fromScAddress(value.address()).toString() : undefined;
  } catch {
    return undefined;
  }
};
/** An event's asset topic: `native`, or `CODE:ISSUER` (SEP-11). */
function assetTopic(value: xdr.ScVal | undefined): Movement['asset'] | undefined {
  if (value === undefined) return undefined;
  const text = native(value);
  if (text === 'native') return { kind: 'native' };
  if (typeof text !== 'string') return undefined;
  const match = /^([A-Za-z0-9]{1,12}):(G[A-Z2-7]{55})$/.exec(text);
  return match === null || !StrKey.isValidEd25519PublicKey(match[2]!) ? undefined : { kind: 'issued', code: match[1]!, issuer: match[2]! };
}
/** An event's amount: an i128, or a map holding one (CAP-67 adds a muxed id beside it). */
function amountOf(value: xdr.ScVal): bigint | undefined {
  const read = native(value);
  if (typeof read === 'bigint') return read;
  if (typeof read === 'object' && read !== null && typeof (read as { amount?: unknown }).amount === 'bigint') return (read as { amount: bigint }).amount;
  return undefined;
}

/** A standard token event, read by its topics; anything else is left out. */
function readMovement(event: xdr.ContractEvent): Movement | undefined {
  if (event.type().name !== 'contract') return undefined;
  const contractId = event.contractId();
  if (contractId === null || contractId === undefined) return undefined;
  const contract = StrKey.encodeContract(contractId as unknown as Buffer);
  const body = event.body().v0();
  const topics = body.topics();
  const name = topics[0] === undefined ? undefined : native(topics[0]);
  const amount = amountOf(body.data()) ?? (name === 'approve' ? 0n : undefined);
  if (amount === undefined || typeof name !== 'string') return undefined;
  // The asset topic is last when present; a token contract without one is named by its address.
  const withAsset = (count: number): Movement['asset'] => assetTopic(topics.length === count + 1 ? topics[count] : undefined) ?? { kind: 'contract', contract };
  if (name === 'transfer' && (topics.length === 3 || topics.length === 4)) {
    const [from, to] = [account(topics[1]!), account(topics[2]!)];
    return from === undefined || to === undefined ? undefined : { kind: 'transfer', asset: withAsset(3), from, to, amount };
  }
  // mint and clawback carried an admin topic before CAP-67; the holder is the last address either way.
  if (name === 'mint' && topics.length >= 2 && topics.length <= 4) {
    const hasAsset = assetTopic(topics[topics.length - 1]) !== undefined;
    const to = account(topics[hasAsset ? topics.length - 2 : topics.length - 1]!);
    return to === undefined ? undefined : { kind: 'mint', asset: hasAsset ? assetTopic(topics[topics.length - 1])! : { kind: 'contract', contract }, to, amount };
  }
  // approve(from, spender, [asset]) with data [amount, live_until_ledger] (SEP-41).
  if (name === 'approve' && (topics.length === 3 || topics.length === 4)) {
    const [from, to] = [account(topics[1]!), account(topics[2]!)];
    const data = native(body.data());
    if (from === undefined || to === undefined || !Array.isArray(data) || typeof data[0] !== 'bigint' || typeof data[1] !== 'number') return undefined;
    return { kind: 'approve', asset: withAsset(3), from, to, amount: data[0], until: data[1] };
  }
  if ((name === 'burn' || name === 'clawback') && topics.length >= 2 && topics.length <= 4) {
    const hasAsset = assetTopic(topics[topics.length - 1]) !== undefined;
    const from = account(topics[hasAsset ? topics.length - 2 : topics.length - 1]!);
    return from === undefined ? undefined : { kind: name, asset: hasAsset ? assetTopic(topics[topics.length - 1])! : { kind: 'contract', contract }, from, amount };
  }
  return undefined;
}

/** A memo for a reader: text if it is short and printable, else what kind it is. */
function readMemo(memo: xdr.Memo): string | undefined {
  switch (memo.switch().name) {
    case 'memoNone':
      return undefined;
    case 'memoText': {
      const raw = memo.text();
      const text = typeof raw === 'string' ? raw : new TextDecoder('utf-8', { fatal: false }).decode(raw as unknown as Uint8Array);
      return /^[\p{L}\p{N}\p{P}\p{Zs}]{1,28}$/u.test(text) ? JSON.stringify(text) : 'a text memo that is not plain text';
    }
    case 'memoId':
      return `the number ${memo.id().toString()}`;
    case 'memoHash':
      return `a hash, ${Buffer.from(memo.hash() as unknown as Uint8Array).toString('hex')}`;
    case 'memoReturn':
      return `a return hash, ${Buffer.from(memo.retHash() as unknown as Uint8Array).toString('hex')}`;
    default:
      return undefined;
  }
}

/** Each operation's outcome, from the transaction result. */
function readOutcomes(result: xdr.TransactionResult): string[] {
  let inner = result.result();
  if (inner.switch().name === 'txFeeBumpInnerSuccess' || inner.switch().name === 'txFeeBumpInnerFailed') inner = inner.innerResultPair().result().result() as unknown as typeof inner;
  const code = inner.switch().name;
  if (code !== 'txSuccess' && code !== 'txFailed') return [`the transaction as a whole was refused: ${words(code.replace(/^tx/, ''))}`];
  return inner.results().map((operation, index) => {
    if (operation.switch().name !== 'opInner') return `operation ${index + 1}: not run (${words(operation.switch().name.replace(/^op/, ''))})`;
    const outcome = operation.tr().value().switch().name;
    const kind = operation.tr().switch().name;
    const plain = words(outcome.startsWith(kind) ? outcome.slice(kind.length) : outcome);
    return `operation ${index + 1} (${words(kind)}): ${plain === 'success' ? 'succeeded' : `failed: ${plain}`}`;
  });
}

/**
 * Reads what a transaction did from the provider's answer. Every part is
 * optional: an answer recorded without its result or events gives less,
 * never something wrong.
 */
export function readStellarActivity(answer: { envelope: xdr.TransactionEnvelope; resultXdr?: unknown; events?: unknown; succeeded: boolean }): StellarActivity {
  const activity: StellarActivity = { outcomes: [], movements: [], more: false, others: [] };
  try {
    const tx = answer.envelope.switch().name === 'envelopeTypeTxFeeBump' ? answer.envelope.feeBump().tx().innerTx().v1().tx() : answer.envelope.v1().tx();
    const memo = readMemo(tx.memo());
    if (memo !== undefined) activity.memo = memo;
  } catch {
    // No memo to show.
  }
  if (typeof answer.resultXdr === 'string') {
    try {
      const result = xdr.TransactionResult.fromXDR(answer.resultXdr, 'base64');
      activity.fee = stellarAmount(BigInt(result.feeCharged().toString()), { kind: 'native' }).replace(/ XLM$/, ' XLM');
      activity.outcomes = readOutcomes(result);
    } catch {
      // No result to show.
    }
  }
  // Only a successful transaction's events record what happened; a failed one emits only its fee.
  const events = answer.events as { contractEventsXdr?: unknown } | undefined;
  if (answer.succeeded && Array.isArray(events?.contractEventsXdr)) {
    for (const list of events.contractEventsXdr) {
      if (!Array.isArray(list)) continue;
      for (const encoded of list) {
        if (typeof encoded !== 'string') continue;
        let event: xdr.ContractEvent;
        try {
          event = xdr.ContractEvent.fromXDR(encoded, 'base64');
        } catch {
          continue;
        }
        const movement = readMovement(event);
        if (movement === undefined) {
          if (activity.others.length < MAX_OTHER_EVENTS) activity.others.push(event);
          else activity.moreOtherEvents = true;
          continue;
        }
        if (activity.movements.length === MAX_MOVEMENTS) {
          activity.more = true;
          break;
        }
        const emitter = event.contractId();
        activity.movements.push({ ...movement, ...(emitter == null ? {} : { tokenContract: StrKey.encodeContract(emitter as unknown as Buffer) }) });
      }
    }
  }
  return activity;
}
