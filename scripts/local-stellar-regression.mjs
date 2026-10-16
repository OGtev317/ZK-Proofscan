#!/usr/bin/env node
// Makes the local regression fixtures in tests/fixtures/stellar-local/.
//
// Runs against a LOCAL Stellar network only (the official Quickstart image),
// never testnet or mainnet, with throwaway keys held by the Stellar CLI:
//
//   docker run -d --name zkp-quickstart -p 8000:8000 stellar/quickstart:latest --local --enable core,rpc,horizon
//   stellar network add zkp-local --rpc-url http://localhost:8000/rpc --network-passphrase "Standalone Network ; February 2017"
//   for k in zkp-alice zkp-bob zkp-issuer; do stellar keys generate $k --network zkp-local --fund; done
//   npm run build
//   NETHERMIND_ULTRAHONK_REPO=<checkout of NethermindEth/rs-soroban-ultrahonk at 9aae958> node scripts/local-stellar-regression.mjs
//
// It sends transactions this tool's lookup must describe correctly (a
// payment with a memo, an issued-asset payment, a payment that fails on the
// network, a transfer and an unlimited allowance through a Stellar Asset
// Contract, and a proof verified by Nethermind's UltraHonk verifier
// contract), then records every answer the lookup receives for each, so the
// tests replay them with no network. Keys are read from the Stellar CLI's
// local store into memory and never printed or written.
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const { Keypair, TransactionBuilder, Operation, Asset, Memo } = createRequire(root)('@stellar/stellar-sdk');
const { lookupStellarTransaction } = await import(`${root}dist/chain/stellar.js`);
const { stellarPrivatePaymentsKeys } = await import(`${root}dist/node/bundled.js`);

const RPC = 'http://localhost:8000/rpc';
const HORIZON = 'http://localhost:8000';
const PASSPHRASE = 'Standalone Network ; February 2017';
const NETWORK = { name: 'stellar-local', passphrase: PASSPHRASE, rpcVariable: 'STELLAR_LOCAL_RPC_URL' };
const OUT = `${root}tests/fixtures/stellar-local/`;
const ULTRAHONK = process.env.NETHERMIND_ULTRAHONK_REPO;
if (ULTRAHONK === undefined) throw new Error('set NETHERMIND_ULTRAHONK_REPO to a checkout of NethermindEth/rs-soroban-ultrahonk at 9aae958');

async function rpc(method, params) {
  const reply = await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (reply.error) throw new Error(`${method}: ${JSON.stringify(reply.error)}`);
  return reply.result;
}
// The local network only: refuse to run against any other.
if ((await rpc('getNetwork', {})).passphrase !== PASSPHRASE) throw new Error('this script runs against the local Standalone network only');

