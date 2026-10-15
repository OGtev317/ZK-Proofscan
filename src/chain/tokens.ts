import { decodeEventLog, decodeFunctionResult, encodeFunctionData, erc20Abi, erc721Abi, hexToString, toFunctionSelector, type Hex } from 'viem';
import type { RpcClient } from './rpc.js';

/**
 * Token movements and permissions an Ethereum transaction's receipt records,
 * read with viem from the standard ERC-20 and ERC-721 events. What a token
 * is called, and how many decimal places it uses, is whatever the token's
 * own contract says; anyone can deploy a token that calls itself USDC, so
 * the name is always given as the token's claim, beside its address.
 */
export type TokenEvent =
  | { kind: 'transfer'; token: string; from: string; to: string; amount: string }
  | { kind: 'nft-transfer'; token: string; from: string; to: string; tokenId: string }
  | { kind: 'approval'; token: string; owner: string; spender: string; amount: string; unlimited: boolean }
  | { kind: 'approval-for-all'; token: string; owner: string; operator: string; approved: boolean };

const WORD = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_EVENTS = 20;
const MAX_TOKENS = 5;
const MAX_UINT256 = (1n << 256n) - 1n;

type Decoded = { eventName: string; args: Record<string, unknown> };
/** One log as an ERC-20 event, else as an ERC-721 event; the two share event names but not their indexed fields. */
function decode(topics: Hex[], data: Hex): { standard: 'erc20' | 'erc721'; event: Decoded } | undefined {
  for (const [standard, abi] of [['erc20', erc20Abi], ['erc721', erc721Abi]] as const) {
    try {
      const event = decodeEventLog({ abi, topics: topics as [Hex, ...Hex[]], data, strict: true }) as unknown as Decoded;
      return { standard, event };
    } catch {
      // Not this standard's form of the event.
    }
  }
  return undefined;
}
const lower = (value: unknown): string => String(value).toLowerCase();

/** Reads the standard token events out of a receipt's logs; anything else is left out. */
export function readTokenEvents(logs: unknown): { events: TokenEvent[]; more: boolean } {
  if (!Array.isArray(logs)) return { events: [], more: false };
  const events: TokenEvent[] = [];
  let more = false;
  for (const log of logs) {
    if (typeof log !== 'object' || log === null) continue;
    const { address, topics, data } = log as { address?: unknown; topics?: unknown; data?: unknown };
    if (typeof address !== 'string' || !ADDRESS.test(address.toLowerCase()) || !Array.isArray(topics) || topics.length === 0 || !topics.every((topic) => typeof topic === 'string' && WORD.test(topic.toLowerCase()))) continue;
    if (typeof data !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(data)) continue;
    // Every one of these events indexes two addresses. A real contract pads each with zeros; viem would
    // read the last 20 bytes of anything, so a log with other padding is left out as malformed.
    if (topics.length < 3 || !(topics as string[]).slice(1, 3).every((topic) => /^0x0{24}/.test(topic))) continue;
    const decoded = decode(topics.map((topic) => topic.toLowerCase() as Hex), data.toLowerCase() as Hex);
    if (decoded === undefined) continue;
    const token = address.toLowerCase();
    const { eventName, args } = decoded.event;
    let event: TokenEvent | undefined;
    if (eventName === 'Transfer' && decoded.standard === 'erc20') event = { kind: 'transfer', token, from: lower(args.from), to: lower(args.to), amount: String(args.value) };
    else if (eventName === 'Transfer') event = { kind: 'nft-transfer', token, from: lower(args.from), to: lower(args.to), tokenId: String(args.tokenId) };
    // An allowance of 2^256 - 1, or near it, is how contracts ask for unlimited spending.
    else if (eventName === 'Approval' && decoded.standard === 'erc20') event = { kind: 'approval', token, owner: lower(args.owner), spender: lower(args.spender), amount: String(args.value), unlimited: (args.value as bigint) >= MAX_UINT256 >> 1n };
    else if (eventName === 'ApprovalForAll') event = { kind: 'approval-for-all', token, owner: lower(args.owner), operator: lower(args.operator), approved: args.approved === true };
    if (event === undefined) continue;
    if (events.length === MAX_EVENTS) {
      more = true;
      break;
    }
    events.push(event);
  }
  return { events, more };
}

/** What a token's contract says it is called and how many decimal places it uses; either may be unknown. */
export interface TokenLabel {
  symbol?: string;
  decimals?: number;
}

