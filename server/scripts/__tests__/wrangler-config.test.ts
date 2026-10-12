// #274: wrangler.jsonc fails closed. A bare `wrangler deploy` (no --env) must not publish the local profile, every deployed
// environment must carry what it needs, and nothing that runs wrangler may lean on top-level defaults again.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const text = readFileSync(new URL('wrangler.jsonc', root), 'utf8');
// The file is JSON after a block of `//` line comments at the top; strip only those, so a `//` inside a URL value stays.
const config = JSON.parse(text.replace(/^(?:\s*\/\/[^\n]*\n)+/, ''));
const envs: Record<string, { vars?: Record<string, string>; d1_databases?: unknown[] }> = config.env;
const DEPLOYED = Object.keys(envs).filter((name) => name !== 'local');
const readme = readFileSync(new URL('README.md', root), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

test('the top level has no vars and no D1 binding: a bare deploy gets no ENVIRONMENT and no database', () => {
  assert.equal(config.vars, undefined);
  assert.equal(config.d1_databases, undefined);
});

test('the local profile is an explicit environment, and the only one with dev auth, mock payments or the published seed', () => {
  assert.deepEqual(
    { ENVIRONMENT: envs.local.vars?.ENVIRONMENT, AUTH_MODE: envs.local.vars?.AUTH_MODE, PAYMENTS_MODE: envs.local.vars?.PAYMENTS_MODE },
    { ENVIRONMENT: 'local', AUTH_MODE: 'dev', PAYMENTS_MODE: 'mock' },
  );
  assert.ok(DEPLOYED.length >= 2, `deployed environments: ${DEPLOYED.join(', ')}`);
  for (const name of DEPLOYED) {
    const vars = envs[name].vars ?? {};
    assert.ok(vars.ENVIRONMENT === 'preview' || vars.ENVIRONMENT === 'production', `${name}: ENVIRONMENT ${vars.ENVIRONMENT}`);
    assert.equal(vars.AUTH_MODE, 'privy', name);
    assert.equal(vars.PAYMENTS_MODE, 'solana-rpc', name);
    assert.equal(vars.ECVRF_SECRET_SEED, undefined, `${name}: the seed is a secret, never a var`);
  }
});

test('every deployed environment lists every public value it reads (vars are not inherited)', () => {
  const required = ['ENVIRONMENT', 'AUTH_MODE', 'PAYMENTS_MODE', 'ALLOWED_ORIGINS', 'ENABLED_ASSETS', 'USDC_MINT',
    'TREASURY_USDC_TOKEN_ACCOUNT', 'PRIVY_APP_ID', 'FEE_PAYER_ADDRESS'];
  for (const name of DEPLOYED) {
    const missing = required.filter((key) => !(envs[name].vars ?? {})[key]);
    assert.deepEqual(missing, [], `${name} is missing ${missing.join(', ')}`);
    assert.ok(envs[name].d1_databases?.length, `${name} has no D1 binding`);
  }
});

test('only mainnet-dev lifts the geo block (Ben, 11 Oct 2026): local and production keep it', () => {
  for (const [name, env] of Object.entries(envs)) {
    assert.equal((env.vars ?? {}).GEO_BLOCK, name === 'mainnet-dev' ? 'off' : undefined, name);
  }
});

test('every secret each deployed environment reads is a documented `wrangler secret put \u2026 --env <name>`, and not a var', () => {
  const secrets = ['ADMIN_API_KEY', 'PRIVY_APP_SECRET', 'ECVRF_SECRET_SEED', 'SOLANA_RPC_URL', 'FEE_PAYER_KEYPAIR', 'HOUSE_SENDER_SECRET'];
  for (const name of DEPLOYED) {
    for (const secret of secrets) {
      assert.ok(readme.includes(`wrangler secret put ${secret} --env ${name}`), `README does not tell ${name} to set ${secret}`);
      assert.equal((envs[name].vars ?? {})[secret], undefined, `${name}: ${secret} is a secret, not a var`);
    }
  }
});

test('every package script that runs the worker, deploys it or touches a D1 names its environment', () => {
  for (const [name, command] of Object.entries(pkg.scripts as Record<string, string>)) {
    for (const part of command.split('&&').map((p) => p.trim())) {
      if (/^wrangler (dev|deploy|d1 execute)\b/.test(part)) assert.match(part, / --env \S+/, `${name}: ${part}`);
    }
  }
  const reset = readFileSync(new URL('scripts/reset-db.mjs', root), 'utf8');
  for (const call of reset.match(/run\(wrangler, \[[^\]]*\]\)/g) ?? []) assert.match(call, /'--env', 'local'/, call);
});
