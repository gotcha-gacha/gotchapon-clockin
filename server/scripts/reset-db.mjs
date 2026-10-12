import { rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const localD1State = fileURLToPath(new URL('../.wrangler/state/v3/d1/', import.meta.url));
const wrangler = fileURLToPath(new URL(`../../node_modules/.bin/wrangler${process.platform === 'win32' ? '.cmd' : ''}`, import.meta.url));

function run(command, args) {
  const result = spawnSync(command, args, { cwd: serverDir, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

await rm(localD1State, { recursive: true, force: true });
console.log(`Wiped local D1 state: ${localD1State}`);

run(wrangler, ['d1', 'execute', 'gachapon', '--env', 'local', '--local', '--file=schema.sql']);
run(process.execPath, ['scripts/build-seed.mjs']);
run(wrangler, ['d1', 'execute', 'gachapon', '--env', 'local', '--local', '--file=.generated/dev-seed.sql']);
