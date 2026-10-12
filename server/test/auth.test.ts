import { env } from 'cloudflare:workers';
import type { User as PrivyUser, VerifyAccessTokenResponse } from '@privy-io/node';
import { beforeEach, describe, expect, it } from 'vitest';
import { authenticate, ensureUser, requireLinkedExternalSolanaWallet, type IdentityProvider } from '../src/auth';
import worker from '../src/index';
import type { Env } from '../src/types';

const testEnv = env as unknown as Env;
const appId = 'test-privy-app';
const userId = 'did:privy:test-user';
const walletAddress = 'So11111111111111111111111111111111111111112';

function productionEnv(overrides: Partial<Env> = {}): Env {
  return {
    ...testEnv,
    ENVIRONMENT: 'production',
    AUTH_MODE: 'privy',
    PRIVY_APP_ID: appId,
    ...overrides,
  };
}

function verified(id = userId, sessionId = 'session-1'): VerifyAccessTokenResponse {
  return {
    app_id: appId,
    issuer: 'privy.io',
    issued_at: Math.floor(Date.now() / 1_000),
    expiration: Math.floor(Date.now() / 1_000) + 3_600,
    session_id: sessionId,
    user_id: id,
  };
}

function privyUser(id = userId, address = walletAddress, walletId: string | null = 'privy-wallet-1'): PrivyUser {
  return {
    id,
    created_at: Math.floor(Date.now() / 1_000),
    has_accepted_terms: true,
    is_guest: false,
    mfa_methods: [],
    linked_accounts: [{
      id: walletId,
      address,
      chain_id: 'solana:mainnet',
      chain_type: 'solana',
      connector_type: 'embedded',
      delegated: false,
      first_verified_at: null,
      imported: false,
      latest_verified_at: null,
      public_key: address,
      recovery_method: 'privy-v2',
      type: 'wallet',
      verified_at: Math.floor(Date.now() / 1_000),
      wallet_client: 'privy',
      wallet_client_type: 'privy',
      wallet_index: 0,
      user_can_sign: true,
    }],
  };
}

function request(token = 'access-token'): Request {
  return new Request('https://api.example/me', { headers: { authorization: `Bearer ${token}` } });
}

