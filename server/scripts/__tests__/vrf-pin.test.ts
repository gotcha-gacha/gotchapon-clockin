// The draw's VRF library is a 0.0.x release on the money path (#277): it stays pinned to one exact version, and the lockfile
// holds that version's integrity hash, so an install can never pick up a different build of it. README → "The VRF library".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const NAME = '@blueshift-gg/solana-ecvrf';
const root = new URL('../../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('server/package.json', root), 'utf8')) as { dependencies: Record<string, string> };
const lock = readFileSync(new URL('pnpm-lock.yaml', root), 'utf8');

test('the VRF library is pinned to one exact version', () => {
  assert.match(pkg.dependencies[NAME] ?? '', /^\d+\.\d+\.\d+$/, `${NAME} must be an exact version, not a range`);
});

test('the lockfile pins that version by integrity hash', () => {
  const version = pkg.dependencies[NAME];
  const entry = lock.match(new RegExp(`\\n  '${NAME}@${version.replaceAll('.', '\\.')}':\\n    resolution: \\{integrity: (sha512-[A-Za-z0-9+/=]+)\\}`));
  assert.ok(entry, `pnpm-lock.yaml has no integrity-pinned entry for ${NAME}@${version}`);
});
