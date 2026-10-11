import { keccak_256 } from '@noble/hashes/sha3.js';
import type { ProofInputs } from '../inputs.js';
import { utf8 } from '../sha256.js';

/**
 * A contract call this tool knows how to read a proof out of. Matching is by
 * the call's shape alone, which any contract can copy, so a match says how
 * to read the data and nothing about which contract was called.
 */
export interface KnownCall {
  id: string;
  signature: string;
  /** Number of 32-byte words after the selector. */
  words: number;
  /** A recorded key the proof must be checked with, if the call does not use bundled keys. */
  recordedKey?: string;
  /** Deployments the publisher names, lower case. Recorded, not checked to be live. */
  deployments: { chainId: number; address: string; namedIn: string }[];
  /** Turns the call's words into the files this tool checks. The key file is added by the caller. */
  read(words: bigint[]): Pick<ProofInputs, 'proof' | 'publicInputs'> | undefined;
}

const selector = (signature: string): string => Array.from(keccak_256(utf8(signature)).slice(0, 4), (byte) => byte.toString(16).padStart(2, '0')).join('');
const text = (value: unknown): string => `${JSON.stringify(value, null, 1)}\n`;

export const KNOWN_CALLS: readonly KnownCall[] = [
  {
    // ZK Email's Proof of Twitter demonstration contract.
    id: 'proof-of-twitter.mint',
    signature: 'mint(uint256[8],uint256[3])',
    words: 11,
    recordedKey: 'zk-email-proof-of-twitter-verification-key',
    deployments: [
      { chainId: 11155111, address: '0xab157f13e9643f45aea693fdb1a3c22dbdb984a5', namedIn: 'packages/app/.env of zkemail/proof-of-twitter at commit b6d9c2d6a8c99563411992ae3610ecf2afba1ee5' },
    ],
    read(words) {
      const p = words.map(String);
      return {
        // The contract takes each pair of the second point in the opposite order to snarkjs.
        proof: text({ pi_a: [p[0], p[1], '1'], pi_b: [[p[3], p[2]], [p[5], p[4]], ['1', '0']], pi_c: [p[6], p[7], '1'], protocol: 'groth16', curve: 'bn128' }),
        publicInputs: text([p[8], p[9], p[10]]),
      };
    },
  },
  {
    // A direct call to a Semaphore v4 contract. Applications usually call
    // Semaphore from their own contract, and those calls are not read here.
    id: 'semaphore-v4.validate-proof',
    signature: 'validateProof(uint256,(uint256,uint256,uint256,uint256,uint256,uint256[8]))',
    words: 14,
    deployments: [],
    read(words) {
      const depth = words[1]!;
      if (depth > 32n) return undefined;
      const [merkleTreeRoot, nullifier, message, scope, ...points] = words.slice(2).map(String);
      return { proof: `${JSON.stringify({ merkleTreeDepth: Number(depth), merkleTreeRoot, nullifier, message, scope, points }, null, 2)}\n` };
    },
  },
];

const BY_SELECTOR = new Map(KNOWN_CALLS.map((call) => [selector(call.signature), call]));

/** Finds the known call a transaction's input data is, and its words. Exact length only. */
export function readCall(input: string): { call: KnownCall; words: bigint[] } | undefined {
  if (!/^0x([0-9a-f]{2})*$/.test(input) || input.length < 10) return undefined;
  const call = BY_SELECTOR.get(input.slice(2, 10));
  const data = input.slice(10);
  if (call === undefined || data.length !== call.words * 64) return undefined;
  return { call, words: Array.from({ length: call.words }, (_, i) => BigInt(`0x${data.slice(i * 64, (i + 1) * 64)}`)) };
}

export const selectorOf = selector;
