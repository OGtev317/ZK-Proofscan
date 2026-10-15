import { describe, expect, it } from 'vitest';
import { factLines, plainFacts, type TransactionFacts } from '../src/chain/facts.js';
import { lookupTransaction } from '../src/chain/lookup.js';
import { CHAINS, type RpcClient } from '../src/chain/rpc.js';
import { explain } from '../src/explain.js';
import type { Report } from '../src/report.js';
import { recordedKeyText } from '../src/node/bundled.js';

const HASH = `0x${'5a'.repeat(32)}`;
const BLOCK = `0x${'b1'.repeat(32)}`;
const FROM = `0x${'11'.repeat(20)}`;
const TO = `0x${'22'.repeat(20)}`;
const sepolia = CHAINS.find((chain) => chain.name === 'sepolia')!;
const polygon = CHAINS.find((chain) => chain.name === 'polygon')!;

/** A provider that knows one transaction, with any field replaced. */
const fake = (transaction: Record<string, unknown>, status = '0x1', chainId = '0xaa36a7'): RpcClient => ({
  provider: 'provider.example',
  call: async (method) =>
    ({
      eth_chainId: chainId,
      eth_getTransactionByHash: { hash: HASH, blockHash: BLOCK, blockNumber: '0x10', from: FROM, to: TO, input: '0x', value: '0x0', ...transaction },
      eth_getTransactionReceipt: { blockHash: BLOCK, status },
    })[method],
});
const facts = async (transaction: Record<string, unknown>, status?: string, chain = sepolia, chainId?: string): Promise<TransactionFacts | undefined> => {
  const found = await lookupTransaction({ chain, transaction: HASH, rpc: fake(transaction, status, chainId), keyText: recordedKeyText });
  return found.found ? undefined : found.facts;
};

describe('what an ordinary transaction was', () => {
  it('describes transfers, calls and contract creation on an Ethereum chain', async () => {
    expect(await facts({ value: '0xde0b6b3a7640000' })).toMatchObject({ action: `a transfer of 1 ETH to ${TO}`, status: 'succeeded', from: FROM, to: TO, position: 16 });
    expect(await facts({ value: '0x6f05b59d3b20000' })).toMatchObject({ action: `a transfer of 0.5 ETH to ${TO}` });
    expect(await facts({ input: '0xa9059cbb' + '00'.repeat(64) })).toMatchObject({ action: `a call to transfer on contract ${TO}` });
    expect(await facts({ input: '0x12345678' + '00'.repeat(64) })).toMatchObject({ action: `a call to contract ${TO}, function 0x12345678` });
    expect(await facts({ to: null, input: '0x6080' })).toMatchObject({ action: 'the creation of a contract' });
    expect((await facts({ to: null, input: '0x6080' }))?.to).toBeUndefined();
    expect(await facts({ value: '0x1' }, '0x0')).toMatchObject({ action: `a transfer of 0 ETH to ${TO}`, status: 'reverted' });
    expect(await facts({ value: '0xde0b6b3a7640000' }, '0x1', polygon, '0x89')).toMatchObject({ action: `a transfer of 1 POL to ${TO}` });
  });

  it('says plainly that there is no proof to check, and what the provider reported', () => {
    const transfer: TransactionFacts = { family: 'ethereum', provider: 'sepolia.drpc.org', network: 'sepolia', transaction: HASH, position: 16, status: 'succeeded', from: FROM, action: `a transfer of 1 ETH to ${TO}`, to: TO };
    expect(plainFacts(transfer)).toBe(`This is a transaction on Ethereum Sepolia (a test network): a transfer of 1 ETH to ${TO}. According to sepolia.drpc.org, the network accepted it. No zero-knowledge proof that this tool can read was found in it, so there is no proof to check.`);
    expect(factLines(transfer).map(([label]) => label)).toEqual(['Network', 'Transaction', 'Block', 'Status', 'Sent by', 'What it did', 'To']);
    const explained = explain({ facts: transfer });
    expect(explained).toMatchObject({ status: { text: 'Succeeded' }, proofCheck: { text: 'No supported proof found', tone: 'caution' }, unknown: [] });
  });
});

