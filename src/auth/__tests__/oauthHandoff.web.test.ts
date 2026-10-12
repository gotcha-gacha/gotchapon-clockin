// The OAuth return is off the bar before the router and the QR, and a stashed handoff can be put back for Privy
// without wiping `history.state` (W5.1).
import { beforeEach, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import {
  captureOAuthHandoff,
  consumeOAuthHandoff,
  peekOAuthHandoff,
  resetOAuthHandoffForTests,
  restoreOAuthParamsForPrivy,
} from '@/auth/oauthHandoff';

const STATE = { index: 4, id: 'route' };

beforeEach(() => {
  resetOAuthHandoffForTests();
  window.history.replaceState(STATE, '', '/pull?ref=mei');
});

test('a complete handoff is stashed and stripped, and history.state stays', () => {
  window.history.replaceState(STATE, '', '/pull?ref=mei&privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google');
  captureOAuthHandoff();
  expect(window.location.search).toBe('?ref=mei');
  expect(window.history.state).toEqual(STATE);
  expect(peekOAuthHandoff()).toEqual({ code: 'abc', state: 's', provider: 'google' });
});

test('capture does not strip a URL that was put back for Privy', () => {
  window.history.replaceState(STATE, '', '/pull?privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=google&ref=mei');
  captureOAuthHandoff();
  restoreOAuthParamsForPrivy();
  expect(window.location.search).toContain('privy_oauth_code=abc');
  expect(window.location.search).toContain('ref=mei');
  captureOAuthHandoff();
  expect(window.location.search).toContain('privy_oauth_code=abc');
  expect(window.history.state).toEqual(STATE);
});

test('consume strips again and a later capture leaves the bar alone', () => {
  window.history.replaceState(STATE, '', '/?privy_oauth_code=abc&privy_oauth_state=s&privy_oauth_provider=apple');
  captureOAuthHandoff();
  restoreOAuthParamsForPrivy();
  consumeOAuthHandoff();
  expect(window.location.search).toBe('');
  expect(peekOAuthHandoff()).toBe('consumed');
  expect(window.history.state).toEqual(STATE);
  window.history.replaceState(STATE, '', '/?privy_oauth_code=again&privy_oauth_state=s&privy_oauth_provider=google');
  captureOAuthHandoff();
  expect(window.location.search).toContain('privy_oauth_code=again');
});

test('the entry imports the handoff before the router', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../entrypoint.js'), 'utf8');
  const handoff = src.indexOf("import './src/auth/oauthHandoff'");
  const router = src.indexOf("import 'expo-router/entry'");
  expect(handoff).toBeGreaterThan(-1);
  expect(router).toBeGreaterThan(handoff);
});
