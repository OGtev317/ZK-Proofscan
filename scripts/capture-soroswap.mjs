// Read-only capture of one public transaction; no accounts, signing or submission.
import { writeFile } from 'node:fs/promises';
import { httpRpc } from '../dist/chain/rpc.js';
import { lookupStellarTransaction, STELLAR_NETWORKS } from '../dist/chain/stellar.js';

const hash = '203d14cb109f442a96e26a5bba9a2c5b8aa5770dabe29e0b5f46e310a2003e3a';
const upstream = httpRpc(process.env.STELLAR_MAINNET_RPC_URL || 'https://mainnet.sorobanrpc.com');
const answers = { recorded: new Date().toISOString().slice(0, 10), provider: `https://${upstream.provider}` };
let requests = 0;
const rpc = {
  provider: upstream.provider,
  async call(method, params) {
    if (!['getNetwork', 'getTransaction', 'getLedgerEntries'].includes(method) || ++requests > 30) throw new Error('capture read limit');
    const answer = await upstream.call(method, params);
    if (method === 'getLedgerEntries') {
      answers[method] ??= {};
      answers[method][params.keys[0]] = answer;
    } else answers[method] = answer;
    return answer;
  },
};
const result = await lookupStellarTransaction({ network: STELLAR_NETWORKS[1], transaction: hash, rpc, recordedKeys: async () => [] });
if (result.facts?.swaps?.[0]?.deploymentMatch !== 'published-address-and-code') throw new Error('No supported published-deployment swap; no fixture written.');
await writeFile(new URL('../tests/fixtures/stellar-mainnet/soroswap.json', import.meta.url), `${JSON.stringify(answers, null, 2)}\n`, { flag: 'wx' });
console.log(`Captured one public mainnet swap from ${upstream.provider}; ${requests} read-only requests. No proof, signature or economic guarantee was checked.`);
