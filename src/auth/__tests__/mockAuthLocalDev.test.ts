// The mock sign-in's placeholder token for the local worker (Batch B): a development build on a real API sends one, the
// in-app mock and a release build never do. It is installed at import, so each case loads the modules fresh.
import { afterEach, expect, jest, test } from '@jest/globals';

type Api = typeof import('@/api');

async function tokenFor(opts: { usingMock: boolean; dev: boolean; privy?: boolean | 'app id only' }): Promise<string | null> {
  const wasDev = (global as { __DEV__?: boolean }).__DEV__;
  const wasEnv = { ...process.env };
  for (const k of ['EXPO_PUBLIC_PRIVY_APP_ID', 'EXPO_PUBLIC_PRIVY_CLIENT_ID', 'EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB']) delete process.env[k]; // no ambient ids: each case sets its own
  if (opts.privy === true) Object.assign(process.env, { EXPO_PUBLIC_PRIVY_APP_ID: 'app', EXPO_PUBLIC_PRIVY_CLIENT_ID: 'client' });
  if (opts.privy === 'app id only') Object.assign(process.env, { EXPO_PUBLIC_PRIVY_APP_ID: 'app' });
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
  }
  return api.currentAccessTokenProvider()();
}

afterEach(() => { jest.dontMock('@/api'); });

test('a development build on a real API hands the HTTP client the local placeholder token', async () => {
  expect(await tokenFor({ usingMock: false, dev: true })).toBe('local-dev-auth');
});

test('the in-app mock never installs a token (it has no HTTP client to hand one to)', async () => {
  expect(await tokenFor({ usingMock: true, dev: true })).toBeNull();
});

test('a release build never sends the placeholder, API or not', async () => {
  expect(await tokenFor({ usingMock: false, dev: false })).toBeNull();
});

test('a development build with Privy configured never installs it: Privy owns the token, from its first request', async () => {
  expect(await tokenFor({ usingMock: false, dev: true, privy: true })).toBeNull();
});

test('on a phone an app id alone is not Privy (the mobile client id is missing), so the mock and its token stay', async () => {
  // The same rule AuthProvider.tsx applies (src/auth/privy.ts); the web answers the opposite (mockAuthLocalDev.web.test.ts).
  expect(await tokenFor({ usingMock: false, dev: true, privy: 'app id only' })).toBe('local-dev-auth');
});
