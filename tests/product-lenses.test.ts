import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, Address, Asset, Contract, nativeToScVal, Networks, Operation, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { decodeSoroswapSwap } from '../src/chain/swaps.js';
import { inspectStellarTransaction } from '../src/chain/preview.js';
import { providerWindow, withStellarAvailability } from '../src/chain/availability.js';
import { RpcError, type RpcClient } from '../src/chain/rpc.js';
import type { ContractSpec } from '../src/chain/soroban-spec.js';
import type { Movement } from '../src/chain/stellar-activity.js';
import { transactionStory } from '../src/story.js';
import { circuitDirectory, proofProfile, reviewText } from '../src/profiles.js';
import { loadKeyRegistry } from '../src/registry.js';
import { checkText } from '../src/node/run.js';
import { stopEngines } from '../src/node/stop.js';
import type { TransactionFacts } from '../src/chain/facts.js';

const address = (n: number) => StrKey.encodeContract(Buffer.alloc(32, n));
const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const OTHER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const ROUTER = address(1), TOKEN_A = address(2), TOKEN_B = address(3), POOL = address(4);
const scAddress = (text: string) => Address.fromString(text).toScVal();
const amount = (n: bigint) => nativeToScVal(n, { type: 'i128' });
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const envelope = (operation = new Contract(TOKEN_A).call('transfer', scAddress(USER), scAddress(OTHER), amount(10n))) => new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(operation).setTimeout(300).build().toXDR();
const rpc = (reply: Record<string, unknown>, asked: string[] = []): RpcClient => ({ provider: 'rpc.example', async call(method) { asked.push(method); if (!(method in reply)) throw new RpcError('not supported'); return reply[method]; } });
const facts: TransactionFacts = { family: 'stellar', provider: 'rpc.example', network: 'stellar-testnet', transaction: 'a'.repeat(64), position: 100, status: 'succeeded', from: USER, action: 'a transfer', fee: '0.00001 XLM' };
afterAll(stopEngines);

function authEntry(depth = 1): xdr.SorobanAuthorizationEntry {
  const invocation = (remaining: number): xdr.SorobanAuthorizedInvocation => new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(TOKEN_A).toScAddress(), functionName: 'transfer', args: [scAddress(USER), scAddress(OTHER), amount(10n)] })),
    subInvocations: remaining > 1 ? [invocation(remaining - 1)] : [],
  });
  return new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(), rootInvocation: invocation(depth) });
}

function withAuthorization(auth: xdr.SorobanAuthorizationEntry): string {
  const transaction = xdr.TransactionEnvelope.fromXDR(envelope(), 'base64');
  transaction.v1().tx().operations()[0]!.body().invokeHostFunctionOp().auth([auth]);
  return transaction.toXDR('base64');
}

function swapParts() {
  const call = { contract: ROUTER, name: 'swap_exact_tokens_for_tokens', args: [amount(100n), amount(190n), xdr.ScVal.scvVec([scAddress(TOKEN_A), scAddress(TOKEN_B)]), scAddress(USER), nativeToScVal(123456n, { type: 'u64' })] };
  const spec: ContractSpec = { functions: new Map([[call.name, ['amount_in', 'amount_out_min', 'path', 'to', 'deadline']]]), events: [], origin: 'contract interface', meta: {}, codeHash: 'ab'.repeat(32) };
  const event = new xdr.ContractEvent({ ext: new xdr.ExtensionPoint(0), contractId: Buffer.alloc(32, 1) as never, type: xdr.ContractEventType.contract(), body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics: [nativeToScVal('SoroswapRouter'), xdr.ScVal.scvSymbol('swap')], data: nativeToScVal({ amounts: [100n, 200n], path: [Address.fromString(TOKEN_A), Address.fromString(TOKEN_B)], to: Address.fromString(USER) }) })) });
  const movements: Movement[] = [
    { kind: 'transfer', tokenContract: TOKEN_A, asset: { kind: 'contract', contract: TOKEN_A }, from: USER, to: POOL, amount: 100n },
    { kind: 'transfer', tokenContract: TOKEN_B, asset: { kind: 'contract', contract: TOKEN_B }, from: POOL, to: USER, amount: 200n },
  ];
  return { succeeded: true, call, spec, events: [event], movements, truncated: false };
}

