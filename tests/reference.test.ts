import { describe, expect, it } from 'vitest';
import { resolveTransaction } from '../src/chain/find.js';
import { familyOf, NETWORKS, PAGE_RPCS, readTransactionReference } from '../src/chain/reference.js';
import { CHAINS } from '../src/chain/rpc.js';
import type { ChainSource } from '../src/chain/source.js';
import { STELLAR_NETWORKS } from '../src/chain/stellar.js';
import { plainWords } from '../src/plain.js';
import type { Report } from '../src/report.js';

const EVM = '0xca718b1f6cd0eb1d4bc47cd95a73d085bd0077cfc7553de6e61ae5d80669c787';
const STELLAR = 'cd1d09c950ff598c329ea4a55578fea38ad674a749bd9808d8316c823cdfb6fc';

describe('reading what a person pastes to name a transaction', () => {
  it('knows every network the tool looks up on, and gives the page a provider for each', () => {
    expect([...NETWORKS.ethereum].sort()).toEqual(CHAINS.map((chain) => chain.name).sort());
    expect([...NETWORKS.stellar].sort()).toEqual(STELLAR_NETWORKS.map((network) => network.name).sort());
    for (const network of [...NETWORKS.ethereum, ...NETWORKS.stellar]) {
      expect(PAGE_RPCS[network], network).toMatch(/^https:\/\/[a-z0-9.-]+\/?$/);
      expect(familyOf(network)).toBeDefined();
    }
    expect(familyOf('stellar-futurenet')).toBeUndefined();
  });

  it.each([
    [EVM, { family: 'ethereum', hash: EVM }],
    [`  ${EVM.toUpperCase().replace('0X', '0x')}\n`, { family: 'ethereum', hash: EVM }],
    [STELLAR, { family: 'stellar', hash: STELLAR }],
    [`https://sepolia.etherscan.io/tx/${EVM}`, { family: 'ethereum', network: 'sepolia', hash: EVM }],
    [`etherscan.io/tx/${EVM}`, { family: 'ethereum', network: 'ethereum', hash: EVM }],
    [`https://www.etherscan.io/tx/${EVM}?utm=x#top`, { family: 'ethereum', network: 'ethereum', hash: EVM }],
    [`https://basescan.org/tx/${EVM}`, { family: 'ethereum', network: 'base', hash: EVM }],
    [`https://sepolia.basescan.org/tx/${EVM}`, { family: 'ethereum', network: 'base-sepolia', hash: EVM }],
    [`https://optimistic.etherscan.io/tx/${EVM}`, { family: 'ethereum', network: 'optimism', hash: EVM }],
    [`https://arbiscan.io/tx/${EVM}`, { family: 'ethereum', network: 'arbitrum', hash: EVM }],
    [`https://polygonscan.com/tx/${EVM}`, { family: 'ethereum', network: 'polygon', hash: EVM }],
    [`https://stellar.expert/explorer/testnet/tx/${STELLAR}`, { family: 'stellar', network: 'stellar-testnet', hash: STELLAR }],
    [`https://stellar.expert/explorer/public/tx/${STELLAR}`, { family: 'stellar', network: 'stellar-mainnet', hash: STELLAR }],
    [`https://lab.stellar.org/r/testnet/tx/${STELLAR}`, { family: 'stellar', network: 'stellar-testnet', hash: STELLAR }],
    [`https://stellarchain.io/tx/${STELLAR}`, { family: 'stellar', network: 'stellar-mainnet', hash: STELLAR }],
    [`https://testnet.stellarchain.io/transactions/${STELLAR}`, { family: 'stellar', network: 'stellar-testnet', hash: STELLAR }],
  ])('reads %s', (pasted, expected) => {
    expect(readTransactionReference(pasted)).toEqual(expected);
  });

  it.each([
    '',
    'hello',
    EVM.slice(0, -1),
    `${STELLAR}0`,
    `https://example.com/tx/${EVM}`,
    `https://etherscan.io/address/${EVM}`,
    `https://etherscan.io/tx/${STELLAR}`,
    `https://stellar.expert/explorer/futurenet/tx/${STELLAR}`,
    `https://stellar.expert/explorer/testnet/tx/${EVM}`,
    `javascript:alert(1)//etherscan.io/tx/${EVM}`,
    `ftp://etherscan.io/tx/${EVM}`,
    'x'.repeat(600),
  ])('refuses %s', (pasted) => {
    expect(readTransactionReference(pasted)).toBeUndefined();
  });

  it('settles the network from the link, the choice, or both, and refuses a contradiction', () => {
    expect(resolveTransaction(`https://sepolia.etherscan.io/tx/${EVM}`, undefined)).toEqual({ network: 'sepolia', hash: EVM });
    expect(resolveTransaction(EVM, 'base')).toEqual({ network: 'base', hash: EVM });
    expect(resolveTransaction(EVM, undefined)).toEqual({ reason: 'a hash on its own does not say which network it is on; name the network' });
    expect(resolveTransaction(`https://stellar.expert/explorer/testnet/tx/${STELLAR}`, 'stellar-mainnet')).toEqual({ reason: 'the link is to a transaction on stellar-testnet, not stellar-mainnet' });
    expect(resolveTransaction(STELLAR, 'sepolia')).toEqual({ reason: 'that is not written as a transaction hash on sepolia' });
    expect(resolveTransaction(EVM, 'stellar-testnet')).toEqual({ reason: 'that is not written as a transaction hash on stellar-testnet' });
    expect(resolveTransaction('nonsense', 'sepolia')).toEqual({ reason: 'that is not a transaction hash or a block explorer link to a transaction' });
  });
});