describe('the reader\'s view of a result', () => {
  const base = { reportVersion: 3, tool: { name: 'zk-proofscan', version: '0.0.0' }, input: { sha256: '0' } };
  const both = { name: 'snarkjs', version: '0.7.6', alsoCheckedBy: { name: 'ark-groth16', version: '0.6.0' } };
  const recognised = (status: string) => ({ match: 'exact', artifact: { description: 'A recorded key', circuitLink: { status, note: 'Made with no trusted ceremony.' } } });
  const valid = (keyRecognition: unknown, verifier: unknown = both) =>
    ({ ...base, outcome: 'valid', basis: 'supplied-key', claim: 'c', hidden: [], publicInputs: [], verification: { result: 'passed', verifier }, keyRecognition, explanation: { review: { status: 'unreviewed', note: '' } }, limits: ['A limit.'], assumptions: [] }) as unknown as Report;

  it('puts a key\'s caveat first among what remains unknown, and names both verifiers', () => {
    const view = explain({ report: valid(recognised('unconfirmed')) });
    expect(view.proofCheck).toEqual({ text: 'Passed: two independent verifiers agree', tone: 'pass' });
    expect(view.proves[0]).toBe('The proof fits a key this tool has on record: A recorded key.');
    expect(view.unknown).toEqual(['About the key: Made with no trusted ceremony.', 'A limit.', 'The explanation wording has not been reviewed by a qualified person.']);
    expect(view.status).toBeUndefined();
    expect(explain({ report: valid(recognised('established')) }).unknown[0]).toBe('A limit.');
    expect(explain({ report: valid({ match: 'none' }, { name: 'snarkjs', version: '0.7.6' }) }).proofCheck.text).toBe('Passed');
  });

  it('never shows a pass for a proof that was rejected or not checked', () => {
    const failed = explain({ report: { ...base, outcome: 'invalid', basis: 'bundled-circuit', public: [], verification: { result: 'failed', verifier: both, verificationKeysSha256: '0' } } as unknown as Report });
    expect(failed.proofCheck).toEqual({ text: 'Failed: the verifier rejected the proof', tone: 'fail' });
    expect(failed.proves).toEqual(['Nothing. A rejected proof establishes nothing.']);
    const unchecked = explain({ report: { ...base, outcome: 'unsupported', reason: 'no' } as unknown as Report });
    expect(unchecked).toMatchObject({ proofCheck: { text: 'Not checked' }, proves: ['Nothing was checked.'], unknown: ['Whether the proof is valid.'] });
  });
});

describe('a saved example\'s recorded answers', () => {
  it('answers only what was recorded, by method and by ledger key, and refuses the rest', async () => {
    const { recordedRpc } = await import('../src/chain/recorded.js');
    const rpc = recordedRpc({ getNetwork: { passphrase: 'p' }, getLedgerEntries: { keyA: { entries: [] } } }, 'soroban-testnet.stellar.org');
    expect(rpc.provider).toBe('soroban-testnet.stellar.org');
    expect(await rpc.call('getNetwork', {})).toEqual({ passphrase: 'p' });
    expect(await rpc.call('getLedgerEntries', { keys: ['keyA'] })).toEqual({ entries: [] });
    await expect(rpc.call('getLedgerEntries', { keys: ['keyB'] })).rejects.toThrow('the saved example holds no answer for this request');
    await expect(rpc.call('getTransaction', { hash: 'x' })).rejects.toThrow('the saved example holds no answer for this request');
  });
});