/** A token's own symbol, as an ABI string or, for some older tokens, a 32-byte name; kept only if it is short, printable text. */
function readSymbol(result: unknown): string | undefined {
  if (typeof result !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(result)) return undefined;
  let text: string | undefined;
  try {
    text = decodeFunctionResult({ abi: erc20Abi, functionName: 'symbol', data: result as Hex });
  } catch {
    try {
      text = result.length === 66 ? hexToString(result as Hex, { size: 32 }).replace(/\0+$/, '') : undefined;
    } catch {
      text = undefined;
    }
  }
  return text !== undefined && /^[A-Za-z0-9 .$_-]{1,16}$/.test(text) ? text : undefined;
}

/** Asks each token's contract for its symbol and decimal places. A token that does not answer is described by its address alone. */
export async function labelTokens(rpc: RpcClient, tokens: string[]): Promise<Record<string, TokenLabel>> {
  const labels: Record<string, TokenLabel> = {};
  for (const token of [...new Set(tokens)].slice(0, MAX_TOKENS)) {
    const call = async (data: string): Promise<unknown> => rpc.call('eth_call', [{ to: token, data }, 'latest']).catch(() => undefined);
    const symbol = readSymbol(await call(encodeFunctionData({ abi: erc20Abi, functionName: 'symbol' })));
    const decimalsWord = await call(encodeFunctionData({ abi: erc20Abi, functionName: 'decimals' }));
    let decimals: number | undefined;
    try {
      const value = typeof decimalsWord === 'string' && decimalsWord.length === 66 ? decodeFunctionResult({ abi: erc20Abi, functionName: 'decimals', data: decimalsWord as Hex }) : undefined;
      decimals = value !== undefined && value <= 36 ? value : undefined;
    } catch {
      decimals = undefined;
    }
    labels[token] = { ...(symbol === undefined ? {} : { symbol }), ...(decimals === undefined ? {} : { decimals }) };
  }
  return labels;
}

const tokenName = (token: string, label: TokenLabel | undefined): string => (label?.symbol === undefined ? `the token at ${token}` : `a token calling itself ${label.symbol} (${token})`);
/** An amount of a token, in its own units, or in its smallest units when its decimal places are unknown. */
function amountOf(amount: string, token: string, label: TokenLabel | undefined): string {
  const value = BigInt(amount);
  if (label?.decimals === undefined) return `${value} of the smallest units of ${tokenName(token, label)}`;
  const scale = 10n ** BigInt(label.decimals);
  const fraction = (value % scale).toString().padStart(label.decimals, '0').slice(0, 6).replace(/0+$/, '');
  return `${value / scale}${fraction === '' ? '' : `.${fraction}`} of ${tokenName(token, label)}`;
}

/** The token functions a call is most often to, by selector, for describing a call by name. */
export const TOKEN_FUNCTIONS: Record<string, string> = Object.fromEntries(
  ['transfer(address,uint256)', 'approve(address,uint256)', 'transferFrom(address,address,uint256)', 'setApprovalForAll(address,bool)', 'safeTransferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256,bytes)'].map((signature) => [toFunctionSelector(signature), signature.slice(0, signature.indexOf('('))]),
);

/** One sentence per event. */
export function describeTokenEvent(event: TokenEvent, labels: Record<string, TokenLabel>): string {
  const label = labels[event.token];
  switch (event.kind) {
    case 'transfer':
      return `moved ${amountOf(event.amount, event.token, label)} from ${event.from} to ${event.to}`;
    case 'nft-transfer':
      return `moved item ${event.tokenId} of ${tokenName(event.token, label)} from ${event.from} to ${event.to}`;
    case 'approval':
      return event.unlimited
        ? `allowed ${event.spender} to spend an UNLIMITED amount of ${tokenName(event.token, label)} belonging to ${event.owner}, which lets it move all of them at any time until the permission is withdrawn`
        : `allowed ${event.spender} to spend up to ${amountOf(event.amount, event.token, label)} belonging to ${event.owner}`;
    case 'approval-for-all':
      return event.approved
        ? `allowed ${event.operator} to move ALL items of ${tokenName(event.token, label)} belonging to ${event.owner}`
        : `withdrew ${event.operator}'s permission to move items of ${tokenName(event.token, label)} belonging to ${event.owner}`;
  }
}
