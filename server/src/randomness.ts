import { SecretKey } from '@blueshift-gg/solana-ecvrf';
import { bytesToHex, framed, hexToBytes, sha256 } from './drawDerive';
import { ApiError } from './http';
import type { Env, PullRow } from './types';

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (char) => char.charCodeAt(0));
}

function decode32(value: string, name: string): Uint8Array {
  try {
    const bytes = /^[0-9a-f]{64}$/i.test(value) ? hexToBytes(value) : base64UrlToBytes(value);
    if (bytes.length !== 32) throw new Error('wrong length');
    return bytes;
  } catch {
    throw new ApiError('UNKNOWN', `${name} must encode exactly 32 bytes`, 400);
  }
}

/** The same 32 bytes, whichever encoding each side is written in (hex or base64url); `false` if either does not decode. */
function sameSeed(a: string, b: string): boolean {
  try {
    const x = decode32(a, 'seed');
    const y = decode32(b, 'seed');
    return x.every((byte, i) => byte === y[i]);
  } catch {
    return false;
  }
}

export function normalizeClientSeed(value: unknown): { value: string; source: 'client' | 'server' } {
  if (typeof value === 'string' && value.length > 0) {
    return { value: bytesToHex(decode32(value, 'clientSeed')), source: 'client' };
  }
  return { value: bytesToHex(crypto.getRandomValues(new Uint8Array(32))), source: 'server' };
}

export type VrfResolution = {
  publicKey: string;
  input: string;
  proof: string;
  output: string;
  outputBytes: Uint8Array;
};

/** The local profile's seed, committed in wrangler.jsonc so tests and `wrangler dev` are deterministic. Anyone can read it, so
 *  anyone could compute a pull's outcome from its prepare-time inputs: outside local it is refused (#274), and a deployed
 *  environment must set its own `ECVRF_SECRET_SEED` as a secret. */
export const PUBLISHED_LOCAL_SEED = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';

/** The environment's ECVRF proving key, or a 503: missing, undecodable, or the published local seed outside local. Called at
 *  prepare as well as at commit (#274, PR #297's review): a key that commit would refuse must refuse before the user is asked
 *  to pay, not after the payment is recorded. */
export function provingKey(env: Env): SecretKey {
  const configured = env.ECVRF_SECRET_SEED;
  if (!configured) throw new ApiError('UNKNOWN', 'ECVRF proving key is not configured', 503);
  if (env.ENVIRONMENT !== 'local' && sameSeed(configured, PUBLISHED_LOCAL_SEED)) {
    throw new ApiError('UNKNOWN', 'ECVRF proving key is the published local one', 503);
  }
  try {
    return SecretKey.fromSeed(decode32(configured, 'ECVRF_SECRET_SEED'));
  } catch (error) {
    if (error instanceof ApiError) throw new ApiError('UNKNOWN', error.message, 503);
    throw new ApiError('UNKNOWN', 'ECVRF proving key is invalid', 503);
  }
}

export async function resolveVrf(env: Env, pull: PullRow): Promise<VrfResolution> {
  const key = provingKey(env);
  const inputBytes = await sha256(framed([
    'gachapon:pull:v1',
    env.ENVIRONMENT,
    pull.id,
    pull.user_id,
    String(pull.sequence),
    pull.gacha_id,
    String(pull.inventory_version),
    pull.odds_config_id,
    pull.free_odds_config_id,
    pull.client_seed,
  ]));
  const proof = key.prove(inputBytes);
  // Verify our own proof before it is allowed to influence inventory. This
  // also produces the RFC 9381 beta output used as the random oracle root.
  const outputBytes = proof.verify(key.publicKey, inputBytes);
  return {
    publicKey: key.publicKey.toString(),
    input: bytesToHex(inputBytes),
    proof: bytesToHex(proof.bytes),
    output: bytesToHex(outputBytes),
    outputBytes,
  };
}

export { RandomOracle } from './drawDerive';
