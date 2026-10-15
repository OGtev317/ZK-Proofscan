import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { recordedRpc } from '../src/chain/recorded.js';
import { lookupStellarTransaction, type StellarNetwork } from '../src/chain/stellar.js';
import { checkText } from '../src/node/run.js';
import { stellarPrivatePaymentsKeys } from '../src/node/bundled.js';
import { stopEngines } from '../src/node/stop.js';

// Transactions sent on a local Stellar network (the Quickstart image, with
// throwaway keys) by scripts/local-stellar-regression.mjs, which recorded
// every RPC answer the lookup received. Replayed here with no network.
const root = fileURLToPath(new URL('..', import.meta.url));
const local: StellarNetwork = { name: 'stellar-local', passphrase: 'Standalone Network ; February 2017', rpcVariable: 'STELLAR_LOCAL_RPC_URL' };
afterAll(stopEngines);

const ALICE = 'GDSKUJAWEKBDS7LNJLAKJXT2A7EOKEZ3PKBEC7FSTPKAHMIJWPYT2TUE';
const BOB = 'GBDI3BF3NU6I757JKPADS2BDVWXBBGUII2AO666DH7AD7UA4YH5JJIMT';
const ISSUER = 'GBUWWUZFCUFNMTEQMV4SLNRHN2T2YEM4EOH5DNBCCUYHTIY7BNXHDELD';
const ASSET_CONTRACT = 'CDWBOFCUJ26GO4OCPPBU2ZX3S2WUTHP4DRTXUMHUADFE67SFGI57KBGW';

const look = (name: string) => {
  const answers = JSON.parse(readFileSync(join(root, `tests/fixtures/stellar-local/${name}.json`), 'utf8')) as Record<string, Record<string, unknown>>;
  return lookupStellarTransaction({ network: local, transaction: answers.getTransaction!.txHash as string, rpc: recordedRpc(answers, 'localhost'), recordedKeys: stellarPrivatePaymentsKeys });
};
const factsOf = async (name: string) => {
  const found = await look(name);
  if (found.found || found.facts === undefined) throw new Error(`expected facts only for ${name}`);
  expect(found.reason).toBe('the transaction is not a call this tool reads a proof from');
  return found.facts;
};

describe('transactions made on a local Stellar network', () => {
  it('reads a payment\'s amount, memo, fee and outcome', async () => {
    expect(await factsOf('xlm-payment-with-memo')).toMatchObject({
      status: 'succeeded',
      from: ALICE,
      to: BOB,
      action: 'a payment of 12.5 XLM',
      fee: '0.00001 XLM',
      memo: '"zkp regression"',
      outcomes: ['operation 1 (payment): succeeded'],
      tokens: [`moved 12.5 XLM from ${ALICE} to ${BOB}`],
    });
  });

  it('names an issued asset\'s issuer, and reads a payment by the issuer as creating the asset', async () => {
    expect(await factsOf('issued-asset-payment')).toMatchObject({
      from: ISSUER,
      action: `a payment of 1000 ZKP issued by ${ISSUER}, whose account names no home domain`,
      tokens: [`created 1000 ZKP (issued by ${ISSUER}) for ${ALICE}`],
    });
  });

  it('reports a failed payment as failed, with its reason, and no movement', async () => {
    const facts = await factsOf('failed-payment');
    expect(facts).toMatchObject({ status: 'failed', outcomes: ['operation 1 (payment): failed: underfunded'] });
    expect(facts.tokens).toBeUndefined();
  });

  it('names a Stellar Asset Contract call by the standard token interface, and reads the movement', async () => {
    expect(await factsOf('asset-contract-transfer')).toMatchObject({
      status: 'succeeded',
      to: ASSET_CONTRACT,
      action: `a call to transfer(from: ${ALICE}, to: ${BOB}, amount: 250000000) on contract ${ASSET_CONTRACT}, named by its standard token interface`,
      outcomes: ['operation 1 (invoke host function): succeeded'],
      tokens: [`moved 25 ZKP (issued by ${ISSUER}) from ${ALICE} to ${BOB}`],
    });
  });

  it('flags an unlimited allowance, with the parameter names the asset contract uses', async () => {
    const facts = await factsOf('asset-contract-unlimited-allowance');
    expect(facts.action).toContain('approve(from: ');
    expect(facts.action).toContain('amount: 170141183460469231731687303715884105727, live_until_ledger: 5250)');
    expect(facts.tokens).toEqual([`allowed ${BOB} to spend an UNLIMITED amount of ZKP (issued by ${ISSUER}) belonging to ${ALICE}, until ledger 5250, which lets it move all of it until then`]);
  });

  it('finds the proof a Nethermind UltraHonk verifier contract was given, with its key, and checks it here', async () => {
    const found = await look('ultrahonk-verify-proof');
    if (!found.found) throw new Error(found.reason);
    expect(found.source).toMatchObject({ network: 'stellar-local', status: 'succeeded', call: 'nethermind-ultrahonk.verify-proof', keyFrom: 'storage' });
    expect(found.facts?.action).toMatch(/^a call to verify_proof\(public_inputs: 0x[0-9a-f]{16}… \(64 bytes\), proof_bytes: 0x[0-9a-f]{16}… \(14592 bytes\)\) on contract C[A-Z2-7]{55}, named by its contract interface$/);
    expect(found.facts?.build).toBe('Its code says it was built with Rust 1.97.1, soroban-sdk 28.0.0, stellar-cli 28.0.0, and names no source repository (SEP-55), so its build cannot be traced to source.');
    const report = await checkText(found.inputs);
    expect(report.outcome).toBe('valid');
  }, 120_000);
});
