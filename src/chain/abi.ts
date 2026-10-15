import { decodeFunctionData, type Abi, type AbiFunction, type Hex } from 'viem';

/**
 * A contract's interface, where its verified source is published. Used only
 * to name the function an ordinary transaction called and label its
 * arguments; nothing about a proof rests on it.
 */
export type ContractAbi = (chainId: number, address: string) => Promise<Abi | undefined>;

export const SOURCIFY = 'https://sourcify.dev';
const MAX_ANSWER_BYTES = 2_097_152;
const TIMEOUT_MS = 10_000;

/**
 * Asks Sourcify for a contract's interface. Sends the chain id and the
 * contract's address, nothing else. Answers only when Sourcify has verified
 * source for that contract; any failure is no answer, never an error.
 */
export function sourcifyAbi(): ContractAbi {
  return async (chainId, address) => {
    if (!Number.isSafeInteger(chainId) || !/^0x[0-9a-f]{40}$/.test(address)) return undefined;
    try {
      const response = await fetch(`${SOURCIFY}/server/v2/contract/${chainId}/${address}?fields=abi`, { credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_ANSWER_BYTES) return undefined;
      const answer = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { match?: unknown; abi?: unknown };
      if ((answer.match !== 'match' && answer.match !== 'exact_match') || !Array.isArray(answer.abi)) return undefined;
      return answer.abi as Abi;
    } catch {
      return undefined;
    }
  };
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_TEXT = 320;

/** An argument for a reader: numbers in full, short byte strings in full, long ones cut, lists and records shortened. */
function show(value: unknown, depth = 0): string {
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    if (/^0x[0-9a-fA-F]{40}$/.test(value)) return value.toLowerCase();
    if (/^0x[0-9a-fA-F]*$/.test(value)) return value.length > 26 ? `${value.slice(0, 18)}… (${(value.length - 2) / 2} bytes)` : value;
    return JSON.stringify(value.length > 40 ? `${value.slice(0, 40)}…` : value);
  }
  if (depth > 2) return '…';
  if (Array.isArray(value)) return `[${value.slice(0, 4).map((item) => show(item, depth + 1)).join(', ')}${value.length > 4 ? `, … ${value.length} in all` : ''}]`;
  if (typeof value === 'object' && value !== null) return `{${Object.entries(value).slice(0, 4).map(([key, item]) => `${NAME.test(key) ? key : '?'}: ${show(item, depth + 1)}`).join(', ')}}`;
  return '?';
}

/**
 * Names the function call data invokes, with its arguments labelled, using
 * a contract's interface. Undefined when the interface does not hold the
 * function, or its names are not plain identifiers.
 */
export function describeCallWithAbi(abi: Abi, input: string): string | undefined {
  try {
    const { functionName, args } = decodeFunctionData({ abi, data: input as Hex });
    const values = (args ?? []) as readonly unknown[];
    const item = abi.find((entry): entry is AbiFunction => entry.type === 'function' && entry.name === functionName && entry.inputs.length === values.length);
    if (item === undefined || !NAME.test(functionName)) return undefined;
    const parts = item.inputs.map((parameter, index) => `${parameter.name !== undefined && NAME.test(parameter.name) ? parameter.name : `argument ${index + 1}`}: ${show(values[index])}`);
    const text = `${functionName}(${parts.join(', ')})`;
    return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…)` : text;
  } catch {
    return undefined;
  }
}
