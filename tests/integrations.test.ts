import { mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Account, Address, Contract, Keypair, nativeToScVal, Networks, StrKey, TransactionBuilder, xdr } from '@stellar/stellar-sdk';
import { afterAll, describe, expect, it } from 'vitest';
import { prepareWalletReview, matchesWalletReview } from '../src/integrations/wallet-review.js';
import { defineLumenLenzReport } from '../src/browser/index.js';
import { decodeContractChange } from '../src/chain/contract-changes.js';
import { lookupStellarTransaction, STELLAR_NETWORKS } from '../src/chain/stellar.js';
import { recordedRpc } from '../src/chain/recorded.js';
import { SOROSWAP_DEPLOYMENT, soroswapDeploymentMatch } from '../src/chain/deployments.js';
import type { ContractSpec } from '../src/chain/soroban-spec.js';
import { stopEngines } from '../src/node/stop.js';

const USER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
const OTHER = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 8));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 2));
const unsigned = () => new TransactionBuilder(new Account(USER, '1'), { fee: '100', networkPassphrase: Networks.TESTNET }).addOperation(new Contract(TOKEN).call('transfer', Address.fromString(USER).toScVal(), Address.fromString(OTHER).toScVal(), nativeToScVal(10n, { type: 'i128' }))).setTimeout(300).build().toXDR();
afterAll(stopEngines);

describe('dApp-side local review, never a signing gateway', () => {
  it('imports the display module without needing browser globals', () => expect(typeof defineLumenLenzReport).toBe('function'));
  it('binds the whole envelope and network, not just the signature-excluding transaction hash', () => {
    const envelope = unsigned();
    const review = prepareWalletReview(envelope, 'stellar-testnet');
    expect(review.kind).toBe('local-review');
    if (review.kind !== 'local-review') throw new Error('review missing');
    expect(matchesWalletReview(review, envelope, 'stellar-testnet')).toBe(true);
    expect(matchesWalletReview(review, envelope, 'stellar-mainnet')).toBe(false);
    const signed = TransactionBuilder.fromXDR(envelope, Networks.TESTNET);
    signed.sign(Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9))); // synthetic local test only, never a real account
    expect(matchesWalletReview(review, signed.toXDR(), 'stellar-testnet')).toBe(false);
    expect(prepareWalletReview(signed.toXDR(), 'stellar-testnet').kind).toBe('not-reviewed');
    expect(prepareWalletReview('invalid', 'stellar-testnet').kind).toBe('not-reviewed');
    expect(prepareWalletReview(envelope, 'unknown').kind).toBe('not-reviewed');
  });
  it('reads V2 and delegated credentials without losing embedded signatures or delegates', () => {
    const raw = xdr.TransactionEnvelope.fromXDR(unsigned(), 'base64');
    const host = raw.v1().tx().operations()[0]!.body().invokeHostFunctionOp();
    const base = new xdr.SorobanAddressCredentials({ address: Address.fromString(USER).toScAddress(), nonce: xdr.Int64.fromString('1'), signatureExpirationLedger: 100, signature: xdr.ScVal.scvVoid() });
    const entry = new xdr.SorobanAuthorizationEntry({ credentials: xdr.SorobanCredentials.sorobanCredentialsAddressV2(base), rootInvocation: new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(host.hostFunction().invokeContract()), subInvocations: [] }) });
    host.auth([entry]);
    const v2 = prepareWalletReview(raw.toXDR('base64'), 'stellar-testnet');
    expect(v2.kind).toBe('local-review');
    const delegate = new xdr.SorobanDelegateSignature({ address: Address.fromString(OTHER).toScAddress(), signature: xdr.ScVal.scvVoid(), nestedDelegates: [] });
    entry.credentials(xdr.SorobanCredentials.sorobanCredentialsAddressWithDelegates(new xdr.SorobanAddressCredentialsWithDelegates({ addressCredentials: base, delegates: [delegate] })));
    const delegated = prepareWalletReview(raw.toXDR('base64'), 'stellar-testnet');
    expect(delegated.kind).toBe('local-review');
    if (delegated.kind === 'local-review') expect(delegated.preview.operations[0]!.authorizations[0]!.delegates[0]!.address).toBe(OTHER);
    delegate.signature(nativeToScVal('signature-is-present'));
    expect(prepareWalletReview(raw.toXDR('base64'), 'stellar-testnet').kind).toBe('not-reviewed');
    delegate.signature(xdr.ScVal.scvVoid());
    let next = delegate;
    for (let i = 0; i < 14; i++) next = new xdr.SorobanDelegateSignature({ address: delegate.address(), signature: xdr.ScVal.scvVoid(), nestedDelegates: [next] });
    entry.credentials().addressWithDelegates().delegates([next]);
    expect(prepareWalletReview(raw.toXDR('base64'), 'stellar-testnet').kind).toBe('not-reviewed');
  });
});

