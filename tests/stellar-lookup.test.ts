import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { RpcError, type RpcClient } from '../src/chain/rpc.js';
import { readChainSource, renderChainSource, type StellarSource } from '../src/chain/source.js';
import { lookupStellarTransaction, STELLAR_BASE_VERSION, STELLAR_NETWORKS } from '../src/chain/stellar.js';
import { rerunExport, writeExport } from '../src/export.js';
import { binaryBytes } from '../src/inputs.js';
import { bundledScanning } from '../src/node/bundled.js';
import { lookupAndCheck } from '../src/node/run.js';
import { stellarPrivatePaymentsKeys } from '../src/node/bundled.js';
import { stopEngines } from '../src/node/stop.js';
import { renderReport } from '../src/report.js';
import { scan } from '../src/scan.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const recorded = JSON.parse(readFileSync(join(root, 'tests/fixtures/stellar-testnet/answers.json'), 'utf8')) as Record<string, Record<string, unknown>>;
const HASH = '10dd8ab5bcfbc8395030144cdfc5cb200ce61d38e7fad533e18e3aee89bbb3b2';
const CONTRACT = 'CAXUVZHJNVW7BDZUOYYEDHAVSHPM5HSPRX74BZUCJ4DVHDHKKJMHKOOJ';
const testnet = STELLAR_NETWORKS.find((network) => network.name === 'stellar-testnet')!;
const scanning = await bundledScanning();
afterAll(stopEngines);

type Answers = Record<string, unknown>;
const answers = (change: Answers = {}): Answers => ({ getNetwork: recorded.getNetwork, getTransaction: recorded.getTransaction, getLedgerEntries: recorded.getLedgerEntries, ...change });
/** A recorded answer for each request; `getLedgerEntries` may be recorded per key asked for. */
const reply = (all: Answers, method: string, params: unknown): unknown => {
  const answer = all[method] as Record<string, unknown> | undefined;
  if (method !== 'getLedgerEntries' || answer === undefined || 'entries' in answer) return answer;
  return answer[(params as { keys: string[] }).keys[0]!] ?? { entries: [], latestLedger: 1 };
};
const fake = (change: Answers = {}, asked: string[] = []): RpcClient => ({
  provider: 'provider.example',
  call: async (method, params) => {
    asked.push(method);
    return reply(answers(change), method, params);
  },
});
const find = (change: Answers = {}, transaction = HASH) => lookupStellarTransaction({ network: testnet, transaction, rpc: fake(change), recordedKeys: stellarPrivatePaymentsKeys });
const entryWith = (change: Record<string, unknown>) => ({ ...recorded.getLedgerEntries, entries: [{ ...(recorded.getLedgerEntries!.entries as Record<string, unknown>[])[0], ...change }] });

