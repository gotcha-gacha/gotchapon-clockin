#!/usr/bin/env node
import { copyFileSync, cpSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

// Public build values for one web export. The browser reads EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB (docs/PRIVY_SETUP.md §2b);
// the mobile client id is always blank here so a web bundle never sends it.
export function webExportEnv(config, configPath, baseEnv = {}) {
  // The treasury token account and mint a paid pull must pay (#186): the app refuses to sign anything else, so a build without
  // them can take free pulls and no paid one. Copy them from server/wrangler.jsonc's matching env.
  for (const key of ['apiUrl', 'privyAppId', 'treasuryUsdcTokenAccount', 'usdcMint']) {
    if (typeof config[key] !== 'string' || config[key].length === 0) {
      throw new Error(`${key} must be a non-empty string in ${configPath}`);
    }
  }
  if (config.privyClientIdWeb !== undefined && typeof config.privyClientIdWeb !== 'string') {
    throw new Error(`privyClientIdWeb must be a string when set in ${configPath}`);
  }

  const apiUrl = new URL(config.apiUrl);
  if (apiUrl.protocol !== 'https:' || apiUrl.pathname !== '/') {
    throw new Error(`apiUrl must be an HTTPS origin without a path: ${config.apiUrl}`);
  }
  if (typeof config.indexable !== 'boolean') {
    throw new Error(`indexable must be a boolean in ${configPath}`);
  }

  return {
    ...baseEnv,
    EXPO_NO_DOTENV: '1',
    EXPO_PUBLIC_API_URL: apiUrl.origin,
    EXPO_PUBLIC_USE_MOCK: '0',
    EXPO_PUBLIC_WEB_INDEXABLE: config.indexable ? '1' : '0',
    EXPO_PUBLIC_PRIVY_APP_ID: config.privyAppId,
    EXPO_PUBLIC_PRIVY_CLIENT_ID: '',
    EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB: config.privyClientIdWeb ?? '',
    EXPO_PUBLIC_TREASURY_USDC_TOKEN_ACCOUNT: config.treasuryUsdcTokenAccount,
    EXPO_PUBLIC_USDC_MINT: config.usdcMint,
  };
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function main() {
  const configPath = resolve(root, process.argv[2] ?? 'config/web-mainnet-dev.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const buildEnv = webExportEnv(config, configPath, process.env);

  run('pnpm', ['export:web'], buildEnv);
  run('node', ['scripts/bundle-budget.mjs', 'dist']);

  // Expo's static rendering output separates browser assets and rendered HTML.
  // Cloudflare assets expect one publish directory with an index.html for SPA
  // fallback, so assemble that directory after every clean export.
  const cloudflareDir = resolve(root, '.expo/cloudflare-web');
  rmSync(cloudflareDir, { recursive: true, force: true });
  mkdirSync(cloudflareDir, { recursive: true });
  cpSync(resolve(root, 'dist/client'), cloudflareDir, { recursive: true });
  copyFileSync(resolve(root, 'dist/server/[...path].html'), resolve(cloudflareDir, 'index.html'));
  copyFileSync(resolve(root, 'dist/server/odds.html'), resolve(cloudflareDir, 'odds.html'));

  run('pnpm', ['--dir', 'server', 'exec', 'wrangler', 'deploy', '--config', '../wrangler.web.jsonc']);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
