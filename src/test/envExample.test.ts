// `.env.example` documents every `EXPO_PUBLIC_*` the app reads (#188). The list rots the moment someone adds a flag, and a
// stale one is worse than none: a missing name is a build exported with the wrong mock or API URL, which is exactly what the
// audit called out. So the file is checked against the source that reads them, rather than kept by hand.
//
// Both directions are checked. A name read in the code and missing from the file is an undocumented flag; a name in the file
// that nothing reads is a flag someone removed, or a typo in either place — a typo'd name reads as `undefined` at runtime and
// is silent, which is how "the export ignored my flag" happens.
//
// The contract, so what it does not cover is a choice and not an oversight: `EXPO_PUBLIC_[A-Z0-9_]+` read anywhere under
// `src/` or `scripts/` outside tests. A lowercase name would slip through (Expo only requires the prefix) — every name in
// this repo is upper case and this is the line that keeps it that way. A root-level `app.config.*` is the one place a
// reader could hide outside the walk, so the test below asserts none exists.
import { expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const SKIP = new Set(['node_modules', '.git', 'dist', '.expo', 'ios', 'android', 'design', 'prototypes', 'data', '.claude']);

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (SKIP.has(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

/** The files the walk reads: `src/` and `scripts/`, minus tests. */
function sourceFiles(): string[] {
  return [...walk(path.join(root, 'src')), ...walk(path.join(root, 'scripts'))]
    .filter((f) => /\.(ts|tsx|js|cjs|mjs)$/.test(f) && !/__tests__|\.test\.|\.spec\./.test(f));
}

/** Every `EXPO_PUBLIC_…` name that appears in code the app or its scripts run. */
function namesInSource(): Set<string> {
  const files = sourceFiles();
  const names = new Set<string>();
  for (const f of files) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/EXPO_PUBLIC_[A-Z0-9_]+/g)) names.add(m[0]);
  }
  return names;
}

/** Every name the example file declares, as `NAME=` at the start of a line (a comment mentioning one does not count). */
function namesInExample(): Set<string> {
  const text = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  return new Set([...text.matchAll(/^(EXPO_PUBLIC_[A-Z0-9_]+)=/gm)].map((m) => m[1]));
}

test('the walk found the files it is supposed to read', () => {
  // Not zero, and it found the two the app cannot run without: a regex that stopped matching, or a walk that skipped
  // src/, would otherwise make every assertion below vacuously true.
  const inSource = namesInSource();
  expect(inSource.size).toBeGreaterThanOrEqual(3);
  expect([...inSource]).toEqual(expect.arrayContaining(['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_USE_MOCK']));
  // Both roots, each named: with the counts alone, deleting `scripts/` from the walk survived every assertion here,
  // because no flag lives only there today (PR #196's review ran that mutant).
  const roots = new Set(sourceFiles().map((f) => path.relative(root, f).split(path.sep)[0]));
  expect([...roots].sort()).toEqual(['scripts', 'src']);
});

// The contract is "src/ and scripts/", the two places this app's own code lives. A root-level `app.config.js` would be a
// third (Expo reads one, and it is the usual home for a build-time env read) — there is none today, and this says so
// rather than letting the walk quietly not cover it.
test('there is no root-level app config reading env behind the walk', () => {
  for (const f of ['app.config.js', 'app.config.ts', 'app.config.mjs', 'babel.config.js', 'metro.config.js']) {
    const p = path.join(root, f);
    if (!fs.existsSync(p)) continue;
    expect(fs.readFileSync(p, 'utf8')).not.toMatch(/EXPO_PUBLIC_/);
  }
});

test('every EXPO_PUBLIC_* the code reads is documented in .env.example', () => {
  expect([...namesInSource()].filter((n) => !namesInExample().has(n)).sort()).toEqual([]);
});

test('every name in .env.example is one something reads', () => {
  // The list this once carried is empty: a name could sit in the file ahead of the code that reads it, and both of the
  // names that did — Privy's two ids — are read now (`src/auth/privy.ts`, 22 Sept), as PostHog's key became on the 21st.
  // Put a name back on this list only with the reason it is early, and take it off the day the code lands.
  const NOT_READ_YET = new Set<string>();
  const inSource = namesInSource();
  expect([...namesInExample()].filter((n) => !inSource.has(n) && !NOT_READ_YET.has(n)).sort()).toEqual([]);
  expect([...NOT_READ_YET].filter((n) => inSource.has(n)).sort()).toEqual([]);
});