describe('reading a proof out of a Stellar transaction', () => {
  it('pins the library that reads Stellar transactions', () => {
    expect(JSON.parse(readFileSync(join(root, 'node_modules/@stellar/stellar-base/package.json'), 'utf8')).version).toBe(STELLAR_BASE_VERSION);
  });

  it('finds a real testnet proof and the key its contract holds, and checks it here', async () => {
    const asked: string[] = [];
    const found = await lookupStellarTransaction({ network: testnet, transaction: HASH.toUpperCase(), rpc: fake({}, asked), recordedKeys: stellarPrivatePaymentsKeys });
    if (!found.found) throw new Error(found.reason);
    // Three reads and nothing else.
    expect(asked).toEqual(['getNetwork', 'getTransaction', 'getLedgerEntries']);
    expect(binaryBytes(found.inputs.proof)?.length).toBe(14592);
    expect(binaryBytes(found.inputs.verificationKey!)?.length).toBe(1760);
    expect(binaryBytes(found.inputs.publicInputs!)).toEqual(Uint8Array.from({ length: 32 }, (_, i) => (i === 31 ? 2 : 0)));
    expect(found.source).toEqual({
      kind: 'stellar-transaction', provider: 'provider.example', network: 'stellar-testnet', transaction: HASH, ledger: 5184196, contract: CONTRACT,
      contractCode: '60de4e6d5bbf3bdd7fe97f30249bedf296ae52a767ac6c7e33c26ac8f8c896fe', status: 'succeeded', call: 'nethermind-ultrahonk.verify-proof',
      keyFrom: 'storage', keyContract: CONTRACT, keyContractCode: '60de4e6d5bbf3bdd7fe97f30249bedf296ae52a767ac6c7e33c26ac8f8c896fe', keyLastChanged: 5184194,
    });
    const report = await scan(found.inputs, scanning);
    if (report.outcome !== 'valid') throw new Error(JSON.stringify(report).slice(0, 300));
    expect(report.verification).toMatchObject({ result: 'passed', verifier: { name: '@aztec/bb.js', version: '0.87.0' }, proofSystem: { variant: 'keccak' } });
    const text = renderChainSource(found.source);
    for (const line of ['as reported by provider.example and not checked by this tool', `Called contract ${CONTRACT}`, 'This tool has no record of Stellar deployments.', `Verification key read from the storage of contract ${CONTRACT}`, 'What decides that key last changed at ledger 5184194: before the transaction, so it is the key used when the transaction ran', 'The network accepted the transaction.']) {
      expect(text).toContain(line);
    }
  }, 120_000);

  it('keeps the network\'s decision apart from its own check, and says when the key may have changed', async () => {
    const failed = await find({ getTransaction: { ...recorded.getTransaction, status: 'FAILED' } });
    if (!failed.found) throw new Error(failed.reason);
    expect(failed.source).toMatchObject({ status: 'failed' });
    expect(renderChainSource(failed.source)).toContain('The network FAILED the transaction.');
    expect((await scan(failed.inputs, scanning)).outcome).toBe('valid');
    for (const changedAt of [5184196, 5184197]) {
      const later = await find({ getLedgerEntries: entryWith({ lastModifiedLedgerSeq: changedAt }) });
      if (!later.found) throw new Error(later.reason);
      expect(renderChainSource(later.source)).toContain('NOT before the transaction, so it may not be the key used when the transaction ran');
    }
  }, 120_000);

  it('declines, without calling anything invalid, when there is no proof to read', async () => {
    const reasons = async (change: Answers, transaction = HASH) => {
      const found = await find(change, transaction);
      return found.found ? 'found' : found.reason;
    };
    expect(await reasons({}, `0x${HASH}`)).toBe('a Stellar transaction is named by 64 hex digits');
    expect(await reasons({}, 'abc')).toBe('a Stellar transaction is named by 64 hex digits');
    expect(await reasons({ getNetwork: { passphrase: 'Public Global Stellar Network ; September 2015' } })).toBe('the provider is not serving stellar-testnet');
    expect(await reasons({ getTransaction: { status: 'NOT_FOUND' } })).toContain('a public Stellar RPC keeps only about the last week');
    expect(await reasons({ getLedgerEntries: { entries: [], latestLedger: 1 } })).toContain('holds no storage for the contract');
  });

  it('stops when the provider\'s answers do not fit together', async () => {
    // The hash is computed from the transaction sent, so a provider cannot answer about another one.
    await expect(find({}, 'ab'.repeat(32))).rejects.toThrow(RpcError);
    await expect(find({}, 'ab'.repeat(32))).rejects.toThrow('the provider answered about a different transaction');
    await expect(find({ getTransaction: { ...recorded.getTransaction, envelopeXdr: 'AAAA' } })).rejects.toThrow('cannot be read');
    await expect(find({ getTransaction: { ...recorded.getTransaction, status: 'PENDING' } })).rejects.toThrow(RpcError);
    await expect(find({ getTransaction: { ...recorded.getTransaction, ledger: -1 } })).rejects.toThrow(RpcError);
    await expect(find({ getLedgerEntries: entryWith({ key: 'AAAA' }) })).rejects.toThrow(RpcError);
    await expect(find({ getLedgerEntries: entryWith({ xdr: 'AAAA' }) })).rejects.toThrow(RpcError);
    await expect(find({ getLedgerEntries: { entries: [{}, {}] } })).rejects.toThrow(RpcError);
  });
});