function base64url(value: string | Uint8Array): string {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function signedAccessToken(audience = appId): Promise<{ token: string; publicKey: string }> {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const now = Math.floor(Date.now() / 1_000);
  const header = base64url(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    aud: audience,
    exp: now + 3_600,
    iat: now,
    iss: 'privy.io',
    sid: 'real-signature-session',
    sub: userId,
  }));
  const message = `${header}.${payload}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(message),
  ));
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', keys.publicKey));
  const encoded = base64url(spki).replaceAll('-', '+').replaceAll('_', '/');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  const lines = padded.match(/.{1,64}/g)?.join('\n') ?? padded;
  return { token: `${message}.${base64url(signature)}`, publicKey: `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----` };
}

beforeEach(async () => {
  await testEnv.DB.exec('DELETE FROM season_streak_grants; DELETE FROM season_streaks; DELETE FROM season_ticket_grants; DELETE FROM season_ticket_balances; DELETE FROM deposits; DELETE FROM faucet_grants; DELETE FROM balances; DELETE FROM users;');
});

describe('Privy API authentication', () => {
  it('allows faucet targeting only for an external Solana wallet linked to the authenticated account', async () => {
    const externalAddress = '11111111111111111111111111111111';
    const external = {
      ...privyUser().linked_accounts[0],
      id: 'external-wallet',
      address: externalAddress,
      public_key: externalAddress,
      connector_type: 'injected' as const,
      wallet_client: 'phantom',
      wallet_client_type: 'phantom',
    };
    const identity: IdentityProvider = {
      async verify() { return verified(); },
      async user() { return { ...privyUser(), linked_accounts: [...privyUser().linked_accounts, external] } as PrivyUser; },
    };
    await expect(requireLinkedExternalSolanaWallet(productionEnv(), userId, externalAddress, identity))
      .resolves.toBe(externalAddress);
    await expect(requireLinkedExternalSolanaWallet(productionEnv(), userId, walletAddress, identity))
      .rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 403 });
  });

  it('keeps health public but rejects every application route without a login', async () => {
    const configured = productionEnv();
    expect((await worker.fetch(new Request('https://api.example/health'), configured)).status).toBe(200);
    const response = await worker.fetch(new Request('https://api.example/albums'), configured);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: 'UNAUTHENTICATED', message: 'Sign in required' });
  });

  it('verifies the login and provisions the authoritative embedded Solana wallet once per session', async () => {
    let userLookups = 0;
    const identity: IdentityProvider = {
      async verify(token) {
        expect(token).toBe('access-token');
        return verified();
      },
      async user(id) {
        userLookups++;
        return privyUser(id);
      },
    };
    const configured = productionEnv();
    const first = await authenticate(request(), configured, identity);
    await ensureUser(configured, first, 'AU', identity);
    const second = await authenticate(request(), configured, identity);
    await ensureUser(configured, second, 'AU', identity);

    expect(userLookups).toBe(1);
    expect(await testEnv.DB.prepare(`SELECT id, privy_wallet_id, privy_session_id, wallet, country, free_paid, free_common
      FROM users WHERE id = ?`).bind(userId).first()).toMatchObject({
      id: userId,
      privy_wallet_id: 'privy-wallet-1',
      privy_session_id: 'session-1',
      wallet: walletAddress,
      country: 'AU',
      free_paid: 0,
      free_common: 0,
    });
    expect(await testEnv.DB.prepare('SELECT COUNT(*) AS count FROM balances WHERE user_id = ?')
      .bind(userId).first()).toMatchObject({ count: 2 });
  });

  it('a new account starts with no free pulls even where the users table still defaults free_paid to 3 (#292)', async () => {
    // mainnet-dev's users table predates #321 and still says DEFAULT 3; SQLite cannot change a default in place.
    const current = (await testEnv.DB.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
      .first<{ sql: string }>())!.sql;
    const old = current.replace('free_paid INTEGER NOT NULL DEFAULT 0', 'free_paid INTEGER NOT NULL DEFAULT 3');
    expect(old).not.toBe(current);
    await testEnv.DB.batch([testEnv.DB.prepare('DROP TABLE users'), testEnv.DB.prepare(old)]);
    try {
      expect(await testEnv.DB.prepare("SELECT dflt_value FROM pragma_table_info('users') WHERE name = 'free_paid'").first())
        .toEqual({ dflt_value: '3' }); // the rebuild took
      const identity: IdentityProvider = { async verify() { return verified(); }, async user(id) { return privyUser(id); } };
      const configured = productionEnv();
      await ensureUser(configured, await authenticate(request(), configured, identity), 'MY', identity);
      expect(await testEnv.DB.prepare('SELECT free_paid, free_common FROM users WHERE id = ?').bind(userId).first())
        .toEqual({ free_paid: 0, free_common: 0 });
    } finally {
      // D1 here is per file, not per test: put the real table back for the tests after this one.
      await testEnv.DB.batch([testEnv.DB.prepare('DELETE FROM users'), testEnv.DB.prepare('DROP TABLE users'), testEnv.DB.prepare(current)]);
    }
  });

  it('does not let two Privy users claim the same wallet', async () => {
    const configured = productionEnv();
    const identity = (id: string, walletId: string): IdentityProvider => ({
      async verify() { return verified(id, `session-${id}`); },
      async user() { return privyUser(id, walletAddress, walletId); },
    });
    const firstIdentity = identity('did:privy:first', 'wallet-first');
    const first = await authenticate(request(), configured, firstIdentity);
    await ensureUser(configured, first, 'AU', firstIdentity);

    const secondIdentity = identity('did:privy:second', 'wallet-second');
    const second = await authenticate(request(), configured, secondIdentity);
    await expect(ensureUser(configured, second, 'AU', secondIdentity)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED', status: 409,
    });
  });

  it('re-resolves the authoritative wallet on a new Privy login session', async () => {
    let sessionId = 'session-1';
    let address = walletAddress;
    let walletId = 'privy-wallet-1';
    const identity: IdentityProvider = {
      async verify() { return verified(userId, sessionId); },
      async user() { return privyUser(userId, address, walletId); },
    };
    const configured = productionEnv();
    const first = await authenticate(request(), configured, identity);
    await ensureUser(configured, first, 'AU', identity);

    sessionId = 'session-2';
    address = '11111111111111111111111111111111';
    walletId = 'privy-wallet-2';
    const second = await authenticate(request(), configured, identity);
    await ensureUser(configured, second, 'NZ', identity);

    expect(await testEnv.DB.prepare(`SELECT privy_wallet_id, privy_session_id, wallet, country
      FROM users WHERE id = ?`).bind(userId).first()).toMatchObject({
      privy_wallet_id: walletId,
      privy_session_id: sessionId,
      wallet: address,
      country: 'NZ',
    });
  });

  it('rejects a login until Privy has provisioned an embedded Solana wallet', async () => {
    const identity: IdentityProvider = {
      async verify() { return verified(); },
      async user() { return { ...privyUser(), linked_accounts: [] }; },
    };
    const configured = productionEnv();
    const auth = await authenticate(request(), configured, identity);
    await expect(ensureUser(configured, auth, 'AU', identity)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED', status: 409,
    });
  });

  it('rejects a legacy embedded wallet until Privy migrates it to TEE execution', async () => {
    const identity: IdentityProvider = {
      async verify() { return verified(); },
      async user() { return privyUser(userId, walletAddress, null); },
    };
    const configured = productionEnv();
    const auth = await authenticate(request(), configured, identity);

    await expect(ensureUser(configured, auth, 'AU', identity)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      message: 'Privy Solana wallet must be migrated to TEE execution',
      status: 409,
    });
  });

  it('uses Privy official ES256 verification and enforces the app audience', async () => {
    const valid = await signedAccessToken();
    await expect(authenticate(request(valid.token), productionEnv({
      PRIVY_APP_SECRET: 'test-secret',
      PRIVY_VERIFICATION_KEY: valid.publicKey,
    }))).resolves.toEqual({ id: userId, sessionId: 'real-signature-session' });

    const wrongAudience = await signedAccessToken('another-app');
    await expect(authenticate(request(wrongAudience.token), productionEnv({
      PRIVY_APP_SECRET: 'test-secret',
      PRIVY_VERIFICATION_KEY: wrongAudience.publicKey,
    }))).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
  });
});

describe('development auth', () => {
  // The server half of the client's LOCAL_DEV_TOKEN (PR #257): dev auth answers without reading the token, so it must never
  // be honoured anywhere but a local worker.
  const devRequest = () => new Request('http://example.test/me', { headers: { authorization: 'Bearer local-dev-auth' } });
  it('is refused outside ENVIRONMENT=local, whatever the token', async () => {
    for (const ENVIRONMENT of ['preview', 'production', undefined]) {
      await expect(authenticate(devRequest(), { ...testEnv, AUTH_MODE: 'dev', ENVIRONMENT } as Env))
        .rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    }
  });
  it('answers as the local user on a local worker (the control)', async () => {
    await expect(authenticate(devRequest(), { ...testEnv, AUTH_MODE: 'dev', ENVIRONMENT: 'local' } as Env))
      .resolves.toMatchObject({ id: 'demo-user' });
  });
});