describe('token movements and permissions', async () => {
  const { describeTokenEvent, labelTokens, readTokenEvents } = await import('../src/chain/tokens.js');
  const { keccak_256 } = await import('@noble/hashes/sha3.js');
  const topic = (signature: string): string => `0x${Buffer.from(keccak_256(new TextEncoder().encode(signature))).toString('hex')}`;
  const word = (value: bigint | string): string => `0x${BigInt(value).toString(16).padStart(64, '0')}`;
  const TOKEN = `0x${'aa'.repeat(20)}`;
  const A = `0x${'0a'.repeat(20)}`;
  const B = `0x${'0b'.repeat(20)}`;
  const log = (signature: string, indexed: string[], data: string) => ({ address: TOKEN.toUpperCase().replace('0X', '0x'), topics: [topic(signature), ...indexed], data });
  const MAX = (1n << 256n) - 1n;

  it('reads the standard events, and only those', () => {
    const { events } = readTokenEvents([
      log('Transfer(address,address,uint256)', [word(A), word(B)], word(25n * 10n ** 6n)),
      log('Transfer(address,address,uint256)', [word(A), word(B), word(7n)], '0x'),
      log('Approval(address,address,uint256)', [word(A), word(B)], word(MAX)),
      log('Approval(address,address,uint256)', [word(A), word(B)], word(5n)),
      log('ApprovalForAll(address,address,bool)', [word(A), word(B)], word(1n)),
      log('Swap(address,uint256)', [word(A)], word(1n)),
      log('Transfer(address,address,uint256)', [word(`0x${'ff'.repeat(32)}`), word(B)], word(1n)),
      { address: 'not an address', topics: [], data: '0x' },
    ]);
    expect(events).toEqual([
      { kind: 'transfer', token: TOKEN, from: A, to: B, amount: '25000000' },
      { kind: 'nft-transfer', token: TOKEN, from: A, to: B, tokenId: '7' },
      { kind: 'approval', token: TOKEN, owner: A, spender: B, amount: MAX.toString(), unlimited: true },
      { kind: 'approval', token: TOKEN, owner: A, spender: B, amount: '5', unlimited: false },
      { kind: 'approval-for-all', token: TOKEN, owner: A, operator: B, approved: true },
    ]);
    expect(readTokenEvents(Array.from({ length: 25 }, () => log('Transfer(address,address,uint256)', [word(A), word(B)], word(1n))))).toMatchObject({ more: true });
    expect(readTokenEvents('nonsense')).toEqual({ events: [], more: false });
  });

  it('names a token only by what its contract claims, and only if the claim is short, plain text', async () => {
    const abiString = (text: string): string => `0x${word(32n).slice(2)}${word(BigInt(text.length)).slice(2)}${Buffer.from(text).toString('hex').padEnd(64, '0')}`;
    const answers: Record<string, unknown> = { '0x95d89b41': abiString('USDC'), '0x313ce567': word(6n) };
    const rpc = { provider: 'p', call: async (_method: string, params: unknown) => answers[((params as [{ data: string }])[0]).data] };
    const labels = await labelTokens(rpc, [TOKEN]);
    expect(labels).toEqual({ [TOKEN]: { symbol: 'USDC', decimals: 6 } });
    const transfer = { kind: 'transfer' as const, token: TOKEN, from: A, to: B, amount: '25500000' };
    expect(describeTokenEvent(transfer, labels)).toBe(`moved 25.5 of a token calling itself USDC (${TOKEN}) from ${A} to ${B}`);
    expect(describeTokenEvent(transfer, {})).toBe(`moved 25500000 of the smallest units of the token at ${TOKEN} from ${A} to ${B}`);
    expect(describeTokenEvent({ kind: 'approval', token: TOKEN, owner: A, spender: B, amount: MAX.toString(), unlimited: true }, labels)).toContain('UNLIMITED amount of a token calling itself USDC');
    for (const bad of [abiString('<script>'), abiString('x'.repeat(40)), '0x1234', 42]) {
      answers['0x95d89b41'] = bad;
      expect((await labelTokens(rpc, [TOKEN]))[TOKEN]?.symbol, String(bad)).toBeUndefined();
    }
    // A 32-byte name, as some older tokens write it.
    answers['0x95d89b41'] = `0x${Buffer.from('MKR').toString('hex').padEnd(64, '0')}`;
    expect((await labelTokens(rpc, [TOKEN]))[TOKEN]?.symbol).toBe('MKR');
    // A token that does not answer is described by its address.
    const silent = { provider: 'p', call: async () => Promise.reject(new Error('no')) };
    expect(await labelTokens(silent, [TOKEN])).toEqual({ [TOKEN]: {} });
  });
});