describe('reading a Stellar Private Payments pool transaction', () => {
  const pool = JSON.parse(readFileSync(join(root, 'tests/fixtures/stellar-testnet/private-payments/answers.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const POOL_HASH = 'cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc';
  const VERIFIER = 'CA66PGQD3OUO5R64CMOWL3FIRAQTWORLX36ZERALPPYOJ4ORETGFO3P5';
  const poolAnswers = (change: Answers = {}): Answers => ({ getNetwork: pool.getNetwork, getTransaction: pool.getTransaction, getLedgerEntries: pool.getLedgerEntries, ...change });
  const lookUp = (change: Answers = {}, recordedKeys = stellarPrivatePaymentsKeys, asked: string[] = []) =>
    lookupStellarTransaction({ network: testnet, transaction: POOL_HASH, rpc: { provider: 'provider.example', call: async (method, params) => (asked.push(method), reply(poolAnswers(change), method, params)) }, recordedKeys });
  /** The recorded storage answers with one entry's last-changed ledger replaced. */
  const entries = (change: (entry: Record<string, unknown>, at: number) => Record<string, unknown>): Record<string, unknown> =>
    Object.fromEntries(Object.entries(pool.getLedgerEntries!).map(([key, answer], at) => [key, { ...(answer as object), entries: ((answer as { entries: Record<string, unknown>[] }).entries).map((entry) => change(entry, at)) }]));

  it('finds a real pool proof, finds its recorded key in the verifier\'s code, and checks it here', async () => {
    const asked: string[] = [];
    const found = await lookUp({}, stellarPrivatePaymentsKeys, asked);
    if (!found.found) throw new Error(found.reason);
    // The pool's storage, its verifier's storage, and the verifier's code.
    expect(asked).toEqual(['getNetwork', 'getTransaction', 'getLedgerEntries', 'getLedgerEntries', 'getLedgerEntries']);
    expect(found.source).toMatchObject({ call: 'stellar-private-payments.transact', keyFrom: 'code', keyContract: VERIFIER, keyContractCode: 'ac1c1a38199f5bfdbd4a56109ebdc99977d11343198b0ee511d3eca24ef15ace', keyLastChanged: 5190087, ledger: 5190131, status: 'succeeded' });
    // Nine public inputs, in the pool's order, for its blocklist policy: the non-membership root twice at the end.
    expect(JSON.parse(found.inputs.publicInputs!)).toHaveLength(9);
    expect(found.inputs.verificationKey).toBe(readFileSync(join(root, 'artifacts/stellar-private-payments/policy_tx_2_2_B_vk.json'), 'utf8'));
    const report = await scan(found.inputs, scanning);
    if (report.outcome !== 'valid') throw new Error(JSON.stringify(report).slice(0, 300));
    const text = renderReport(report);
    expect(text).toContain('Recognised: an exact match to a recorded key (Stellar Private Payments (Nethermind), testnet key. Pool transaction with two inputs and two outputs, blocklist;');
    expect(text).toContain('Circuit the publisher names: policy_tx_2_2_B,');
    expect(text).toContain('no trusted ceremony');
    expect(renderChainSource(found.source)).toContain(`every point of which appears in the code of ${VERIFIER}`);
    expect(renderChainSource(found.source)).toContain('This tool did not check that the code uses those points');
  }, 120_000);

  it('uses no key that is not in the verifier\'s code', async () => {
    const others = async () => (await stellarPrivatePaymentsKeys()).filter((key) => !key.artifactId.endsWith('policy-tx-2-2-b'));
    const found = await lookUp({}, others);
    expect(found).toEqual({ found: false, reason: 'no recorded Stellar Private Payments key, with this many public inputs, is in the code of the pool\'s verifier contract' });
  });

  it('refuses verifier code that does not match its hash', async () => {
    const swapped = entries((entry) => {
      const text = String(entry.xdr);
      // Only the code entry is long; flip one of its characters well inside the code.
      return text.length > 4000 ? { ...entry, xdr: `${text.slice(0, 3000)}${text[3000] === 'A' ? 'B' : 'A'}${text.slice(3001)}` } : entry;
    });
    await expect(lookUp({ getLedgerEntries: swapped })).rejects.toThrow(RpcError);
  });

  it('says when the pool or its verifier changed after the transaction', async () => {
    const found = await lookUp({ getLedgerEntries: entries((entry, at) => (at === 0 ? { ...entry, lastModifiedLedgerSeq: 5190131 } : entry)) });
    if (!found.found) throw new Error(found.reason);
    expect(found.source).toMatchObject({ keyLastChanged: 5190131 });
    expect(renderChainSource(found.source)).toContain('NOT before the transaction');
  });
});

describe('the recorded source of a Stellar lookup', () => {
  const source: StellarSource = {
    kind: 'stellar-transaction', provider: 'soroban-testnet.stellar.org', network: 'stellar-testnet', transaction: HASH, ledger: 5184196, contract: CONTRACT,
    contractCode: '60de4e6d5bbf3bdd7fe97f30249bedf296ae52a767ac6c7e33c26ac8f8c896fe', status: 'succeeded', call: 'nethermind-ultrahonk.verify-proof',
    keyFrom: 'storage', keyContract: CONTRACT, keyContractCode: '60de4e6d5bbf3bdd7fe97f30249bedf296ae52a767ac6c7e33c26ac8f8c896fe', keyLastChanged: 5184194,
  };

  it('is read from an export only in exactly its own shape', () => {
    expect(readChainSource(source)).toEqual(source);
    for (const broken of [{ ...source, extra: 1 }, { ...source, keyFrom: 'memory' }, { ...source, keyContract: 'nope' }, { ...source, contract: 'GABC' }, { ...source, transaction: `0x${HASH}` }, { ...source, status: 'reverted' }, { ...source, ledger: -1 }, { ...source, call: '<b>' }]) {
      expect(readChainSource(broken), JSON.stringify(broken)).toBeUndefined();
    }
  });

  it('travels with an export and is marked as unchecked on rerun', async () => {
    const found = await find();
    if (!found.found) throw new Error(found.reason);
    const report = await scan(found.inputs, scanning);
    const rerun = await rerunExport(writeExport(found.inputs, report, found.source), (inputs) => scan(inputs, scanning));
    expect(rerun).toMatchObject({ reproduced: true, source: found.source });
    expect(renderChainSource(found.source, true)).toMatch(/^Source recorded in the export \(not checked by this rerun/);
  }, 120_000);
});

describe('looking up on Stellar from the command line', () => {
  let server: Server | undefined;
  afterAll(() => server?.close());

  it('uses the operator\'s Stellar RPC if one is named, and checks, exports and reruns', async () => {
    const asked: string[] = [];
    server = createServer((request, response) => {
      let body = '';
      request.on('data', (chunk) => (body += chunk));
      request.on('end', () => {
        const { id, method } = JSON.parse(body) as { id: number; method: string };
        asked.push(method);
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ jsonrpc: '2.0', id, result: answers()[method] }));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const address = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
    const dir = mkdtempSync(join(tmpdir(), 'zk-proofscan-stellar-'));
    const run = (...args: string[]): Promise<{ status: number | null; stdout: string }> =>
      new Promise((resolve) => {
        const child = spawn(process.execPath, [join(root, 'dist/cli.js'), ...args], { env: { ...process.env, STELLAR_RPC_URL: address } });
        let stdout = '';
        child.stdout.on('data', (chunk) => (stdout += chunk));
        child.on('close', (status) => resolve({ status, stdout }));
      });
    const exported = join(dir, 'evidence.json');
    const done = await run('lookup', HASH, '--chain', 'stellar-testnet', '--export', exported);
    expect(done.status).toBe(0);
    expect(done.stdout).toMatch(/^Source, as reported by 127\.0\.0\.1 and not checked by this tool:/);
    expect(done.stdout).toContain('PASSED using @aztec/bb.js 0.87.0');
    expect(asked).toEqual(['getNetwork', 'getTransaction', 'getLedgerEntries']);
    const rerun = await run('rerun', exported);
    expect(rerun.status).toBe(0);
    expect(rerun.stdout).toContain('Source recorded in the export');
    // An Ethereum chain name is still refused without its own provider, and Stellar mainnet is not offered.
    expect((await run('lookup', HASH, '--chain', 'stellar-mainnet')).stdout).toContain('the chain must be one of');
  }, 180_000);

  it('offers stellar-testnet through the same lookup, refusing unknown names', async () => {
    const result = await lookupAndCheck('stellar-pubnet', HASH, {});
    expect(result).toMatchObject({ kind: 'not-checked' });
    expect(result.kind === 'not-checked' && result.reason).toContain('stellar-testnet');
  });
});
