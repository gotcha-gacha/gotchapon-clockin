// The QR filter (W5.1). A phone that scans the page must not receive Privy's one-time OAuth code.
import { expect, test } from '@jest/globals';
import { hrefWithoutOAuthParams } from '@/auth/oauthParams';

test('OAuth params go, and the rest of the address stays', () => {
  const href = 'https://gachapon.example/pull?ref=mei&replay=holo&privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google#card';
  expect(hrefWithoutOAuthParams(href)).toBe('https://gachapon.example/pull?ref=mei&replay=holo#card');
});

test('an address with none of them is unchanged, and a string that is not a URL is returned as it is', () => {
  const href = 'https://gachapon.example/wallet?ref=mei';
  expect(hrefWithoutOAuthParams(href)).toBe(href);
  expect(hrefWithoutOAuthParams('::not a url')).toBe('::not a url');
});

test('one leftover param is still removed: a partial handoff is not safe to scan', () => {
  expect(hrefWithoutOAuthParams('https://gachapon.example/?privy_oauth_code=abc&ref=mei')).toBe('https://gachapon.example/?ref=mei');
});
