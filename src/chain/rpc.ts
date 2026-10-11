/** One JSON-RPC request to a chain data provider. */
export interface RpcClient {
  /** Host name only, for reports. */
  provider: string;
  call(method: string, params: unknown[]): Promise<unknown>;
}

export class RpcError extends Error {}

export interface Chain {
  name: string;
  chainId: number;
  /** Alchemy's network name, used when only an Alchemy key is configured. */
  alchemy: string;
}

export const CHAINS: readonly Chain[] = [
  { name: 'ethereum', chainId: 1, alchemy: 'eth-mainnet' },
  { name: 'sepolia', chainId: 11155111, alchemy: 'eth-sepolia' },
  { name: 'base', chainId: 8453, alchemy: 'base-mainnet' },
  { name: 'base-sepolia', chainId: 84532, alchemy: 'base-sepolia' },
  { name: 'optimism', chainId: 10, alchemy: 'opt-mainnet' },
  { name: 'arbitrum', chainId: 42161, alchemy: 'arb-mainnet' },
  { name: 'polygon', chainId: 137, alchemy: 'polygon-mainnet' },
];

const MAX_RESPONSE_BYTES = 2_097_152;
const TIMEOUT_MS = 20_000;

/**
 * The provider address comes from the operator's environment only, never
 * from a command-line argument, a file being checked or an AI agent.
 * `ZK_PROOFSCAN_RPC_URL` is used as given; otherwise `ALCHEMY_API_KEY`
 * selects Alchemy's endpoint for the chain.
 */
export function rpcUrlFromEnvironment(chain: Chain, env: Record<string, string | undefined>): string | undefined {
  const direct = env.ZK_PROOFSCAN_RPC_URL;
  if (direct !== undefined && direct !== '') return direct;
  const key = env.ALCHEMY_API_KEY;
  if (key !== undefined && /^[A-Za-z0-9_-]{8,128}$/.test(key)) return `https://${chain.alchemy}.g.alchemy.com/v2/${key}`;
  return undefined;
}

/**
 * A read-only JSON-RPC client over HTTPS. Errors never include the address,
 * because it usually holds an API key.
 */
export function httpRpc(address: string): RpcClient {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new RpcError('the configured provider address is not a URL');
  }
  const local = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new RpcError('the provider address must use https');
  let id = 0;
  return {
    provider: url.hostname,
    async call(method, params) {
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        throw new RpcError('the provider could not be reached');
      }
      if (!response.ok) throw new RpcError(`the provider answered with HTTP status ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_RESPONSE_BYTES) throw new RpcError('the provider sent more data than a transaction needs');
      let parsed: unknown;
      try {
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
      } catch {
        throw new RpcError('the provider did not answer with JSON');
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new RpcError('the provider did not answer with a JSON-RPC reply');
      const reply = parsed as Record<string, unknown>;
      // The provider's own error text is not repeated: it is outside text that would be printed.
      if ('error' in reply) throw new RpcError('the provider reported an error for this request');
      if (!('result' in reply)) throw new RpcError('the provider did not answer with a JSON-RPC reply');
      return reply.result;
    },
  };
}
