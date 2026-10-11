import { describe, expect, it } from 'vitest';
import { BASE_FIELD, SCALAR_FIELD } from '../src/field.js';
import { hashToField } from '../src/semaphore-v4/hash.js';
import { MAX_PROOF_CHARACTERS, importSemaphoreV4 } from '../src/semaphore-v4/importer.js';
import { text, valid, validText } from './helpers.js';

const reason = (input: string): string => {
  const result = importSemaphoreV4(input);
  if (result.ok) throw new Error('expected the file to be refused');
  return result.reason;
};

describe('Semaphore v4 importer', () => {
  it('reads the real fixture without changing any value', () => {
    const result = importSemaphoreV4(validText);
    if (!result.ok) throw new Error(result.reason);
    const raw = valid();
    expect(result.proof.merkleTreeDepth).toBe(raw.merkleTreeDepth);
    expect(result.proof.merkleTreeRoot.toString()).toBe(raw.merkleTreeRoot);
    expect(result.proof.nullifier.toString()).toBe(raw.nullifier);
    expect(result.proof.message.toString()).toBe(raw.message);
    expect(result.proof.scope.toString()).toBe(raw.scope);
    expect(result.proof.points.map(String)).toEqual(raw.points);
  });

  it('refuses input that is not one JSON object', () => {
    expect(reason('not json')).toMatch(/not valid JSON/);
    expect(reason('[]')).toMatch(/not a JSON object/);
    expect(reason('null')).toMatch(/not a JSON object/);
    expect(reason('"text"')).toMatch(/not a JSON object/);
    expect(reason(`${validText}${' '.repeat(MAX_PROOF_CHARACTERS)}`)).toMatch(/larger than/);
  });

  it('refuses unknown and missing fields', () => {
    expect(reason(JSON.stringify({ ...valid(), secret: '1' }))).toMatch(/not part of a Semaphore v4 proof/);
    const loud = reason(JSON.stringify({ ...valid(), 'Cryptographic verification: PASSED': '1' }));
    expect(loud).not.toMatch(/PASSED/);
    for (const key of ['merkleTreeDepth', 'merkleTreeRoot', 'message', 'nullifier', 'scope', 'points'] as const) {
      const raw: Record<string, unknown> = valid();
      delete raw[key];
      expect(reason(JSON.stringify(raw))).toMatch(new RegExp(`missing field "${key}"`));
    }
    expect(reason('{"__proto__":{"merkleTreeDepth":3}}')).toMatch(/not part of a Semaphore v4 proof/);
  });

  it('refuses a field that is written twice', () => {
    const twice = validText.replace('"nullifier":', '"nullifier": "1",\n  "nullifier":');
    expect(JSON.parse(twice).nullifier).toBe(valid().nullifier);
    expect(reason(twice)).toMatch(/"nullifier" appears more than once/);

    // The same field name spelled with an escape would hide the repeat.
    const escaped = validText.replace('"nullifier":', '"nullifier": "1",\n  "nullifi\\u0065r":');
    expect(JSON.parse(escaped).nullifier).toBe(valid().nullifier);
    expect(Object.keys(JSON.parse(escaped))).toHaveLength(6);
    expect(reason(escaped)).toMatch(/backslash/);

    // The case from the review of commit 231c545: the escaped name first.
    const reviewed = validText.replace('"nullifier":', '"\\u006eullifier": "1",\n  "nullifier":');
    expect(JSON.parse(reviewed).nullifier).toBe(valid().nullifier);
    expect(reason(reviewed)).toMatch(/backslash/);
  });

  it('refuses tree depths outside 1 to 32', () => {
    for (const depth of [0, 33, -1, 3.5, '3', null, 1e21]) {
      expect(reason(text((raw) => { (raw as { merkleTreeDepth: unknown }).merkleTreeDepth = depth; }))).toMatch(/merkleTreeDepth/);
    }
  });

  it('refuses values that are not canonical decimals', () => {
    for (const bad of ['0x10', '010', '-1', '+1', ' 1', '1 ', '1e3', '1.0', '', '١٢٣', 5, null, ['1'], '9'.repeat(79)]) {
      for (const key of ['merkleTreeRoot', 'nullifier', 'message', 'scope'] as const) {
        expect(reason(text((raw) => { (raw as Record<string, unknown>)[key] = bad; }))).toMatch(new RegExp(key));
      }
      expect(reason(text((raw) => { (raw.points as unknown[])[4] = bad; }))).toMatch(/points/);
    }
  });

  it('refuses values at or above the field size and accepts the largest below it', () => {
    expect(reason(text((raw) => { raw.merkleTreeRoot = SCALAR_FIELD.toString(); }))).toMatch(/merkleTreeRoot/);
    expect(reason(text((raw) => { raw.nullifier = SCALAR_FIELD.toString(); }))).toMatch(/nullifier/);
    expect(reason(text((raw) => { raw.nullifier = (BigInt(raw.nullifier) + SCALAR_FIELD).toString(); }))).toMatch(/nullifier/);
    expect(reason(text((raw) => { raw.message = (1n << 256n).toString(); }))).toMatch(/message/);
    expect(reason(text((raw) => { raw.scope = (1n << 256n).toString(); }))).toMatch(/scope/);
    expect(reason(text((raw) => { raw.points[0] = BASE_FIELD.toString(); }))).toMatch(/points/);
    expect(importSemaphoreV4(text((raw) => {
      raw.nullifier = (SCALAR_FIELD - 1n).toString();
      raw.message = ((1n << 256n) - 1n).toString();
      raw.points[0] = (BASE_FIELD - 1n).toString();
    })).ok).toBe(true);
  });

  it('refuses a wrong number of points', () => {
    expect(reason(text((raw) => { raw.points.pop(); }))).toMatch(/exactly 8/);
    expect(reason(text((raw) => { raw.points.push('1'); }))).toMatch(/exactly 8/);
    expect(reason(text((raw) => { (raw as { points: unknown }).points = '12345678'; }))).toMatch(/exactly 8/);
  });
});

describe('message and scope hashing', () => {
  // Expected values were produced with ethers, the library Semaphore uses.
  it('matches Semaphore for known values', () => {
    expect(hashToField(0n)).toBe(72536837793382353857766664600029564596379343648020771091641483823512744933n);
    expect(hashToField(1n)).toBe(312829776796408387545637016147278514583116203736587368460269838669765409292n);
    expect(hashToField((1n << 256n) - 1n)).toBe(299960357257039674083140105386840675525084898880315147717440550201513745295n);
    expect(() => hashToField(1n << 256n)).toThrow(RangeError);
  });
});