describe('transaction stories', () => {
  it('never reports zero permissions for an Ethereum transaction whose facts flag an allowance', () => {
    const allowance = 'allowed 0xbb to spend an UNLIMITED amount of a token calling itself HASH (0xe7802782ac7679b4ff0e7106b3230adfef251688)';
    const story = transactionStory({ family: 'ethereum', provider: 'eth.example', network: 'ethereum', transaction: '0x1', position: 1, status: 'succeeded', from: '0xaa', action: 'a call to approve on contract 0xe7802782ac7679b4ff0e7106b3230adfef251688', tokens: [allowance] });
    expect(story.title).toBe('a call to approve on contract 0xe7802782ac7679b4ff0e7106b3230adfef251688');
    expect(story.permissions).toEqual([allowance]);
    expect(story.notes[0]).toContain('Stellar transactions only');
    expect(JSON.stringify(story)).not.toContain('0 decoded');
  });
  it('keeps effects, fees, permission grants and private-data limits separate', () => {
    const story = transactionStory({ ...facts, movements: [{ kind: 'transfer', asset: { kind: 'native' }, amount: '125000000', from: USER, to: OTHER }, { kind: 'approve', asset: { kind: 'native' }, amount: ((1n << 127n) - 1n).toString(), from: USER, to: OTHER, until: 500 }] });
    expect(story.movements[0]?.label).toContain('12.5 XLM');
    expect(story.permissions[0]).toContain('UNLIMITED');
    expect(story.fee).toBe('0.00001 XLM');
    expect(story.notes.join(' ')).toContain('cannot be reconstructed');
    expect(JSON.stringify(story)).not.toContain('170141183460469231731687303715884105727');
  });
  it('never displays requested transfers as committed after failure', () => {
    const story = transactionStory({ ...facts, status: 'failed', movements: [{ kind: 'transfer', asset: { kind: 'native' }, amount: '10' }] });
    expect(story.movements).toEqual([]);
    expect(story.title).toContain('failed');
  });
  it('does not treat absent/truncated activity as a complete balance', () => {
    expect(transactionStory({ ...facts, moreTokens: true }).notes.join(' ')).toContain('not a complete balance');
    expect(transactionStory(facts).notes.join(' ')).toContain('does not establish that no assets moved');
  });
});

describe('a guarded Soroswap-compatible decoder', () => {
  it('requires call, interface, a matching router event and committed transfers', () => {
    const result = decodeSoroswapSwap(swapParts());
    expect(result).toMatchObject({ protocol: 'soroswap-compatible', amounts: ['100', '200'], recipient: USER });
    expect(result?.identity).toContain('official deployment identity');
  });
  it('supports the exact-output call with the correct limits', () => {
    const parts = swapParts();
    parts.call.name = 'swap_tokens_for_exact_tokens';
    parts.call.args[0] = amount(200n); parts.call.args[1] = amount(110n);
    parts.spec.functions.set(parts.call.name, ['amount_out', 'amount_in_max', 'path', 'to', 'deadline']);
    expect(decodeSoroswapSwap(parts)).toBeDefined();
    parts.call.args[1] = amount(99n);
    expect(decodeSoroswapSwap(parts)).toBeUndefined();
  });
  it.each(['failure', 'truncated', 'no-spec', 'no-event', 'duplicate-event', 'no-transfers', 'wrong-amount', 'wrong-recipient', 'wrong-pool', 'wrong-interface', 'wrong-event-contract', 'wrong-output-limit'])('refuses %s rather than guessing a swap', (kind) => {
    const p = swapParts();
    if (kind === 'failure') p.succeeded = false;
    if (kind === 'truncated') p.truncated = true;
    if (kind === 'no-spec') p.spec.functions.clear();
    if (kind === 'no-event') p.events = [];
    if (kind === 'duplicate-event') p.events.push(p.events[0]!);
    if (kind === 'no-transfers') p.movements = [];
    if (kind === 'wrong-amount') p.movements[0]!.amount = 99n;
    if (kind === 'wrong-recipient') p.movements[1]!.to = OTHER;
    if (kind === 'wrong-pool') p.movements[1]!.from = address(9);
    if (kind === 'wrong-interface') p.spec.functions.set(p.call.name, ['a', 'b']);
    if (kind === 'wrong-event-contract') p.call.contract = address(9);
    if (kind === 'wrong-output-limit') p.call.args[1] = amount(201n);
    expect(decodeSoroswapSwap(p)).toBeUndefined();
  });
});

