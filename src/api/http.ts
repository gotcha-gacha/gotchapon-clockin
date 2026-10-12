// HTTP implementation of GachaApi (F0.2): Bearer = Privy access token, Idempotency-Key on every
// state-changing POST, JSON errors → ApiError. Swapped in for the mock when EXPO_PUBLIC_API_URL is set.
import * as Crypto from 'expo-crypto';
import type {
  AccountDeleteResponse, Album, Availability, Balance, BurnRequest, BurnResponse, CompletionClaimRequest,
  CompletionClaimResponse, DepositBuildRequest, DepositBuildResponse,
  DepositSubmitRequest, DepositSubmitResponse, FaucetClaimRequest, FaucetClaimResponse, FundingConfig, GachaApi, Health, Holding,
  Me, MeStreak, Odds, PullCommitRequest, PullCommitResponse, PullDrawView, PullPrepareRequest, PullPrepareResponse, Season,
} from './contract';
import { ApiError } from './errors';

export type HttpApiOptions = {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
  /** How long a request may go unanswered before it fails as NETWORK (default 30 s). */
  timeoutMs?: number;
};

// A request nobody answers must fail rather than leave a screen waiting forever: the app's fetch (expo/fetch) sets no timeout of
// its own on Android, so a delete confirm would stay locked. A paid pull is safe to fail this way: commit is idempotent and the
// signed pull stays on the device to open again, and so do free pulls and burns (state/pendingPulls). Before real commits go over
// HTTP (F7.4), size a commit timeout from Dev 2's measured latency: the server waits for chain confirmation inside commit.
const REQUEST_TIMEOUT_MS = 30_000;
const timedOut = () => new ApiError({ code: 'NETWORK', message: 'Request timed out' });
const ignore = () => {};

export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

export function createHttpApi(opts: HttpApiOptions): GachaApi {
  const f = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;

  async function call<T>(method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<T> {
    // Every step (token, request, body) races one deadline; aborting also cancels the request where fetch supports it.
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(timedOut()); }, timeoutMs);
    });
    deadline.catch(ignore); // whichever step is racing it sees the rejection
    const within = <V>(work: Promise<V>) => Promise.race([work, deadline]);
    try {
      const headers: Record<string, string> = { Accept: 'application/json' };
      const token = await within(opts.getAccessToken());
      if (!token) throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Sign in required' }, 401);
      headers.Authorization = `Bearer ${token}`;
      let payload: string | undefined;
      if (method === 'POST') {
        const idem = typeof body?.idem === 'string' ? body.idem : newIdempotencyKey();
        headers['Content-Type'] = 'application/json';
        headers['Idempotency-Key'] = idem;
        payload = JSON.stringify({ ...body, idem });
      }
      let res: Response;
      try {
        res = await within(f(`${base}${path}`, { method, headers, body: payload, signal: controller.signal }));
      } catch (e) {
        throw new ApiError({ code: 'NETWORK', message: e instanceof Error ? e.message : 'Network request failed' });
      }
      if (res.status === 401) throw new ApiError({ code: 'UNAUTHENTICATED', message: 'Signed out' }, 401);
      let json: unknown = null;
      try {
        const text = await within(res.text());
        json = text ? (JSON.parse(text) as unknown) : null;
      } catch {
        // A proxy error page or a truncated body: the request went out and we cannot read what came back, so this is its own
        // code — a free pull or a burn that answers this way is kept and opened again, exactly as a lost answer is.
        throw new ApiError({ code: 'UNREADABLE', message: `Unreadable response (HTTP ${res.status})` }, res.status);
      }
      if (!res.ok) {
        const err = (json ?? {}) as Partial<{ code: string; message: string; hint: string }>;
        throw new ApiError(
          { code: (err.code as ApiError['code']) ?? 'UNKNOWN', message: err.message ?? `HTTP ${res.status}`, hint: err.hint },
          res.status,
        );
      }
      return json as T;
    } catch (e) {
      // Once the deadline has passed, whatever a step reported (a network error, an unreadable body) is a timeout.
      if (controller.signal.aborted) throw timedOut();
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    me: () => call<Me>('GET', '/me'),
    balance: () => call<Balance>('GET', '/me/balance'),
    holdings: () => call<Holding[]>('GET', '/me/inventory'),
    extras: () => call<{ count: number }>('GET', '/me/extras'),
    albums: () => call<Album[]>('GET', '/albums'),
    availability: (albumId) => call<Availability>('GET', `/albums/${encodeURIComponent(albumId)}/availability`),
    odds: (gachaId) => call<Odds>('GET', `/odds?gachaId=${encodeURIComponent(gachaId)}`),
    season: () => call<Season>('GET', '/season'),
    streak: () => call<MeStreak>('GET', '/me/streak'),
    preparePull: (req: PullPrepareRequest) => call<PullPrepareResponse>('POST', '/pulls/prepare', req),
    commitPull: (req: PullCommitRequest) => call<PullCommitResponse>('POST', '/pulls/commit', req),
    pullDraw: (pullId: string) => call<PullDrawView>('GET', `/pulls/${encodeURIComponent(pullId)}/draw`),
    burn: (req: BurnRequest) => call<BurnResponse>('POST', '/burns', req),
    claimCompletion: (req: CompletionClaimRequest) => call<CompletionClaimResponse>('POST', '/completion-claims', req),
    deleteAccount: () => call<AccountDeleteResponse>('POST', '/account/delete', {}),
    fundingConfig: () => call<FundingConfig>('GET', '/funding/config'),
    claimFaucet: (req: FaucetClaimRequest = {}) => call<FaucetClaimResponse>('POST', '/funding/faucet', req),
    buildDeposit: (req: DepositBuildRequest) => call<DepositBuildResponse>('POST', '/deposit/build', req),
    submitDeposit: (req: DepositSubmitRequest) => call<DepositSubmitResponse>('POST', '/deposit/submit', req),
    health: () => call<Health>('GET', '/health'),
  };
}
