import { readFile } from 'node:fs/promises';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

function statements(source: string): string[] {
  const result: string[] = [];
  let buffer: string[] = [];
  let trigger = false;
  for (const raw of source.split('\n')) {
    const line = raw.replace(/--.*$/, '').trim();
    if (!line) continue;
    if (buffer.length === 0) trigger = /^CREATE\s+TRIGGER\b/i.test(line);
    buffer.push(line);
    const complete = trigger ? /^END;$/i.test(line) : line.endsWith(';');
    if (complete) {
      const sql = buffer.join('\n').replace(/;$/, '');
      if (!/^PRAGMA\b/i.test(sql)) result.push(sql);
      buffer = [];
      trigger = false;
    }
  }
  if (buffer.length) throw new Error('schema.sql contains an unterminated statement');
  return result;
}

export default defineConfig({
  plugins: [cloudflareTest(async () => ({
    wrangler: { configPath: './wrangler.jsonc', environment: 'local' },
    miniflare: {
      bindings: {
        ADMIN_API_KEY: 'local-development-admin-key-000000000000',
        TEST_SCHEMA: JSON.stringify(statements(await readFile('./schema.sql', 'utf8'))),
      },
    },
  }))],
  test: { include: ['./test/**/*.test.ts'], setupFiles: ['./test/apply-schema.ts'] },
});
