import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const serverDir = fileURLToPath(new URL('../', import.meta.url));
const composeFile = fileURLToPath(new URL('../e2e/compose.yaml', import.meta.url));
const vitest = fileURLToPath(new URL('../../node_modules/.bin/vitest', import.meta.url));
const project = 'gachapon-surfpool-e2e';
const configFlag = process.argv.indexOf('--config');
const configs = configFlag >= 0
  ? [process.argv[configFlag + 1]].filter(Boolean)
  : ['e2e/vitest.config.ts'];
if (configFlag >= 0 && configs.length === 0) throw new Error('--config requires a Vitest config path');

function run(command: string, args: string[], options: Parameters<typeof spawnSync>[2] = {}) {
  const result = spawnSync(command, args, { cwd: serverDir, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

async function ready() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:18899', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getHealth' }),
      });
      const body = await response.json() as { result?: unknown };
      if (response.ok && body.result === 'ok') return;
    } catch { /* Surfpool is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Surfpool did not become healthy');
}

try {
  run('docker', ['compose', '--project-name', project, '--file', composeFile, 'up', '--detach']);
  await ready();
  for (const config of configs) {
    run(vitest, ['run', '--config', config], {
      env: { ...process.env, NO_DNA: '1', SURFPOOL_RPC_URL: 'http://127.0.0.1:18899' },
    });
  }
} finally {
  try {
    run('docker', ['compose', '--project-name', project, '--file', composeFile, 'down', '--volumes', '--remove-orphans']);
  } catch (error) {
    console.error('Failed to stop Surfpool:', error);
  }
}
