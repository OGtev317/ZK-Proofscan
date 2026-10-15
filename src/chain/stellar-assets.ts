import { parse } from 'smol-toml';

/**
 * Checks an issued Stellar asset against its issuer's stellar.toml (SEP-1):
 * the file the issuer's home domain publishes at
 * `/.well-known/stellar.toml`. The home domain is only what the issuer's
 * account declares; the link counts only when the file at that domain also
 * lists this asset code with this issuer, so each side names the other.
 */
export interface AssetCheck {
  confirmed: boolean;
  /** The domain answered, but with no stellar.toml. */
  missing?: true;
  /** The asset's name, as the file gives it, when confirmed. */
  name?: string;
}
export type StellarAssetInfo = (homeDomain: string, code: string, issuer: string) => Promise<AssetCheck | undefined>;

const DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MAX_FILE_BYTES = 102_400;
const TIMEOUT_MS = 10_000;

/** Fetches and reads a home domain's stellar.toml. Any failure is no answer, never an error. */
export function stellarTomlCheck(): StellarAssetInfo {
  return async (homeDomain, code, issuer) => {
    const domain = homeDomain.toLowerCase();
    if (!DOMAIN.test(domain)) return undefined;
    try {
      const response = await fetch(`https://${domain}/.well-known/stellar.toml`, { credentials: 'omit', redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) });
      // A redirect is followed only to the same domain or its www. form: anywhere else is not that domain's file.
      const landed = new URL(response.url || `https://${domain}/`);
      if (landed.protocol !== 'https:' || (landed.hostname !== domain && landed.hostname !== `www.${domain}`)) return undefined;
      if (response.status === 404) return { confirmed: false, missing: true };
      if (!response.ok) return undefined;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > MAX_FILE_BYTES) return undefined;
      const file = parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as { CURRENCIES?: unknown };
      const currencies = Array.isArray(file.CURRENCIES) ? (file.CURRENCIES as Record<string, unknown>[]) : [];
      const listed = currencies.find((currency) => currency.code === code && currency.issuer === issuer);
      if (listed === undefined) return { confirmed: false };
      const name = typeof listed.name === 'string' && /^[\p{L}\p{N} .,&()'-]{1,60}$/u.test(listed.name) ? listed.name : undefined;
      return { confirmed: true, ...(name === undefined ? {} : { name }) };
    } catch {
      return undefined;
    }
  };
}
