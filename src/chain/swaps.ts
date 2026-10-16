import { Address, scValToNative, StrKey, type xdr } from '@stellar/stellar-base';
import { stellarAmount, type Movement } from './stellar-activity.js';
import type { ContractSpec } from './soroban-spec.js';

/** Source format, NOT a claim that an arbitrary deployment is Soroswap. */
export const SOROSWAP_SOURCE = 'https://github.com/soroswap/core/blob/6eade008ee6794075ad941609e0fef0d1124d3eb/contracts/router/src/event.rs';
export interface SwapExplanation {
  protocol: 'soroswap-compatible';
  contract: string;
  codeHash: string;
  path: string[];
  amounts: string[];
  recipient: string;
  description: string;
  identity: string;
  source: string;
}

/** Direct two-token swaps only. Require interface, event, limits and committed transfers. */
export function decodeSoroswapSwap(parts: {
  succeeded: boolean;
  call: { contract: string; name: string; args: xdr.ScVal[] };
  spec: ContractSpec | undefined;
  events: xdr.ContractEvent[];
  movements: Movement[];
  truncated: boolean;
}): SwapExplanation | undefined {
  const { call, spec } = parts;
  const exactIn = call.name === 'swap_exact_tokens_for_tokens';
  const exactOut = call.name === 'swap_tokens_for_exact_tokens';
  const expected = exactIn ? ['amount_in', 'amount_out_min', 'path', 'to', 'deadline'] : ['amount_out', 'amount_in_max', 'path', 'to', 'deadline'];
  if (!parts.succeeded || parts.truncated || (!exactIn && !exactOut) || !spec?.codeHash || call.args.length !== 5 || JSON.stringify(spec.functions.get(call.name)) !== JSON.stringify(expected)) return undefined;
  try {
    if (call.args[0]!.switch().name !== 'scvI128' || call.args[1]!.switch().name !== 'scvI128' || call.args[4]!.switch().name !== 'scvU64') return undefined;
    const pathValues = call.args[2]!.vec();
    if (pathValues?.length !== 2 || pathValues.some((v) => v.switch().name !== 'scvAddress')) return undefined;
    const path = pathValues.map((v) => Address.fromScAddress(v.address()).toString());
    if (!path.every(StrKey.isValidContract) || path[0] === path[1]) return undefined;
    const recipient = Address.fromScAddress(call.args[3]!.address()).toString();
    const first = scValToNative(call.args[0]!) as bigint;
    const second = scValToNative(call.args[1]!) as bigint;
    if (first <= 0n || second < 0n) return undefined;
    const candidates = parts.events.filter((event) => {
      const id = event.contractId();
      if (event.type().name !== 'contract' || id == null || StrKey.encodeContract(id as unknown as Buffer) !== call.contract) return false;
      const topics = event.body().v0().topics().map(scValToNative);
      return topics.length === 2 && topics[0] === 'SoroswapRouter' && topics[1] === 'swap';
    });
    if (candidates.length !== 1) return undefined;
    const dataValue = candidates[0]!.body().v0().data();
    if (dataValue.switch().name !== 'scvMap' || dataValue.map()?.length !== 3) return undefined;
    const data = scValToNative(dataValue) as { path?: unknown; amounts?: unknown; to?: unknown };
    if (JSON.stringify(data.path) !== JSON.stringify(path) || data.to !== recipient || !Array.isArray(data.amounts) || data.amounts.length !== 2 || !data.amounts.every((v) => typeof v === 'bigint' && v > 0n)) return undefined;
    const [amountIn, amountOut] = data.amounts as [bigint, bigint];
    if (exactIn ? amountIn !== first || amountOut < second : amountOut !== first || amountIn > second) return undefined;
    const input = parts.movements.filter((m) => m.kind === 'transfer' && m.tokenContract === path[0] && m.from === recipient && m.amount === amountIn);
    const output = parts.movements.filter((m) => m.kind === 'transfer' && m.tokenContract === path[1] && m.to === recipient && m.amount === amountOut);
    if (input.length !== 1 || output.length !== 1 || input[0]!.to !== output[0]!.from || input[0]!.to === recipient || !StrKey.isValidContract(input[0]!.to ?? '')) return undefined;
    return {
      protocol: 'soroswap-compatible', contract: call.contract, codeHash: spec.codeHash,
      path, amounts: [amountIn.toString(), amountOut.toString()], recipient,
      description: `The recorded call and events describe ${recipient} exchanging ${stellarAmount(amountIn, input[0]!.asset)} for ${stellarAmount(amountOut, output[0]!.asset)} through ${call.contract}.`,
      identity: 'Soroswap-compatible format; the official deployment identity and economic correctness are not established. Execution data is the provider\'s report.',
      source: SOROSWAP_SOURCE,
    };
  } catch { return undefined; }
}
