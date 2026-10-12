import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';
import { createHttpApi, type HttpApiOptions } from './http';
import { ApiError } from './errors';

const mk = (fetchImpl: typeof fetch, opts: Partial<HttpApiOptions> = {}) => createHttpApi({ baseUrl: 'https://api.test', getAccessToken: async () => 'tok', fetchImpl, ...opts });
const response = (status: number, body: string, headers: Record<string, string> = {}) => ({ status, ok: status >= 200 && status < 300, text: async () => body, headers } as unknown as Response);

describe('http client error mapping', () => {
  test('a proxy error page (non-JSON) is UNREADABLE with the status, not a SyntaxError', async () => {
    const api = mk(async () => response(502, '<html>Bad gateway</html>'));
    await expect(api.me()).rejects.toMatchObject({ name: 'ApiError', code: 'UNREADABLE', status: 502 });
  });
  test('a truncated 200 body is UNREADABLE too: the commit may have landed', async () => {
    const api = mk(async () => response(200, '{"outcomes":[{"card'));
    const err = await api.commitPull({ pullId: 'p' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'UNREADABLE', status: 200 });
  });
  test('a network failure is NETWORK; 401 is UNAUTHENTICATED; JSON errors keep their code', async () => {
    await expect(mk(async () => { throw new TypeError('Network request failed'); }).me()).rejects.toMatchObject({ code: 'NETWORK' });
    await expect(mk(async () => response(401, '')).me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    await expect(mk(async () => response(402, JSON.stringify({ code: 'INSUFFICIENT_FUNDS', message: 'Out of pulls' }))).preparePull({ gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', idem: 'i' })).rejects.toMatchObject({ code: 'INSUFFICIENT_FUNDS', status: 402 });
  });
  test('state-changing POSTs carry the Idempotency-Key header and a Bearer token', async () => {
    let seen: RequestInit | undefined;
    const api = mk(async (_url, init) => { seen = init; return response(200, '{"extras":0,"freePulls":1}'); });
    await api.burn({ idem: 'abc' });
    const h = seen?.headers as Record<string, string>;
    expect(h['Idempotency-Key']).toBe('abc');
    expect(h.Authorization).toBe('Bearer tok');
  });
  test('a missing login token is rejected before any API request leaves the app', async () => {
    let calls = 0;
    const api = mk(async () => { calls++; return response(200, '{}'); }, { getAccessToken: async () => null });
    await expect(api.me()).rejects.toMatchObject({ code: 'UNAUTHENTICATED', status: 401 });
    expect(calls).toBe(0);
  });
});

describe('http client timeout', () => {
  const never = <T>() => new Promise<T>(() => {});
  const withTimeout = (fetchImpl: typeof fetch, opts: Partial<HttpApiOptions> = {}) => mk(fetchImpl, { timeoutMs: 20, ...opts });
  /** What `pending` settles to once the 20 ms deadline has passed: its value, or the error it rejected with. */
  const pastDeadline = async (pending: Promise<unknown>) => {
    const settled = pending.then((v) => v, (e: unknown) => e);
    await jest.advanceTimersByTimeAsync(20);
    return settled;
  };
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  test('a request nobody answers fails as NETWORK instead of hanging, and its fetch is aborted', async () => {
    let signal: AbortSignal | null | undefined;
    const api = withTimeout(async (_url, init) => { signal = init?.signal; return never(); });
    expect(await pastDeadline(api.deleteAccount())).toMatchObject({ name: 'ApiError', code: 'NETWORK', message: 'Request timed out' });
    expect(signal?.aborted).toBe(true);
  });

  test('a body that never finishes arriving fails as NETWORK too', async () => {
    const api = withTimeout(async () => ({ ...response(200, ''), text: () => never<string>() }));
    expect(await pastDeadline(api.me())).toMatchObject({ code: 'NETWORK', message: 'Request timed out' });
  });

  test('a body the deadline aborts reads as a timeout, not as an unreadable response', async () => {
    const api = withTimeout(async (_url, init) => ({
      ...response(200, ''),
      text: () => new Promise<string>((_resolve, reject) => { init?.signal?.addEventListener('abort', () => reject(new Error('The operation was aborted'))); }),
    }));
    expect(await pastDeadline(api.me())).toMatchObject({ code: 'NETWORK', message: 'Request timed out' });
  });

  test('a token that never arrives fails as NETWORK and sends nothing', async () => {
    let calls = 0;
    const api = withTimeout(async () => { calls++; return response(200, '{}'); }, { getAccessToken: () => never() });
    expect(await pastDeadline(api.me())).toMatchObject({ code: 'NETWORK', message: 'Request timed out' });
    expect(calls).toBe(0);
  });

  test('an answered request leaves no timer behind', async () => {
    await expect(mk(async () => response(200, '{"graceUntil":"2026-10-11T12:00:00.000Z"}')).deleteAccount()).resolves.toEqual({ graceUntil: '2026-10-11T12:00:00.000Z' });
    expect(jest.getTimerCount()).toBe(0);
  });

  test('every failure path leaves no timer behind', async () => {
    const failures: (() => Promise<unknown>)[] = [
      () => mk(async () => response(401, '')).me(),
      () => mk(async () => response(402, JSON.stringify({ code: 'INSUFFICIENT_FUNDS', message: 'Out of pulls' }))).me(),
      () => mk(async () => { throw new TypeError('Network request failed'); }).me(),
      () => mk(async () => response(502, '<html>Bad gateway</html>')).me(),
      () => mk(async () => response(200, '{}'), { getAccessToken: async () => { throw new Error('no session'); } }).me(),
    ];
    for (const fail of failures) {
      await expect(fail()).rejects.toBeTruthy();
      expect(jest.getTimerCount()).toBe(0);
    }
  });

  test('the default deadline is 30 s', async () => {
    let outcome: unknown = 'pending';
    mk(async () => never()).me().then(() => { outcome = 'answered'; }, (e: unknown) => { outcome = e; });
    await jest.advanceTimersByTimeAsync(29_999);
    expect(outcome).toBe('pending');
    await jest.advanceTimersByTimeAsync(1);
    expect(outcome).toMatchObject({ code: 'NETWORK', message: 'Request timed out' });
  });
});
