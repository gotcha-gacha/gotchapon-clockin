// The web half of mockAuthLocalDev.test.ts (PR #257's round-2 review): in a browser `@/auth/privy` resolves to privy.web.ts,
// where an app id alone configures Privy (AuthProvider.web.tsx loads it), so the local placeholder must not be installed then.
// It is installed at import, so each case loads the modules fresh.
import { afterEach, expect, jest, test } from '@jest/globals';

type Api = typeof import('@/api');

async function tokenFor(opts: { usingMock: boolean; dev: boolean; appId?: boolean }): Promise<string | null> {
  const wasDev = (global as { __DEV__?: boolean }).__DEV__;
  const wasEnv = { ...process.env };
  for (const k of ['EXPO_PUBLIC_PRIVY_APP_ID', 'EXPO_PUBLIC_PRIVY_CLIENT_ID', 'EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB']) delete process.env[k]; // no ambient ids: each case sets its own
  const wasFetch = globalThis.fetch;
  // jsdom has no fetch, and a release build off the mock builds the HTTP client at import, which reads it; a browser has one.
  globalThis.fetch = jest.fn() as unknown as typeof fetch;
  if (opts.appId) Object.assign(process.env, { EXPO_PUBLIC_PRIVY_APP_ID: 'app' }); // the web's rule: no client id needed
  let api!: Api;
  (global as { __DEV__?: boolean }).__DEV__ = opts.dev;
  try {
    jest.isolateModules(() => {
      jest.doMock('@/api', () => ({ ...jest.requireActual<Api>('@/api'), usingMock: opts.usingMock }));
      /* eslint-disable @typescript-eslint/no-require-imports -- loaded into the registry isolateModules just made */
      api = require('@/api');
      require('@/auth/mockAuth'); // installed at import, before any provider mounts
      /* eslint-enable @typescript-eslint/no-require-imports */
    });
  } finally {
    (global as { __DEV__?: boolean }).__DEV__ = wasDev;
    process.env = wasEnv;
    globalThis.fetch = wasFetch;
  }
  return api.currentAccessTokenProvider()();
}

afterEach(() => { jest.dontMock('@/api'); });

test('a development build on a real API hands the HTTP client the local placeholder token', async () => {
  expect(await tokenFor({ usingMock: false, dev: true })).toBe('local-dev-auth');
});

test('in a browser an app id alone is Privy, so the placeholder is never installed', async () => {
  expect(await tokenFor({ usingMock: false, dev: true, appId: true })).toBeNull();
});

test('the in-app mock never installs a token', async () => {
  expect(await tokenFor({ usingMock: true, dev: true })).toBeNull();
});

test('a release build never sends the placeholder', async () => {
  expect(await tokenFor({ usingMock: false, dev: false })).toBeNull();
});