describe('provider history and explicit archive fallback', () => {
  it('validates the provider-reported window, including malformed/unsupported responses', async () => {
    expect(await providerWindow(rpc({ getHealth: { oldestLedger: 10, latestLedger: 20, ledgerRetentionWindow: 11 } }))).toEqual({ oldestLedger: 10, latestLedger: 20, ledgerRetentionWindow: 11 });
    expect(await providerWindow(rpc({ getHealth: { oldestLedger: 30, latestLedger: 20 } }))).toBeUndefined();
    expect(await providerWindow(rpc({}))).toBeUndefined();
  });
  it('does not contact a fallback unless explicitly provided', async () => {
    const read = vi.fn(async () => ({ found: false as const, reason: 'the provider has no such transaction' }));
    const result = await withStellarAvailability(rpc({}), undefined, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.availability?.attempts[0]?.result).toBe('not-found');
    expect(result.availability?.note).toContain('not a proof failure');
  });
  it('uses only the fallback response and provenance, never mixed keys or events', async () => {
    const primary = rpc({}), archive = { ...rpc({}), provider: 'archive.example' };
    const result = await withStellarAvailability(primary, archive, async (provider) => provider === primary ? { found: false, reason: 'the provider has no such transaction' } : { found: false, reason: 'no supported proof', facts: { ...facts, provider: provider.provider } });
    expect(result.facts?.provider).toBe('archive.example');
    expect(result.availability?.attempts.map((a) => a.result)).toEqual(['not-found', 'found']);
  });
  it('does not try fallback for unsupported calls or a wrong-network response', async () => {
    const read = vi.fn(async () => ({ found: false as const, reason: 'the provider is not serving stellar-testnet' }));
    await withStellarAvailability(rpc({}), rpc({}), read);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it('keeps failures separate from proof validity and never repeats provider error text', async () => {
    const result = await withStellarAvailability(rpc({}), rpc({}), async () => { throw new Error('secret-provider-url'); });
    expect(result.found).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-provider-url');
    expect(result.availability?.attempts.map((a) => a.result)).toEqual(['unavailable', 'unavailable']);
  });
});

describe('before-you-sign inspection, on this device only', () => {
  it('inspects unsigned calls locally and states what was not checked', () => {
    const result = inspectStellarTransaction(envelope(), 'stellar-testnet');
    expect(result).toMatchObject({ kind: 'inspected', source: USER, feePayer: USER, signatures: 0, maxFeeStroops: '100' });
    if (result.kind !== 'inspected') throw new Error(result.reason);
    expect(result.operations[0]?.description).toContain('transfer');
    expect(result.warnings.join(' ')).toContain('does not encode');
  });
  it('decodes classic payments as requests without a network call', () => {
    const result = inspectStellarTransaction(envelope(Operation.payment({ destination: OTHER, asset: Asset.native(), amount: '1.2' })), 'stellar-mainnet');
    expect(result.kind === 'inspected' && result.operations[0]?.description).toContain('Requested payment of 1.2000000 XLM');
  });
  it('keeps fee-bump fee payers separate', () => {
    const inner = TransactionBuilder.fromXDR(envelope(), Networks.TESTNET);
    if ('innerTransaction' in inner) throw new Error('expected ordinary transaction');
    const feeBump = TransactionBuilder.buildFeeBumpTransaction(OTHER, '100', inner, Networks.TESTNET).toXDR();
    expect(inspectStellarTransaction(feeBump, 'stellar-testnet')).toMatchObject({ kind: 'inspected', source: USER, feePayer: OTHER, signatures: 0 });
  });
  it('runs the offline inspect CLI, which has no way to send the transaction anywhere', () => {
    const folder = mkdtempSync(join(tmpdir(), 'lumenlenz-inspect-'));
    const file = join(folder, 'unsigned.xdr');
    writeFileSync(file, envelope());
    const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
    const result = spawnSync(process.execPath, [cli, 'inspect', file, '--chain', 'stellar-testnet', '--json'], { encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'inspected', source: USER });
    expect(result.stdout).not.toContain(envelope());
    const misuse = spawnSync(process.execPath, [cli, 'inspect', file, '--chain', 'stellar-testnet', '--simulate'], { encoding: 'utf8' });
    expect(misuse.status).toBe(64);
  });
  it.each(['', 'SSECRET', 'a'.repeat(262145), '<script>alert(1)</script>'])('refuses malformed/oversize inputs without echoing them', (text) => {
    const result = inspectStellarTransaction(text, 'stellar-testnet');
    expect(result.kind).toBe('not-inspected');
    expect(JSON.stringify(result)).not.toContain('<script>');
  });
  it('requires an explicit supported network', () => {
    expect(inspectStellarTransaction(envelope(), 'ethereum')).toEqual({ kind: 'not-inspected', reason: 'Choose Stellar testnet or mainnet explicitly.' });
  });
  it('says when an envelope is already signed, without authenticating the signatures', () => {
    const parsed = xdr.TransactionEnvelope.fromXDR(envelope(), 'base64');
    parsed.v1().signatures([new xdr.DecoratedSignature({ hint: Buffer.alloc(4), signature: Buffer.alloc(64) })]);
    const result = inspectStellarTransaction(parsed.toXDR('base64'), 'stellar-testnet');
    expect(result).toMatchObject({ kind: 'inspected', signatures: 1 });
    expect(result.kind === 'inspected' && result.warnings).toContain('This envelope contains signatures; this tool does not authenticate them.');
  });
  it('reads nested authorization trees and refuses excessive depth', () => {
    const result = inspectStellarTransaction(withAuthorization(authEntry(2)), 'stellar-testnet');
    if (result.kind !== 'inspected') throw new Error(result.reason);
    expect(result.operations[0]?.authorizations[0]?.invocation.children[0]?.call).toContain('transfer');
    expect(inspectStellarTransaction(withAuthorization(authEntry(15)), 'stellar-testnet')).toMatchObject({ kind: 'not-inspected', reason: 'The authorization tree exceeds the inspection limit.' });
  });
  it('notices authorization signatures embedded in a call', () => {
    const entry = authEntry();
    entry.credentials(xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: Address.fromString(USER).toScAddress(), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 500, signature: xdr.ScVal.scvVec([]) })));
    expect(inspectStellarTransaction(withAuthorization(entry), 'stellar-testnet')).toMatchObject({ kind: 'inspected', embeddedAuthorizationSignatures: true });
  });
});

