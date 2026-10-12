import { burnExtras, claimCompletion } from './actions';
import { authenticate, ensureUser, requireLinkedExternalSolanaWallet } from './auth';
import { albums, availability, balance, extras, funding, inventory, me, odds } from './catalog';
import { meStreak, seasonView } from './season';
import { body, errorResponse, idempotencyKey, json, requiredString, ApiError } from './http';
import { commitPull, expireAbandonedPulls, preparePull } from './pulls';
import { requireAdmin, updateGachaInventory } from './admin';
import { claimFaucet, faucetGrantWallet, faucetInfo, linkedBy } from './faucet';
import { enforceCountry, geoBlockOn } from './geo';
import { buildDeposit, submitDeposit } from './deposits';
import { assertConfigured } from './config';
import { checkLedger } from './health';
import { runRefundSweep } from './refunds';
import { drawView } from './draw';
import type { Env } from './types';

function cors(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = new Set((env.ALLOWED_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  return {
    'access-control-allow-headers': 'authorization, content-type, idempotency-key, x-dev-user',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'vary': 'Origin',
    ...(origin && allowed.has(origin) ? { 'access-control-allow-origin': origin } : {}),
  };
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  assertConfigured(env); // before anything else, /health and preflight included (#274)
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request, env) });
  if (request.method === 'GET' && path === '/health') {
    // Public and constant-cost: it claims no ledger check (#277). The ledger is checked on /admin/ledger, behind the admin key:
    // those scans grow with every paid pull, and their counts are internal (PR #303's review).
    await env.DB.prepare('SELECT 1').first();
    return json({ ok: true, rpc: env.PAYMENTS_MODE === 'mock' ? 'degraded' : 'ok' });
  }
  if (request.method === 'GET' && path === '/admin/ledger') {
    await requireAdmin(request, env);
    const ledger = await checkLedger(env.DB);
    return json({ ok: ledger.ok, checkedAt: new Date().toISOString(), violations: ledger.violations }, ledger.ok ? 200 : 503);
  }

  if (request.method === 'POST' && path === '/admin/refunds/run') {
    // The Cron Trigger's sweep, by hand (#268). Sends only when REFUNDS_ENABLED=true.
    await requireAdmin(request, env);
    return json(await runRefundSweep(env.DB, env));
  }

  const adminInventory = path.match(/^\/admin\/gachas\/([^/]+)\/inventory\/([^/]+)$/);
  if (adminInventory && (request.method === 'PUT' || request.method === 'DELETE')) {
    await requireAdmin(request, env);
    const gachaId = decodeURIComponent(adminInventory[1]);
    const inventoryKey = decodeURIComponent(adminInventory[2]);
    if (request.method === 'DELETE') return json(await updateGachaInventory(env.DB, gachaId, inventoryKey, 'remove'));
    const parsed = await body<Record<string, unknown>>(request);
    const selectionWeight = parsed.selectionWeight === undefined ? 1 : Number(parsed.selectionWeight);
    return json(await updateGachaInventory(env.DB, gachaId, inventoryKey, 'add', selectionWeight));
  }

  const auth = await authenticate(request, env);
  const requestCountry = typeof request.cf?.country === 'string' ? request.cf.country : undefined;
  if (geoBlockOn(env)) enforceCountry(requestCountry);
  await ensureUser(env, auth, requestCountry);
  const userId = auth.id;
  if (!(request.method === 'POST' && path === '/pulls/commit')) {
    await expireAbandonedPulls(env.DB, userId, new Date(), env);
  }

  if (request.method === 'GET' && path === '/me') return json(await me(env.DB, userId, geoBlockOn(env)));
  if (request.method === 'GET' && path === '/me/streak') return json(await meStreak(env.DB, userId));
  if (request.method === 'GET' && path === '/me/balance') return json(await balance(env.DB, env, userId));
  if (request.method === 'GET' && path === '/me/holdings') return json(await inventory(env.DB, userId));
  if (request.method === 'GET' && path === '/me/inventory') return json(await inventory(env.DB, userId));
  if (request.method === 'GET' && path === '/me/extras') return json(await extras(env.DB, userId));
  if (request.method === 'GET' && path === '/albums') return json(await albums(env.DB));
  const albumAvailability = path.match(/^\/albums\/([^/]+)\/availability$/);
  if (request.method === 'GET' && albumAvailability) return json(await availability(env.DB, decodeURIComponent(albumAvailability[1])));
  if (request.method === 'GET' && path === '/season') return json(await seasonView(env.DB, userId));
  if (request.method === 'GET' && path === '/odds') {
    return json(await odds(env.DB, requiredString(url.searchParams.get('gachaId'), 'gachaId')));
  }
  if (request.method === 'GET' && path === '/funding/config') {
    const user = await env.DB.prepare('SELECT wallet FROM users WHERE id = ?').bind(userId).first<{ wallet: string }>();
    if (!user) throw new ApiError('UNAUTHENTICATED', 'Account not found', 401);
    return json(funding(env, user.wallet, faucetInfo(env, await faucetGrantWallet(env.DB, userId))));
  }
  if (request.method === 'POST' && path === '/funding/faucet') {
    const parsed = await body<Record<string, unknown>>(request);
    const targetWallet = parsed.wallet === undefined
      ? undefined
      : await requireLinkedExternalSolanaWallet(env, userId, requiredString(parsed.wallet, 'wallet'));
    // A signed-but-unsent grant to another of the account's wallets goes out only while Privy still lists that wallet (#304).
    const isLinked = linkedBy((wallet) => requireLinkedExternalSolanaWallet(env, userId, wallet));
    return json(await claimFaucet(env.DB, env, userId, { targetWallet, isLinked }));
  }
  if (request.method === 'POST' && path === '/deposit/build') {
    const parsed = await body<Record<string, unknown>>(request);
    const sourceWallet = await requireLinkedExternalSolanaWallet(
      env, userId, requiredString(parsed.sourceWallet, 'sourceWallet'),
    );
    return json(await buildDeposit(env.DB, env, userId, { ...parsed, sourceWallet }, idempotencyKey(request, parsed)));
  }
  if (request.method === 'POST' && path === '/deposit/submit') {
    const parsed = await body<Record<string, unknown>>(request);
    const signedTransaction = parsed.signedTransactionBase64 === undefined
      ? undefined
      : requiredString(parsed.signedTransactionBase64, 'signedTransactionBase64', 4_096);
    return json(await submitDeposit(
      env.DB, env, userId, requiredString(parsed.depositId, 'depositId'), signedTransaction,
    ));
  }

  if (request.method === 'POST' && path === '/pulls/prepare') {
    const parsed = await body<Record<string, unknown>>(request);
    return json(await preparePull(env.DB, env, userId, parsed, idempotencyKey(request, parsed)));
  }
  if (request.method === 'POST' && path === '/pulls/commit') {
    const parsed = await body<Record<string, unknown>>(request);
    const pullId = requiredString(parsed.pullId, 'pullId');
    const signature = parsed.txSignature === undefined ? undefined : requiredString(parsed.txSignature, 'txSignature');
    const signedTransaction = parsed.signedTransactionBase64 === undefined
      ? undefined
      : requiredString(parsed.signedTransactionBase64, 'signedTransactionBase64', 4_096);
    return json(await commitPull(env.DB, env, userId, pullId, signature, signedTransaction));
  }
  const pullDraw = path.match(/^\/pulls\/([^/]+)\/draw$/);
  if (request.method === 'GET' && pullDraw) return json(await drawView(env.DB, env, userId, decodeURIComponent(pullDraw[1])));
  if (request.method === 'POST' && path === '/completion-claims') {
    const parsed = await body<Record<string, unknown>>(request);
    return json(await claimCompletion(env.DB, env, userId, requiredString(parsed.albumId, 'albumId'), idempotencyKey(request, parsed)));
  }
  if (request.method === 'POST' && path === '/burns') {
    const parsed = await body<Record<string, unknown>>(request);
    return json(await burnExtras(env.DB, userId, idempotencyKey(request, parsed), env.PAYMENTS_MODE === 'mock'));
  }
  if (request.method === 'POST' && path === '/account/delete') {
    const now = new Date();
    const graceUntil = new Date(now.getTime() + 30 * 86_400_000).toISOString();
    await env.DB.prepare('UPDATE users SET deletion_requested_at = ? WHERE id = ?').bind(now.toISOString(), userId).run();
    return json({ graceUntil });
  }
  throw new ApiError('UNKNOWN', 'Route not found', 404);
}

export default {
  /** The refund sweep (#268), on the Cron Trigger in wrangler.jsonc. A failed sweep is logged and simply runs again next time. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    assertConfigured(env);
    ctx.waitUntil(runRefundSweep(env.DB, env).then(
      (result) => console.log('refund sweep', JSON.stringify(result)),
      (error) => console.error('refund sweep failed', String(error)),
    ));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response;
    try { response = await route(request, env); }
    catch (error) { response = errorResponse(error); }
    const withCors = new Response(response.body, response);
    for (const [name, value] of Object.entries(cors(request, env))) withCors.headers.set(name, value);
    return withCors;
  },
} satisfies ExportedHandler<Env>;
