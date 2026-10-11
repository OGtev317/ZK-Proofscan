import { readFile } from 'node:fs/promises';
import { loadSemaphoreV4Keys, type SemaphoreV4Keys } from '../semaphore-v4/artifact.js';

const BUNDLED = new URL('../../artifacts/semaphore-v4/verification-keys.json', import.meta.url);

export async function bundledSemaphoreV4Keys(): Promise<SemaphoreV4Keys> {
  return loadSemaphoreV4Keys(await readFile(BUNDLED));
}
