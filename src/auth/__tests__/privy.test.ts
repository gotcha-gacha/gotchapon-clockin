// Which client id a phone passes to Privy. The web file is privy.web.test.ts.
import { afterEach, expect, test } from '@jest/globals';
import { privyAppId, privyClientId, privyConfigured } from '@/auth/privy';

const clear = () => {
  delete process.env.EXPO_PUBLIC_PRIVY_APP_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID;
  delete process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB;
};
afterEach(clear);

test('native uses the mobile client id, and ignores the web one', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID = 'mobile-client';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB = 'web-client';
  expect(privyAppId()).toBe('app');
  expect(privyClientId()).toBe('mobile-client');
  expect(privyConfigured()).toBe(true);
});

test('the web client id alone does not configure native', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB = 'web-client';
  expect(privyClientId()).toBe('');
  expect(privyConfigured()).toBe(false);
});

test('an app id without the mobile client id is not configured', () => {
  process.env.EXPO_PUBLIC_PRIVY_APP_ID = 'app';
  expect(privyConfigured()).toBe(false);
});
