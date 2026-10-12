import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseArgs, parseTokenAmount } from '../setup-test-token.ts';

test('parses an explicit, review-only token setup', () => {
  const args = parseArgs(['--config', 'config/mainnet-dev.json']);
  assert.match(args.configPath, /config\/mainnet-dev\.json$/);
  assert.equal(args.execute, false);
  assert.equal(parseTokenAmount('1000000.25', 6), 1_000_000_250_000n);
});

test('requires the reviewed digest for execution', () => {
  assert.throws(() => parseArgs([
    '--config', 'config/mainnet-dev.json',
    '--execute',
  ]), /--execute requires --approve-digest/);
});

test('rejects precision that the configured mint cannot represent', () => {
  assert.throws(() => parseTokenAmount('1.0000001', 6), /more fractional digits/);
});
