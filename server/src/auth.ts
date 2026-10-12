import {
  PrivyClient,
  type User as PrivyUser,
  type VerifyAccessTokenResponse,
} from '@privy-io/node';
import { address } from '@solana/kit';
import { ApiError } from './http';
import type { AuthUser, Env } from './types';

type PrivyWallet = { id: string; address: string };

export interface IdentityProvider {
  verify(accessToken: string, env: Env): Promise<VerifyAccessTokenResponse>;
  user(userId: string, env: Env): Promise<PrivyUser>;
}

let cachedClient: { appId: string; appSecret: string; verificationKey?: string; client: PrivyClient } | undefined;

function required(value: string | undefined, name: string): string {
  if (!value || value.startsWith('REPLACE_WITH_')) {
    throw new ApiError('UNAUTHENTICATED', `Privy ${name} is not configured`, 503);
  }
  return value;
}

function verificationKey(env: Env): string | undefined {
  // Wrangler secrets may contain either real newlines or escaped newlines.
  return env.PRIVY_VERIFICATION_KEY?.replaceAll('\\n', '\n');
}

function clientFor(env: Env): PrivyClient {
  const appId = required(env.PRIVY_APP_ID, 'app ID');
  const appSecret = required(env.PRIVY_APP_SECRET, 'app secret');
  const key = verificationKey(env);
  if (cachedClient?.appId === appId && cachedClient.appSecret === appSecret && cachedClient.verificationKey === key) {
    return cachedClient.client;
  }
  const client = new PrivyClient({ appId, appSecret, jwtVerificationKey: key });
  cachedClient = { appId, appSecret, verificationKey: key, client };
  return client;
}

const privyIdentity: IdentityProvider = {
  verify(accessToken, env) {
    return clientFor(env).utils().auth().verifyAccessToken(accessToken);
  },
  user(userId, env) {
    return clientFor(env).users()._get(userId);
  },
};

function bearer(request: Request): string {
  const authorization = request.headers.get('authorization');
  if (!authorization) throw new ApiError('UNAUTHENTICATED', 'Sign in required', 401);
  const match = /^Bearer ([^\s]+)$/.exec(authorization);
  if (!match) throw new ApiError('UNAUTHENTICATED', 'Invalid authorization header', 401);
  return match[1];
}

export async function authenticate(
  request: Request,
  env: Env,
  identity: IdentityProvider = privyIdentity,
): Promise<AuthUser> {
  if (env.AUTH_MODE === 'dev') {
    if (env.ENVIRONMENT !== 'local') {
      throw new ApiError('UNAUTHENTICATED', 'Development auth is disabled outside local development', 503);
    }
    return { id: request.headers.get('x-dev-user') || env.LOCAL_USER_ID || 'demo-user', sessionId: 'local-development' };
  }

  try {
    const verified = await identity.verify(bearer(request), env);
    return { id: verified.user_id, sessionId: verified.session_id };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UNAUTHENTICATED', 'Invalid or expired Privy access token', 401);
  }
}

/** A funding action may use an external wallet only when Privy says that wallet is linked to this
 * authenticated account. A caller cannot turn the faucet or deposit builder into an arbitrary sender. */
export async function requireLinkedExternalSolanaWallet(
  env: Env,
  userId: string,
  target: string,
  identity: IdentityProvider = privyIdentity,
): Promise<string> {
  let wanted: string;
  try { wanted = address(target); }
  catch { throw new ApiError('UNKNOWN', 'Invalid connected wallet'); }
  if (env.AUTH_MODE !== 'privy') throw new ApiError('UNAUTHENTICATED', 'Connected-wallet faucet requires Privy sign-in', 401);
  let user: PrivyUser;
  try { user = await identity.user(userId, env); }
  catch { throw new ApiError('UNAUTHENTICATED', 'Privy user directory is unavailable', 503); }
  if (user.id !== userId || user.is_guest) throw new ApiError('UNAUTHENTICATED', 'Privy account is not eligible', 401);
  const linked = user.linked_accounts.some((account) => account.type === 'wallet'
    && account.chain_type === 'solana'
    && account.address === wanted
    && 'connector_type' in account
    && account.connector_type !== 'embedded');
  if (!linked) throw new ApiError('UNAUTHENTICATED', 'Connected Solana wallet is not linked to this account', 403);
  return wanted;
}

