// Which client id a browser passes to Privy. Under this project `@/auth/privy` resolves to privy.web.ts.
import { afterEach, expect, test } from '@jest/globals';
import { privyAppId, privyClientId, privyConfigured } from '@/auth/privy';

const clear = () => {
  delete process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB;
};
afterEach(clear);

test('web uses the web client id, and ignores the mobile one', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = 'mobile-client';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB = 'web-client';
  expect(privyAppId()).toBe('app');
  expect(privyClientId()).toBe('web-client');
  expect(privyConfigured()).toBe(true);
});

test('web needs only the app id and ignores the mobile client id', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = 'mobile-client';
  expect(privyClientId()).toBe('');
  expect(privyConfigured()).toBe(true);
});

test('an app id without a web client id is configured', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  expect(privyConfigured()).toBe(true);
});

test('a web client id without an app id is not configured', () => {
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB = 'web-client';
  expect(privyConfigured()).toBe(false);
});
