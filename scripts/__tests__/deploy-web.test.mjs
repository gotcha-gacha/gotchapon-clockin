// Soft-launch web, TestFlight, and the mainnet-dev Worker share one Privy app id.
// The web export must not send a Privy web client id. The id baked in #382 is rejected
// by Privy (`missing_or_invalid_privy_client_id`). With the key omitted, deploy-web sets
// EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB to '' and sign-in uses the app's shared Allowed origins.
// The mobile client id stays blank so a web bundle never sends it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { webExportEnv } from '../deploy-web.mjs';

const REJECTED_WEB_CLIENT = 'client-WY6d8c26yPZpaDvy59vpN5ub3honTP85Ss6C1YfTi3xt5';
const SOFT_LAUNCH_APP_ID = 'cmtvc9otj02hd0bl8frhel0zh';
const configPath = new URL('../../config/web-mainnet-dev.json', import.meta.url);
const raw = readFileSync(configPath, 'utf8');
const config = JSON.parse(raw);
const eas = JSON.parse(readFileSync(new URL('../../eas.json', import.meta.url), 'utf8'));
const wrangler = JSON.parse(
  readFileSync(new URL('../../server/wrangler.jsonc', import.meta.url), 'utf8').replace(/^(?:\s*\/\/[^\n]*\n)+/, ''),
);

test('soft-launch web, TestFlight, and the mainnet-dev worker share one Privy app', () => {
  assert.equal(config.privyAppId, SOFT_LAUNCH_APP_ID);
  assert.equal(eas.build.testflight.env.EXPO_PUBLIC_PRIVY_APP_ID, SOFT_LAUNCH_APP_ID);
  assert.equal(wrangler.env['mainnet-dev'].vars.PRIVY_APP_ID, SOFT_LAUNCH_APP_ID);
});

test('mainnet-dev web config omits the Privy web client id', () => {
  assert.equal(Object.hasOwn(config, 'privyClientIdWeb'), false);
  assert.equal(config.privyClientIdWeb, undefined);
  assert.equal(raw.includes('privyClientIdWeb'), false);
  assert.equal(raw.includes(REJECTED_WEB_CLIENT), false);
});

test('the deploy env leaves the web client id empty and blanks the mobile client id', () => {
  const env = webExportEnv(config, 'config/web-mainnet-dev.json', {
    EXPO_PUBLIC_PRIVY_CLIENT_ID: 'mobile-client-must-not-leak',
    EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB: 'ambient-web-client-must-not-leak',
  });
  assert.equal(env.EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB, '');
  assert.equal(env.EXPO_PUBLIC_PRIVY_CLIENT_ID, '');
  assert.equal(env.EXPO_PUBLIC_PRIVY_APP_ID, config.privyAppId);
  assert.equal(env.EXPO_PUBLIC_USE_MOCK, '0');
  assert.equal(env.EXPO_NO_DOTENV, '1');
});

// #31 (Ben, 11 Oct): the internal `preview` profile is a TestFlight twin for Android and registered iPhones, pointed at
// mainnet-dev (the staging stack). It loads the production EAS environment, which holds the Privy mobile client id: without
// it the app falls back to the mock sign-in, which gives a real API no token, so every request would be refused.
test('the preview profile carries exactly the TestFlight public values and loads the environment holding the mobile client', () => {
  assert.deepEqual(eas.build.preview.env, eas.build.testflight.env);
  assert.equal(eas.build.preview.environment, 'production');
  assert.equal(eas.build.preview.distribution, 'internal');
  assert.equal(eas.build.preview.env.EXPO_PUBLIC_API_URL, config.apiUrl);
});