describe('the summary in plain words', () => {
  const verifier = { name: 'snarkjs', version: '0.7.6', alsoCheckedBy: { name: 'ark-groth16', version: '0.6.0' } };
  const source: ChainSource = {
    kind: 'stellar-transaction', provider: 'soroban-testnet.stellar.org', network: 'stellar-testnet', transaction: STELLAR, ledger: 1, contract: `C${'A'.repeat(55)}`,
    contractCode: '0'.repeat(64), status: 'succeeded', call: 'stellar-private-payments.transact', keyFrom: 'code', keyContract: `C${'B'.repeat(55)}`, keyContractCode: '0'.repeat(64), keyLastChanged: 0,
  };
  const base = { reportVersion: 3, tool: { name: 'zk-proofscan', version: '0.0.0' }, input: { sha256: '0' } } as const;

  it('never calls an unchecked or rejected proof valid', () => {
    expect(plainWords({ ...base, outcome: 'unsupported', reason: 'it is not a proof' } as Report)).toBe('This proof was not checked: it is not a proof. That says nothing about whether it is valid.');
    const failed = plainWords({ ...base, outcome: 'invalid', basis: 'bundled-circuit', public: [], verification: { result: 'failed', verifier, verificationKeysSha256: '0' } } as Report, source);
    expect(failed).toMatch(/^The proof is not valid: the verifier rejected it, so it establishes nothing\./);
    expect(failed).not.toContain('is valid:');
  });

  it('says what an unknown or unexplained key does not show, and keeps the network\'s decision apart', () => {
    const report = { ...base, outcome: 'valid', basis: 'supplied-key', claim: '', hidden: [], publicInputs: [], verification: { result: 'passed', verifier }, keyRecognition: { match: 'none' }, explanation: { review: { status: 'unreviewed', note: '' } }, limits: [], assumptions: [] } as unknown as Report;
    const text = plainWords(report, source);
    expect(text).toContain('snarkjs and ark-groth16, two independent verifiers, both accept it');
    expect(text).toContain('that key is not one this tool knows, so this does not show what was proven');
    expect(text).toContain('on the Stellar test network, according to soroban-testnet.stellar.org; the network accepted that transaction, which is the contract\'s own decision and separate from this check');
    expect(text).toContain('It does not show who made the proof. The wording here has not been reviewed by a qualified person.');
    const alone = plainWords({ ...report, verification: { result: 'passed', verifier: { name: 'snarkjs', version: '0.7.6' } } } as unknown as Report);
    expect(alone).toContain('The proof is valid: snarkjs accepts it.');
    expect(alone).not.toContain('found in transaction');
  });
});