describe('pinned deployment evidence and real public swap replay', () => {
  it('never identifies a deployment from name, address, or code alone', () => {
    expect(soroswapDeploymentMatch('stellar-mainnet', SOROSWAP_DEPLOYMENT.router, SOROSWAP_DEPLOYMENT.codeSha256)).toBe(true);
    expect(soroswapDeploymentMatch('stellar-testnet', SOROSWAP_DEPLOYMENT.router, SOROSWAP_DEPLOYMENT.codeSha256)).toBe(false);
    expect(soroswapDeploymentMatch('stellar-mainnet', TOKEN, SOROSWAP_DEPLOYMENT.codeSha256)).toBe(false);
    expect(soroswapDeploymentMatch('stellar-mainnet', SOROSWAP_DEPLOYMENT.router, 'ab'.repeat(32))).toBe(false);
  });
  it('decodes actual mainnet events without an RPC or proof verdict', async () => {
    const answers = JSON.parse(readFileSync(new URL('./fixtures/stellar-mainnet/soroswap.json', import.meta.url), 'utf8'));
    const found = await lookupStellarTransaction({ network: STELLAR_NETWORKS[1]!, transaction: answers.getTransaction.txHash, rpc: recordedRpc(answers, 'saved-provider'), recordedKeys: async () => [] });
    expect(found.found).toBe(false);
    expect(found.facts?.swaps?.[0]).toMatchObject({ amounts: ['1000000', '927076'], deploymentMatch: 'published-address-and-code' });
    expect(found.facts?.swaps?.[0]?.identity).toContain('not a security audit');
    expect(found.facts?.movements).toHaveLength(2);
  });
});

describe('OpenZeppelin-compatible emitted control events', () => {
  const spec: ContractSpec = { origin: 'contract interface', codeHash: 'ab'.repeat(32), meta: {}, functions: new Map(), events: [{ name: 'RoleGranted', prefix: ['role_granted'], topics: ['role', 'account'], data: ['caller'], format: 'map' }] };
  const event = () => new xdr.ContractEvent({ ext: new xdr.ExtensionPoint(0), contractId: Buffer.alloc(32, 2) as never, type: xdr.ContractEventType.contract(), body: new xdr.ContractEventBody(0, new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol('role_granted'), xdr.ScVal.scvSymbol('minter'), Address.fromString(USER).toScVal()], data: xdr.ScVal.scvMap([new xdr.ScMapEntry({ key: xdr.ScVal.scvSymbol('caller'), val: Address.fromString(OTHER).toScVal() })]) })) });
  it('explains fields while keeping copied interface, audit and authorization uncertainty explicit', () => {
    const change = decodeContractChange(event(), spec, true);
    expect(change?.description).toContain('granting a role');
    expect(change?.description).toContain(USER);
    expect(change?.evidence).toContain('Any contract can copy');
    expect(change?.evidence).toContain('not established');
  });
  it('refuses failed execution, absent/hashless interfaces and field/type mismatches', () => {
    expect(decodeContractChange(event(), spec, false)).toBeUndefined();
    expect(decodeContractChange(event(), undefined, true)).toBeUndefined();
    expect(decodeContractChange(event(), { ...spec, codeHash: '' }, true)).toBeUndefined();
    expect(decodeContractChange(event(), { ...spec, events: [{ ...spec.events[0]!, data: ['spender'] }] }, true)).toBeUndefined();
    const bad = event(); bad.body().v0().topics()[2] = xdr.ScVal.scvSymbol('not-an-address');
    expect(decodeContractChange(bad, spec, true)).toBeUndefined();
    const extra = event(); extra.body().v0().data(nativeToScVal({ caller: Address.fromString(OTHER), extra: 1 }));
    expect(decodeContractChange(extra, spec, true)).toBeUndefined();
  });
});

describe('public-fixture action runner', () => {
  // The JS runner intentionally lives beside its composite action, not in the published package.
  const runner = () => import(/* @vite-ignore */ new URL('../.github/actions/lumenlenz-check/run.mjs', import.meta.url).href) as Promise<{ checkFixture(options: Record<string, string>, workspace: string): Promise<{ matches: boolean; actual: string }> }>;
  it('checks public proofs offline, rejects unexpected outcomes, and does not infer safety', async () => {
    const { checkFixture } = await runner();
    const workspace = mkdtempSync(join(tmpdir(), 'lumenlenz-action-test-'));
    writeFileSync(join(workspace, 'public.json'), readFileSync(new URL('./fixtures/semaphore-v4-valid.json', import.meta.url)));
    writeFileSync(join(workspace, 'unsigned.xdr'), unsigned());
    const options = { fixture: 'public.json', public: 'true', mode: 'proof', expected: 'valid' };
    expect(await checkFixture(options, workspace)).toMatchObject({ matches: true, actual: 'valid' });
    expect(await checkFixture({ ...options, expected: 'invalid' }, workspace)).toMatchObject({ matches: false, actual: 'valid' });
    expect(await checkFixture({ ...options, mode: 'inspect', expected: 'inspected', fixture: 'unsigned.xdr', network: 'stellar-testnet' }, workspace)).toMatchObject({ matches: true, actual: 'inspected' });
    await expect(checkFixture({ ...options, public: 'false' }, workspace)).rejects.toThrow();
    await expect(checkFixture({ ...options, mode: 'lookup' }, workspace)).rejects.toThrow();
    await expect(checkFixture({ ...options, fixture: '/etc/hosts' }, workspace)).rejects.toThrow();
    symlinkSync('/etc/hosts', join(workspace, 'escaped.json'));
    await expect(checkFixture({ ...options, fixture: 'escaped.json' }, workspace)).rejects.toThrow();
    await expect(checkFixture({ ...options, fixture: '../outside' }, workspace)).rejects.toThrow();
    await expect(checkFixture({ ...options, expected: '$(echo unsafe)' }, workspace)).rejects.toThrow();
  });
});