describe('proof profiles and the pinned circuit directory', () => {
  it('never promotes a known key or an incomplete review to reviewed', () => {
    expect(reviewText({ status: 'reviewed', note: 'missing reviewer' })).toMatch(/^NOT REVIEWED/);
    expect(reviewText({ status: 'reviewed', note: 'documented review', reviewer: 'Example reviewer', date: '2026-10-15' })).toContain('not authenticated');
    const registry = loadKeyRegistry(readFileSync(new URL('../registry/keys.json', import.meta.url)));
    const directory = circuitDirectory(registry);
    expect(directory.length).toBeGreaterThan(1);
    expect(directory.every((entry) => entry.review.startsWith('NOT REVIEWED'))).toBe(true);
    expect(directory.some((entry) => entry.title.includes('Stellar Private Payments'))).toBe(true);
  });
  it('shows a checked circuit with input meanings, versions and honest review status', async () => {
    const report = await checkText({ proof: fixture('semaphore-v4-valid.json') });
    const profile = proofProfile(report);
    expect(profile?.title).toContain('Semaphore');
    expect(profile?.explanationReview).toMatch(/^NOT REVIEWED/);
    expect(profile?.verifier).toContain('ark-groth16');
    expect(profile?.inputs.length).toBeGreaterThan(0);
  });
});