const stellar = (...args) => execFileSync('stellar', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const secret = (name) => Keypair.fromSecret(stellar('keys', 'secret', name).trim());
/** Runs a `stellar contract` command and returns the transaction hash from its log on standard error. */
function contractTx(args) {
  const result = require_spawn(args);
  const match = /Signing transaction: ([0-9a-f]{64})/.exec(result.stderr);
  if (match === null) throw new Error(`no transaction from: stellar ${args.slice(0, 3).join(' ')}\n${result.stderr.slice(0, 300)}`);
  return match[1];
}
function require_spawn(args) {
  const done = spawnSync('stellar', args, { encoding: 'utf8' });
  if (done.status !== 0) throw new Error(`stellar ${args.slice(0, 3).join(' ')} failed: ${done.stderr.slice(0, 300)}`);
  return done;
}

async function waitFor(hash) {
  for (let i = 0; i < 30; i++) {
    const found = await rpc('getTransaction', { hash });
    if (found.status !== 'NOT_FOUND') return found.status;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`transaction ${hash} did not appear`);
}

/** Builds, signs and sends a classic transaction, returning its hash once it is in a ledger. */
async function classic(signer, operations, memo) {
  const loaded = await (await fetch(`${HORIZON}/accounts/${signer.publicKey()}`)).json();
  let sequence = BigInt(loaded.sequence);
  const account = { accountId: () => signer.publicKey(), sequenceNumber: () => sequence.toString(), incrementSequenceNumber: () => { sequence += 1n; } };
  const builder = new TransactionBuilder(account, { fee: '100', networkPassphrase: PASSPHRASE }).setTimeout(60);
  for (const operation of operations) builder.addOperation(operation);
  if (memo !== undefined) builder.addMemo(memo);
  const transaction = builder.build();
  transaction.sign(signer);
  const sent = await rpc('sendTransaction', { transaction: transaction.toXDR() });
  await waitFor(sent.hash);
  return sent.hash;
}

/** Looks a transaction up as the tool does, recording every answer it receives. */
async function record(name, hash, description) {
  const answers = { getLedgerEntries: {} };
  const recording = {
    provider: 'localhost',
    async call(method, params) {
      const result = await rpc(method, params);
      if (method === 'getNetwork') answers.getNetwork = { passphrase: result.passphrase };
      else if (method === 'getTransaction') answers.getTransaction = Object.fromEntries(['status', 'txHash', 'ledger', 'createdAt', 'envelopeXdr', 'resultXdr', 'events'].map((key) => [key, result[key]]));
      else if (method === 'getLedgerEntries') answers.getLedgerEntries[params.keys[0]] = { entries: result.entries.map((entry) => ({ key: entry.key, xdr: entry.xdr, lastModifiedLedgerSeq: entry.lastModifiedLedgerSeq })), latestLedger: result.latestLedger };
      return result;
    },
  };
  const found = await lookupStellarTransaction({ network: NETWORK, transaction: hash, rpc: recording, recordedKeys: stellarPrivatePaymentsKeys });
  writeFileSync(`${OUT}${name}.json`, `${JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), network: 'local Stellar Quickstart (Standalone Network ; February 2017)', description, ...answers }, null, 2)}\n`);
  console.log(name, hash, found.found ? 'proof found' : 'facts only');
}

mkdirSync(OUT, { recursive: true });
const [alice, bob, issuer] = ['zkp-alice', 'zkp-bob', 'zkp-issuer'].map(secret);
const zkp = new Asset('ZKP', issuer.publicKey());

await record('xlm-payment-with-memo', await classic(alice, [Operation.payment({ destination: bob.publicKey(), asset: Asset.native(), amount: '12.5' })], Memo.text('zkp regression')), 'A payment of 12.5 XLM with a text memo.');
await classic(alice, [Operation.changeTrust({ asset: zkp })]);
await classic(bob, [Operation.changeTrust({ asset: zkp })]);
await record('issued-asset-payment', await classic(issuer, [Operation.payment({ destination: alice.publicKey(), asset: zkp, amount: '1000' })]), 'The issuer pays 1000 of its asset ZKP.');
await record('failed-payment', await classic(alice, [Operation.payment({ destination: bob.publicKey(), asset: zkp, amount: '5000' })]), 'A payment of more ZKP than the sender holds, which fails on the network.');

// A Stellar Asset Contract for ZKP: a direct transfer and an unlimited allowance through it.
// The asset contract may already exist from an earlier run; its address is fixed by the asset either way.
spawnSync('stellar', ['contract', 'asset', 'deploy', '--asset', `ZKP:${issuer.publicKey()}`, '--source', 'zkp-issuer', '--network', 'zkp-local'], { encoding: 'utf8' });
const assetIdOrExisting = require_spawn(['contract', 'id', 'asset', '--asset', `ZKP:${issuer.publicKey()}`, '--network', 'zkp-local']).stdout.trim();
const transfer = contractTx(['contract', 'invoke', '--id', assetIdOrExisting, '--source', 'zkp-alice', '--network', 'zkp-local', '--', 'transfer', '--from', 'zkp-alice', '--to', bob.publicKey(), '--amount', '250000000']);
await waitFor(transfer);
await record('asset-contract-transfer', transfer, 'A transfer of 25 ZKP called directly on its Stellar Asset Contract.');
const latest = (await rpc('getLatestLedger', {})).sequence;
const approve = contractTx(['contract', 'invoke', '--id', assetIdOrExisting, '--source', 'zkp-alice', '--network', 'zkp-local', '--', 'approve', '--from', 'zkp-alice', '--spender', bob.publicKey(), '--amount', '170141183460469231731687303715884105727', '--live_until_ledger', String(latest + 5000)]);
await waitFor(approve);
await record('asset-contract-unlimited-allowance', approve, 'An allowance of the largest possible amount, through the Stellar Asset Contract.');

// Nethermind's UltraHonk verifier, deployed with this tool's Barretenberg 0.87.0 test key, verifying the test proof.
const legacy = `${root}tests/fixtures/noir-legacy/multiplier-keccak`;
require_spawn(['contract', 'build', '--manifest-path', `${ULTRAHONK}/contracts/rs-soroban-ultrahonk/Cargo.toml`]);
const verifier = require_spawn(['contract', 'deploy', '--wasm', `${ULTRAHONK}/target/wasm32v1-none/release/rs_soroban_ultrahonk.wasm`, '--source', 'zkp-alice', '--network', 'zkp-local', '--', '--vk_bytes-file-path', `${legacy}.vk`]).stdout.trim().split('\n').pop();
const verified = contractTx(['contract', 'invoke', '--id', verifier, '--source', 'zkp-alice', '--network', 'zkp-local', '--send=yes', '--', 'verify_proof', '--public_inputs-file-path', `${legacy}.public_inputs`, '--proof_bytes-file-path', `${legacy}.proof`]);
await waitFor(verified);
await record('ultrahonk-verify-proof', verified, "Nethermind's UltraHonk verifier contract (rs-soroban-ultrahonk at 9aae958), deployed with this tool's Barretenberg 0.87.0 test key, verifying the test proof.");
