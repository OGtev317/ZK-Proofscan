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
    expect(await facts({ input: '0xa9059cbb' + '00'.repeat(64) })).toMatchObject({ action: `a call to contract ${TO}, function 0xa9059cbb` });
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