function embeddedSolanaWallet(user: PrivyUser, expectedUserId: string): PrivyWallet {
  if (user.id !== expectedUserId || user.is_guest) {
    throw new ApiError('UNAUTHENTICATED', 'Privy account is not eligible', 401);
  }
  const embeddedWallets = user.linked_accounts
    .filter((account) => account.type === 'wallet'
      && account.chain_type === 'solana'
      && 'connector_type' in account
      && account.connector_type === 'embedded'
      && 'wallet_client_type' in account
      && account.wallet_client_type === 'privy')
    .sort((left, right) => {
      const leftIndex = 'wallet_index' in left && typeof left.wallet_index === 'number' ? left.wallet_index : Number.MAX_SAFE_INTEGER;
      const rightIndex = 'wallet_index' in right && typeof right.wallet_index === 'number' ? right.wallet_index : Number.MAX_SAFE_INTEGER;
      return leftIndex - rightIndex;
    });
  const wallet = embeddedWallets.find((candidate) => 'id' in candidate
    && typeof candidate.id === 'string'
    && candidate.id.length > 0);
  if (!wallet && embeddedWallets.length > 0) {
    throw new ApiError('UNAUTHENTICATED', 'Privy Solana wallet must be migrated to TEE execution', 409);
  }
  if (!wallet || !('id' in wallet) || typeof wallet.id !== 'string') {
    throw new ApiError('UNAUTHENTICATED', 'Privy Solana wallet has not been provisioned', 409);
  }
  try { address(wallet.address); }
  catch { throw new ApiError('UNAUTHENTICATED', 'Privy returned an invalid Solana wallet', 503); }
  return { id: wallet.id, address: wallet.address };
}

type StoredUser = {
  id: string;
  wallet: string;
  privy_wallet_id: string | null;
  privy_session_id: string | null;
  deleted_at: string | null;
};

function normalizedCountry(country: string | undefined): string {
  return country && /^[A-Z]{2}$/.test(country) ? country : 'XX';
}

export async function ensureUser(
  env: Env,
  auth: AuthUser,
  country?: string,
  identity: IdentityProvider = privyIdentity,
): Promise<void> {
  const stored = await env.DB.prepare(`SELECT id, wallet, privy_wallet_id, privy_session_id, deleted_at
    FROM users WHERE id = ?`).bind(auth.id).first<StoredUser>();
  if (stored?.deleted_at) throw new ApiError('UNAUTHENTICATED', 'Account is unavailable', 403);

  if (env.AUTH_MODE === 'dev') {
    if (!stored) throw new ApiError('UNAUTHENTICATED', 'Local development user is not seeded', 401);
    return;
  }

  // A session identifies a login. Resolve Privy's user directory once for a
  // new session, then serve requests from the authoritative D1 binding.
  if (stored?.privy_wallet_id && stored.privy_session_id === auth.sessionId) return;

  let privyUser: PrivyUser;
  try { privyUser = await identity.user(auth.id, env); }
  catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('UNAUTHENTICATED', 'Privy user directory is unavailable', 503);
  }
  const wallet = embeddedSolanaWallet(privyUser, auth.id);
  const now = new Date().toISOString();
  const userCountry = normalizedCountry(country);

  if (!stored) {
    // No sign-up grant (#292): free_paid and free_common are written as 0, not left to the table default. A D1 whose users
    // table predates #321 still says DEFAULT 3 (mainnet-dev did), and SQLite cannot change a default without a rebuild.
    await env.DB.prepare(`INSERT OR IGNORE INTO users
      (id, privy_wallet_id, privy_session_id, privy_synced_at, wallet, country, free_paid, free_common, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)`).bind(
      auth.id, wallet.id, auth.sessionId, now, wallet.address, userCountry, now,
    ).run();
  } else {
    try {
      await env.DB.prepare(`UPDATE users SET privy_wallet_id = ?, privy_session_id = ?, privy_synced_at = ?,
        wallet = ?, country = ? WHERE id = ? AND deleted_at IS NULL`).bind(
        wallet.id, auth.sessionId, now, wallet.address, userCountry, auth.id,
      ).run();
    } catch {
      throw new ApiError('UNAUTHENTICATED', 'Privy wallet is already linked to another account', 409);
    }
  }

  const provisioned = await env.DB.prepare(`SELECT id, wallet, privy_wallet_id, privy_session_id, deleted_at
    FROM users WHERE id = ?`).bind(auth.id).first<StoredUser>();
  if (!provisioned
    || provisioned.wallet !== wallet.address
    || provisioned.privy_wallet_id !== wallet.id
    || provisioned.privy_session_id !== auth.sessionId) {
    throw new ApiError('UNAUTHENTICATED', 'Privy wallet is already linked to another account', 409);
  }
  await env.DB.prepare(`INSERT OR IGNORE INTO balances (user_id, asset, amount)
    VALUES (?, 'USDC', 0), (?, 'USDT', 0)`).bind(auth.id, auth.id).run();
}
