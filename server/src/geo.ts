import { ApiError } from './http';
import type { Env } from './types';

// Keep this launch list aligned with src/config/geo.ts. Cloudflare supplies ISO 3166-1 alpha-2
// country codes; UK is accepted defensively even though the standard code is GB.
const BLOCKED = new Set(['US', 'GB', 'UK', 'CN', 'BE', 'NL', 'JP']);

export function isBlockedCountry(country: string | undefined): boolean {
  return !!country && BLOCKED.has(country.trim().toUpperCase());
}

/** `GEO_BLOCK: "off"` lifts the block on mainnet-dev, for the Solana Mobile CLOCK IN judges (Ben, 11 Oct 2026). Unset, or
 *  any other value, blocks: every other environment answers exactly as at launch. */
export function geoBlockOn(env: Pick<Env, 'GEO_BLOCK'>): boolean {
  return env.GEO_BLOCK !== 'off';
}

export function enforceCountry(country: string | undefined): void {
  if (isBlockedCountry(country)) {
    throw new ApiError('GEO_BLOCKED', 'Gachapon is not available in your country', 451);
  }
}
