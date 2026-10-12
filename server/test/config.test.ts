// #274: a worker that is not explicitly local, preview or production serves nothing, and the published local ECVRF seed is
// refused anywhere but local. The shape of wrangler.jsonc that makes a bare deploy land here is held by
// scripts/__tests__/wrangler-config.test.ts.
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { preparePull } from '../src/pulls';
import { PUBLISHED_LOCAL_SEED, resolveVrf } from '../src/randomness';
import type { Env, PullRow } from '../src/types';

const localEnv = env as unknown as Env;
const call = (path: string, over: Partial<Record<keyof Env, unknown>>) =>
  worker.fetch(new Request(`http://example.test${path}`, { headers: { 'x-dev-user': 'config-test' } }), { ...localEnv, ...over } as Env);

describe('a worker with no known environment serves nothing', () => {
  it('the local profile answers (the control)', async () => {
    expect((await call('/health', {})).status).toBe(200);
  });

  it('what a bare deploy has, no ENVIRONMENT and no modes, is refused on every route, /health and preflight included', async () => {
    const bare = { ENVIRONMENT: undefined, AUTH_MODE: undefined, PAYMENTS_MODE: undefined };
    for (const path of ['/health', '/me', '/odds']) {
      const response = await call(path, bare);
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ code: 'UNKNOWN', message: 'This API is not configured' });
    }
    const preflight = await worker.fetch(new Request('http://example.test/me', { method: 'OPTIONS' }), { ...localEnv, ...bare } as unknown as Env);
    expect(preflight.status).toBe(503);
  });

  it('a mode outside its known values is refused, not left to fall through every branch', async () => {
    for (const over of [{ ENVIRONMENT: 'staging' }, { AUTH_MODE: 'Dev' }, { PAYMENTS_MODE: 'free' }, { ENVIRONMENT: '' }]) {
      expect((await call('/me', over)).status).toBe(503);
    }
  });
});

describe('the published local ECVRF seed', () => {
  const pull = {
    id: 'pull_config_test', user_id: 'u', sequence: 1, gacha_id: 'all-cards', inventory_version: 1,
    odds_config_id: 'o', free_odds_config_id: 'f', client_seed: '00'.repeat(32),
  } as PullRow;
  const OTHER_SEED = 'ff'.repeat(32);
  const asBase64Url = (hex: string) => btoa(String.fromCharCode(...hex.match(/../g)!.map((b) => parseInt(b, 16))))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  it('is what wrangler.jsonc gives the local profile, and proves there', async () => {
    expect(localEnv.ECVRF_SECRET_SEED).toBe(PUBLISHED_LOCAL_SEED);
    await expect(resolveVrf(localEnv, pull)).resolves.toMatchObject({ outputBytes: expect.any(Uint8Array) });
  });

  it('is refused in preview and production, in either encoding', async () => {
    for (const ENVIRONMENT of ['preview', 'production'] as const) {
      for (const seed of [PUBLISHED_LOCAL_SEED, PUBLISHED_LOCAL_SEED.toUpperCase(), asBase64Url(PUBLISHED_LOCAL_SEED)]) {
        await expect(resolveVrf({ ...localEnv, ENVIRONMENT, ECVRF_SECRET_SEED: seed }, pull))
          .rejects.toMatchObject({ code: 'UNKNOWN', status: 503, message: 'ECVRF proving key is the published local one' });
      }
    }
  });

  it('a pull is refused at prepare, before anything is reserved or paid, when commit could not resolve it', async () => {
    const db = localEnv.DB;
    await db.prepare("INSERT OR REPLACE INTO users (id, wallet, country, free_paid, created_at) VALUES ('seed-user', 'w', 'MY', 3, '2026-01-01T00:00:00.000Z')").run();
    for (const over of [{ ECVRF_SECRET_SEED: PUBLISHED_LOCAL_SEED }, { ECVRF_SECRET_SEED: undefined }, { ECVRF_SECRET_SEED: 'not-a-seed' }]) {
      await expect(preparePull(db, { ...localEnv, ENVIRONMENT: 'preview', ...over } as Env, 'seed-user',
        { gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC' }, crypto.randomUUID()))
        .rejects.toMatchObject({ code: 'UNKNOWN', status: 503 });
    }
    const after = await db.prepare("SELECT free_paid, (SELECT COUNT(*) FROM pulls WHERE user_id = 'seed-user') AS pulls FROM users WHERE id = 'seed-user'").first();
    expect(after).toEqual({ free_paid: 3, pulls: 0 });
  });

  it('any other seed still proves in preview and production (the control)', async () => {
    for (const ENVIRONMENT of ['preview', 'production'] as const) {
      await expect(resolveVrf({ ...localEnv, ENVIRONMENT, ECVRF_SECRET_SEED: OTHER_SEED }, pull))
        .resolves.toMatchObject({ outputBytes: expect.any(Uint8Array) });
    }
  });
});
