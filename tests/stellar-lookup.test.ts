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
    expect(found).toMatchObject({ found: false, reason: 'no recorded Stellar Private Payments key, with this many public inputs, is in the code of the pool\'s verifier contract' });
    // What the transaction was is still said.
    expect(found).toMatchObject({ facts: { family: 'stellar', network: 'stellar-testnet', status: 'succeeded', action: 'a call to transact on contract CA73PEBSX2GXZSMMVL46PTCXY424AIMPXKI7WWUMYJXV22AVY2DXC6DQ' } });
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
    // A network this tool does not read is refused by name.
    expect((await run('lookup', HASH, '--chain', 'stellar-futurenet')).stdout).toContain('the chain must be one of');
  }, 180_000);

  it('reads the main network only through an RPC the operator names', async () => {
    const mainnet = STELLAR_NETWORKS.find((network) => network.name === 'stellar-mainnet')!;
    expect(mainnet.defaultRpc).toBeUndefined();
    expect(await lookupAndCheck('stellar-mainnet', HASH, {})).toEqual({ kind: 'not-checked', reason: 'no RPC is configured for stellar-mainnet; set STELLAR_MAINNET_RPC_URL in the environment to the RPC you choose' });
    // A test network RPC named as the main network is caught by its passphrase.
    const testnetAnswers = await lookupStellarTransaction({ network: mainnet, transaction: HASH, rpc: fake(), recordedKeys: stellarPrivatePaymentsKeys });
    expect(testnetAnswers).toEqual({ found: false, reason: 'the provider is not serving stellar-mainnet' });
    // A provider that claims the main network but sends a test network transaction: its hash under the main network's passphrase is not the one asked for.
    const claiming = fake({ getNetwork: { passphrase: mainnet.passphrase } });
    await expect(lookupStellarTransaction({ network: mainnet, transaction: HASH, rpc: claiming, recordedKeys: stellarPrivatePaymentsKeys })).rejects.toThrow('the provider answered about a different transaction');
  });

  it('offers stellar-testnet through the same lookup, refusing unknown names', async () => {
    const result = await lookupAndCheck('stellar-pubnet', HASH, {});
    expect(result).toMatchObject({ kind: 'not-checked' });
    expect(result.kind === 'not-checked' && result.reason).toContain('stellar-testnet');
  });
});

describe('an issued Stellar asset', async () => {
  const { recordedRpc } = await import('../src/chain/recorded.js');
  const { stellarTomlCheck } = await import('../src/chain/stellar-assets.js');
  const payment = JSON.parse(readFileSync(join(root, 'tests/fixtures/stellar-mainnet/usdc-payment.json'), 'utf8')) as Record<string, unknown>;
  const mainnet = STELLAR_NETWORKS.find((network) => network.name === 'stellar-mainnet')!;
  const PAYMENT = '2316f304739d2304c481296efd03012b5f8e8b375afdafcfe00363ffcf50ba25';
  const ISSUER = 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN';
  const describe_ = async (assetInfo?: Parameters<typeof lookupStellarTransaction>[0]['assetInfo']) => {
    const found = await lookupStellarTransaction({ network: mainnet, transaction: PAYMENT, rpc: recordedRpc(payment, 'mainnet.sorobanrpc.com'), recordedKeys: stellarPrivatePaymentsKeys, ...(assetInfo === undefined ? {} : { assetInfo }) });
    if (found.found || found.facts === undefined) throw new Error('expected facts');
    return found.facts.action;
  };

  it('names the issuer and the home domain its account declares, and checks it only when asked', async () => {
    expect(await describe_()).toBe(`a payment of 10 USDC issued by ${ISSUER}, whose account names circle.com as its home domain (not checked against that domain's stellar.toml)`);
    expect(await describe_(async () => ({ confirmed: true, name: 'USD Coin' }))).toBe(`a payment of 10 USDC issued by ${ISSUER}, whose account names circle.com as its home domain; that domain's stellar.toml lists this asset and issuer, naming it "USD Coin"`);
    expect(await describe_(async () => ({ confirmed: false }))).toContain('does not list this asset and issuer, so the link is not confirmed');
    expect(await describe_(async () => ({ confirmed: false, missing: true }))).toContain('that domain publishes no stellar.toml, so the link is not confirmed');
    // A checker that fails leaves the claim unchecked rather than the lookup broken.
    expect(await describe_(async () => Promise.reject(new Error('down')))).toContain('(not checked against');
  });

  it('confirms an asset only when the file lists that code with that issuer, and reads no other domain', async () => {
    const real = globalThis.fetch;
    const asked: string[] = [];
    const serve = (body: string, status = 200, url = 'https://example.org/.well-known/stellar.toml') => (async (address: string | URL | Request) => {
      asked.push(String(address));
      const response = new Response(body, { status });
      Object.defineProperty(response, 'url', { value: url });
      return response;
    }) as typeof fetch;
    const file = `[[CURRENCIES]]\ncode = "USDC"\nissuer = "${ISSUER}"\nname = "USD Coin"\n\n[[CURRENCIES]]\ncode = "EURC"\nissuer = "GOTHER"\nname = "<script>"\n`;
    try {
      globalThis.fetch = serve(file);
      const check = stellarTomlCheck();
      expect(await check('example.org', 'USDC', ISSUER)).toEqual({ confirmed: true, name: 'USD Coin' });
      expect(asked).toEqual(['https://example.org/.well-known/stellar.toml']);
      expect(await check('example.org', 'USDC', 'GSOMEONEELSE')).toEqual({ confirmed: false });
      // A listed name that is not plain text is not repeated.
      expect(await check('example.org', 'EURC', 'GOTHER')).toEqual({ confirmed: true });
      globalThis.fetch = serve('', 404, 'https://www.example.org/.well-known/stellar.toml');
      expect(await check('example.org', 'USDC', ISSUER)).toEqual({ confirmed: false, missing: true });
      // A redirect to another domain is not that domain's file.
      globalThis.fetch = serve(file, 200, 'https://elsewhere.example/.well-known/stellar.toml');
      expect(await check('example.org', 'USDC', ISSUER)).toBeUndefined();
      globalThis.fetch = serve('not = [ toml');
      expect(await check('example.org', 'USDC', ISSUER)).toBeUndefined();
      asked.length = 0;
      for (const domain of ['localhost', '127.0.0.1', 'a b.com', 'x'.repeat(300)]) expect(await check(domain, 'USDC', ISSUER)).toBeUndefined();
      expect(asked).toEqual([]);
    } finally {
      globalThis.fetch = real;
    }
  });
});
