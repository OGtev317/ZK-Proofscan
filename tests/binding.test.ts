import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { AdapterError, loadAdapter } from '../src/adapter.js';
import { snarkjsEngine, stopSnarkjs } from '../src/snarkjs-engine.js';
import { ArtifactMismatchError } from '../src/semaphore-v4/artifact.js';
import { bindSemaphoreV4, type AdapterLock } from '../src/semaphore-v4/bind.js';
import { sha256Hex, utf8 } from '../src/sha256.js';
import { KEYS_PATH } from './helpers.js';

const adapterBytes = readFileSync(new URL('../adapters/semaphore-v4/adapter.json', import.meta.url));
const lock = JSON.parse(readFileSync(new URL('../adapters/semaphore-v4/lock.json', import.meta.url), 'utf8')) as AdapterLock;
const keyBytes = readFileSync(KEYS_PATH);
const parts = { adapterBytes, lock, keyBytes, engine: snarkjsEngine };
afterAll(stopSnarkjs);

type Loose = Record<string, any>;
/** An edited manifest, with a lock that matches the edit unless told otherwise. */
const edited = (change: (manifest: Loose) => void, relock = true) => {
  const manifest = JSON.parse(adapterBytes.toString()) as Loose;
  change(manifest);
  const bytes = utf8(JSON.stringify(manifest));
  return { ...parts, adapterBytes: bytes, lock: relock ? { id: manifest.id, revision: manifest.revision, sha256: sha256Hex(bytes) } : lock };
};

describe('adapter manifest', () => {
  it('loads the shipped adapter and identifies it by the hash of its bytes', () => {
    const adapter = loadAdapter(adapterBytes);
    expect(adapter.sha256).toBe(lock.sha256);
    expect(adapter.manifest.review.status).toBe('unreviewed');
  });

  it('refuses unknown, missing, empty and oversized content', () => {
    const load = (change: (manifest: Loose) => void) => () => loadAdapter(edited(change).adapterBytes);
    expect(load((m) => { m.extra = 1; })).toThrow(/unknown field "extra"/);
    expect(load((m) => { m.explanation.marketing = 'Proves you are human'; })).toThrow(/unknown field/);
    expect(load((m) => { delete m.explanation.limits; })).toThrow(/missing "limits"/);
    expect(load((m) => { m.explanation.limits = []; })).toThrow(/1 to 32/);
    expect(load((m) => { m.explanation.claim = ''; })).toThrow(/claim/);
    expect(load((m) => { m.explanation.claim = 'x'.repeat(601); })).toThrow(/claim/);
    expect(load((m) => { m.explanation.claim = 5; })).toThrow(/claim/);
    expect(load((m) => { m.revision = 0; })).toThrow(/revision/);
    expect(load((m) => { m.explanation.applicationChecks = []; })).toThrow(/1 to 32/);
    expect(load((m) => { m.explanation.applicationChecks[0].id = 'Not An Id'; })).toThrow(/identifier/);
    expect(load((m) => { m.explanation.applicationChecks[0].status = 'performed'; })).toThrow(/unknown field "status"/);
    expect(load((m) => { m.artifacts[0].sha256 = 'ABC'; })).toThrow(/SHA-256/);
    expect(() => loadAdapter(utf8('not json'))).toThrow(/not valid JSON/);
    expect(() => loadAdapter(new Uint8Array(40_000))).toThrow(/too large/);
  });

  it('refuses a review claim that names nobody, and a named reviewer on an unreviewed adapter', () => {
    const load = (review: Loose) => () => loadAdapter(edited((m) => { m.review = review; }).adapterBytes);
    expect(load({ status: 'reviewed', note: 'Checked.' })).toThrow(/without a reviewer and date/);
    expect(load({ status: 'reviewed', note: 'Checked.', reviewer: 'A. Reviewer' })).toThrow(/without a reviewer and date/);
    expect(load({ status: 'reviewed', note: 'Checked.', reviewer: 'A. Reviewer', date: 'yesterday' })).toThrow(/YYYY-MM-DD/);
    expect(load({ status: 'unreviewed', note: 'Draft.', reviewer: 'A. Reviewer' })).toThrow(/marked unreviewed/);
    expect(load({ status: 'audited', note: 'Checked.' })).toThrow(/status/);
    expect(load({ status: 'reviewed', note: 'Checked.', reviewer: 'A. Reviewer', date: '2026-10-11' })).not.toThrow();
  });
});

