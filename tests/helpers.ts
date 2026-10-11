import { readFileSync } from 'node:fs';

export const KEYS_PATH = new URL('../artifacts/semaphore-v4/verification-keys.json', import.meta.url);
export const validText = readFileSync(new URL('./fixtures/semaphore-v4-valid.json', import.meta.url), 'utf8');

export type Raw = {
  merkleTreeDepth: number;
  merkleTreeRoot: string;
  message: string;
  nullifier: string;
  scope: string;
  points: string[];
};

export const valid = (): Raw => JSON.parse(validText) as Raw;
export const text = (change: (raw: Raw) => void): string => {
  const raw = valid();
  change(raw);
  return JSON.stringify(raw);
};
export const plus = (value: string, by: bigint): string => (BigInt(value) + by).toString();
