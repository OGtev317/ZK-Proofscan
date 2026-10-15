import type { BuildAttestation } from './soroban-spec.js';

/**
 * SEP-55 build verification, as far as reading GitHub's record goes: fetch
 * the attestation GitHub holds for a contract's code hash, and check it
 * names that code and the repository the code claims. The attestation's
 * signature (a Sigstore bundle) is not checked here, so the result rests on
 * GitHub's API. Any failure to answer is no answer, never an error.
 */
export type CheckBuild = (repository: string, codeHash: string) => Promise<BuildAttestation | undefined>;

const TIMEOUT_MS = 10_000;
const MAX_BYTES = 2_097_152;

export function githubAttestations(): CheckBuild {
  return async (repository, codeHash) => {
    const match = /^github:([A-Za-z0-9_.-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/.exec(repository);
    if (match === null || !/^[0-9a-f]{64}$/.test(codeHash)) return undefined;
    const [, owner, repo] = match;
    try {
      const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/attestations/sha256:${codeHash}`, {
        headers: { accept: 'application/vnd.github+json' },
        credentials: 'omit',
        redirect: 'error',
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (response.status === 404) return { found: false };
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) return undefined;
      const body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { attestations?: { bundle?: { dsseEnvelope?: { payload?: string } } }[] };
      const payload = body.attestations?.[0]?.bundle?.dsseEnvelope?.payload;
      if (typeof payload !== 'string') return { found: false };
      const statement = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(payload), (character) => character.charCodeAt(0)))) as {
        subject?: { digest?: { sha256?: string } }[];
        predicate?: { buildDefinition?: { resolvedDependencies?: { uri?: string; digest?: { gitCommit?: string } }[] } };
      };
      const dependency = statement.predicate?.buildDefinition?.resolvedDependencies?.[0];
      const sameCode = statement.subject?.[0]?.digest?.sha256 === codeHash;
      const sameRepository = typeof dependency?.uri === 'string' && dependency.uri.replace(/^git\+/, '').replace(/@.*$/, '').toLowerCase() === `https://github.com/${owner}/${repo}`.toLowerCase();
      const commit = dependency?.digest?.gitCommit;
      return { found: true, matches: sameCode && sameRepository, ...(typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit) ? { commit } : {}) };
    } catch {
      return undefined;
    }
  };
}