describe('binding an explanation to its verifier and keys', () => {
  it('binds the shipped parts', () => {
    const bound = bindSemaphoreV4(parts);
    expect(bound.adapter.sha256).toBe(lock.sha256);
    expect(bound.keys.sha256).toBe(bound.adapter.manifest.artifacts[0]!.sha256);
  });

  it('refuses any change of wording that the lock does not record', () => {
    expect(() => bindSemaphoreV4(edited((m) => { m.explanation.claim = 'This proves the holder is a unique human.'; }, false))).toThrow(/not the locked/);
    expect(() => bindSemaphoreV4(edited((m) => { m.explanation.limits.pop(); }, false))).toThrow(/not the locked/);
    expect(() => bindSemaphoreV4(edited((m) => { m.review = { status: 'reviewed', note: 'ok', reviewer: 'X', date: '2026-10-11' }; }, false))).toThrow(/not the locked/);
    expect(() => bindSemaphoreV4({ ...parts, adapterBytes: Buffer.concat([adapterBytes, Buffer.from(' ')]) })).toThrow(/not the locked/);
    expect(() => bindSemaphoreV4({ ...parts, lock: { ...lock, revision: lock.revision + 1 } })).toThrow(/not the locked/);
    expect(() => bindSemaphoreV4({ ...parts, lock: { ...lock, id: 'other' } })).toThrow(/not the locked/);
  });

  it('refuses an adapter written for another format, verifier or version', () => {
    expect(() => bindSemaphoreV4(edited((m) => { m.format = 'semaphore-v3'; }))).toThrow(/not for Semaphore v4/);
    expect(() => bindSemaphoreV4(edited((m) => { m.id = 'age-check'; }))).toThrow(/not for Semaphore v4/);
    expect(() => bindSemaphoreV4(edited((m) => { m.verifier.version = '0.7.5'; }))).toThrow(/written for snarkjs 0\.7\.5, not snarkjs 0\.7\.6/);
    const other = { ...snarkjsEngine, identity: { name: 'other-verifier', version: '0.7.6' } };
    expect(() => bindSemaphoreV4({ ...parts, engine: other })).toThrow(/not other-verifier/);
  });

  it('refuses public-field descriptions that are missing, extra or out of order', () => {
    expect(() => bindSemaphoreV4(edited((m) => { m.publicFields.reverse(); }))).toThrow(/circuit order/);
    expect(() => bindSemaphoreV4(edited((m) => { [m.publicFields[0], m.publicFields[1]] = [m.publicFields[1], m.publicFields[0]]; }))).toThrow(/circuit order/);
    expect(() => bindSemaphoreV4(edited((m) => { m.publicFields.pop(); }))).toThrow(/circuit order/);
    expect(() => bindSemaphoreV4(edited((m) => { m.publicFields.push({ name: 'age', meaning: 'Over 18.' }); }))).toThrow(/circuit order/);
  });

  it('refuses verification keys other than the ones the adapter names', () => {
    const changed = Buffer.from(keyBytes);
    changed[100]! ^= 1;
    expect(() => bindSemaphoreV4({ ...parts, keyBytes: changed })).toThrow(ArtifactMismatchError);
    const otherHash = 'a'.repeat(64);
    expect(() => bindSemaphoreV4(edited((m) => { m.artifacts[0].sha256 = otherHash; }))).toThrow(AdapterError);
    expect(() => bindSemaphoreV4(edited((m) => { m.artifacts.push({ ...m.artifacts[0], role: 'proving-key' }); }))).toThrow(/exactly one/);
    expect(() => bindSemaphoreV4(edited((m) => { m.artifacts[0].role = 'proving-key'; }))).toThrow(/exactly one/);
  });
});
