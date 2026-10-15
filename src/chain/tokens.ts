import { keccak_256 } from '@noble/hashes/sha3.js';
import type { RpcClient } from './rpc.js';

/**
 * Token movements and permissions an Ethereum transaction's receipt records,
 * read from the standard ERC-20 and ERC-721 events. What a token is called,
 * and how many decimal places it uses, is whatever the token's own contract
 * says; anyone can deploy a token that calls itself USDC, so the name is
 * always given as the token's claim, beside its address.
 */
export type TokenEvent =
  | { kind: 'transfer'; token: string; from: string; to: string; amount: string }
  | { kind: 'nft-transfer'; token: string; from: string; to: string; tokenId: string }
  | { kind: 'approval'; token: string; owner: string; spender: string; amount: string; unlimited: boolean }
  | { kind: 'approval-for-all'; token: string; owner: string; operator: string; approved: boolean };

// Each event's identifier and each call's selector is computed from its signature, never typed in:
// a mistyped identifier silently matches nothing (found in review: one written from memory was wrong).
const keccak = (signature: string): string => `0x${Array.from(keccak_256(new TextEncoder().encode(signature)), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
const TRANSFER = keccak('Transfer(address,address,uint256)');
const APPROVAL = keccak('Approval(address,address,uint256)');
const APPROVAL_FOR_ALL = keccak('ApprovalForAll(address,address,bool)');
const SYMBOL = keccak('symbol()').slice(0, 10);
const DECIMALS = keccak('decimals()').slice(0, 10);

const WORD = /^0x[0-9a-f]{64}$/;
const ADDRESS = /^0x[0-9a-f]{40}$/;
const MAX_EVENTS = 20;
const MAX_TOKENS = 5;
const MAX_UINT256 = (1n << 256n) - 1n;

const asAddress = (word: string): string | undefined => (WORD.test(word) && /^0x0{24}/.test(word) ? `0x${word.slice(26)}` : undefined);

/** Reads the standard token events out of a receipt's logs; anything else is left out. */
export function readTokenEvents(logs: unknown): { events: TokenEvent[]; more: boolean } {
  if (!Array.isArray(logs)) return { events: [], more: false };
  const events: TokenEvent[] = [];
  let more = false;
  for (const log of logs) {
    if (typeof log !== 'object' || log === null) continue;
    const { address, topics, data } = log as { address?: unknown; topics?: unknown; data?: unknown };
    if (typeof address !== 'string' || !ADDRESS.test(address.toLowerCase()) || !Array.isArray(topics) || !topics.every((topic) => typeof topic === 'string' && WORD.test(topic.toLowerCase()))) continue;
    const t = (topics as string[]).map((topic) => topic.toLowerCase());
    const token = address.toLowerCase();
    const word = typeof data === 'string' && /^0x([0-9a-f]{64})$/i.test(data) ? BigInt(data) : undefined;
    let event: TokenEvent | undefined;
    if (t[0] === TRANSFER && t.length === 3 && word !== undefined) {
      const [from, to] = [asAddress(t[1]!), asAddress(t[2]!)];
      if (from !== undefined && to !== undefined) event = { kind: 'transfer', token, from, to, amount: word.toString() };
    } else if (t[0] === TRANSFER && t.length === 4) {
      const [from, to] = [asAddress(t[1]!), asAddress(t[2]!)];
      if (from !== undefined && to !== undefined) event = { kind: 'nft-transfer', token, from, to, tokenId: BigInt(t[3]!).toString() };
    } else if (t[0] === APPROVAL && t.length === 3 && word !== undefined) {
      const [owner, spender] = [asAddress(t[1]!), asAddress(t[2]!)];
      // An allowance of 2^256 - 1, or near it, is how contracts ask for unlimited spending.
      if (owner !== undefined && spender !== undefined) event = { kind: 'approval', token, owner, spender, amount: word.toString(), unlimited: word >= MAX_UINT256 >> 1n };
    } else if (t[0] === APPROVAL_FOR_ALL && t.length === 3 && word !== undefined && word <= 1n) {
      const [owner, operator] = [asAddress(t[1]!), asAddress(t[2]!)];
      if (owner !== undefined && operator !== undefined) event = { kind: 'approval-for-all', token, owner, operator, approved: word === 1n };
    }
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

/** A token's own symbol, as an ABI string or a 32-byte name, kept only if it is short, printable text. */
function readSymbol(result: unknown): string | undefined {
  if (typeof result !== 'string' || !/^0x([0-9a-f]{2})*$/i.test(result)) return undefined;
  const hex = result.slice(2);
  let bytes: number[];
  if (hex.length >= 192) {
    const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
    if (length > 32 || hex.length < 128 + length * 2) return undefined;
    bytes = (hex.slice(128, 128 + length * 2).match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16));
  } else if (hex.length === 64) {
    bytes = (hex.match(/../g) ?? []).map((pair) => Number.parseInt(pair, 16)).filter((byte) => byte !== 0);
  } else return undefined;
  const text = String.fromCharCode(...bytes);
  return /^[A-Za-z0-9 .$_-]{1,16}$/.test(text) ? text : undefined;
}

/** Asks each token's contract for its symbol and decimal places. A token that does not answer is described by its address alone. */
export async function labelTokens(rpc: RpcClient, tokens: string[]): Promise<Record<string, TokenLabel>> {
  const labels: Record<string, TokenLabel> = {};
  for (const token of [...new Set(tokens)].slice(0, MAX_TOKENS)) {
    const call = async (data: string): Promise<unknown> => rpc.call('eth_call', [{ to: token, data }, 'latest']).catch(() => undefined);
    const symbol = readSymbol(await call(SYMBOL));
    const decimalsWord = await call(DECIMALS);
    const decimals = typeof decimalsWord === 'string' && /^0x[0-9a-f]{64}$/i.test(decimalsWord) && BigInt(decimalsWord) <= 36n ? Number(BigInt(decimalsWord)) : undefined;
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
  ['transfer(address,uint256)', 'approve(address,uint256)', 'transferFrom(address,address,uint256)', 'setApprovalForAll(address,bool)', 'safeTransferFrom(address,address,uint256)', 'safeTransferFrom(address,address,uint256,bytes)'].map((signature) => [keccak(signature).slice(0, 10), signature.slice(0, signature.indexOf('('))]),
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
