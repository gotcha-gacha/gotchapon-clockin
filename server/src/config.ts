import { ApiError } from './http';
import type { Env } from './types';

const ENVIRONMENTS = new Set(['local', 'preview', 'production']);
const AUTH_MODES = new Set(['dev', 'privy']);
const PAYMENTS_MODES = new Set(['mock', 'solana-rpc']);

/**
 * Refuses every request from a worker whose environment is not one of the three it was written for (#274). wrangler.jsonc
 * has no top-level vars, so a bare `wrangler deploy` (no `--env`) publishes a worker with no ENVIRONMENT at all: this is
 * what makes that worker inert, instead of a worker serving whatever defaults the code falls back to. The modes are held to
 * their known values for the same reason: a typo in one must not fall through to neither branch.
 */
export function assertConfigured(env: Partial<Pick<Env, 'ENVIRONMENT' | 'AUTH_MODE' | 'PAYMENTS_MODE'>>): void {
  if (!ENVIRONMENTS.has(env.ENVIRONMENT ?? '') || !AUTH_MODES.has(env.AUTH_MODE ?? '') || !PAYMENTS_MODES.has(env.PAYMENTS_MODE ?? '')) {
    throw new ApiError('UNKNOWN', 'This API is not configured', 503);
  }
}
