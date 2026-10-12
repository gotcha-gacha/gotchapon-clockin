// Every test file belongs to exactly one jest project (W0.4, #122). PR #149's review dropped `Keyboard.test.web.tsx`, the
// spelling jest-expo's own web preset uses, into the tree with `expect(1).toBe(2)` in it: neither project claimed it and
// `npx jest` stayed green. A file nobody runs is the quietest way for a guard test to stop guarding, so this reads the real
// config from package.json and sorts every test-looking file under src/ by those patterns (all plain suffixes, which the first test pins).
import { expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';

type Project = { displayName: string; testMatch: string[]; testPathIgnorePatterns: string[] };
const root = path.resolve(__dirname, '../..');
const projects = (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { jest: { projects: Project[] } }).jest.projects;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
/** Anything a person would call a test file, in any of the spellings: x.test.ts, x.web.test.tsx, x.test.web.tsx, x.spec.… */
const looksLikeATest = (f: string) => /\.(test|spec)(\.web)?\.[tj]sx?$/.test(f);
// Every pattern in this config is "any file, at any depth, ending in <suffix>", so matching is `endsWith`. A fancier glob fails
// the shape check below on purpose: whoever adds one has to teach this test what it means.
const SHAPE = /^\*\*\/\*(\.[a-z.]+)$/;
// jest substitutes `<rootDir>` in an ignore pattern globally, as plain text, before compiling the regex
// (`normalizeUnmockedModulePathPatterns`, jest-config/build/normalize.js). Read it the same way, or an anchored pattern looks
// like one that can never match and this file cannot tell it from an unanchored one — the difference the last test is about.
const claims = (p: Project, file: string, rootDir = root) =>
  p.testMatch.some((glob) => file.endsWith(SHAPE.exec(glob)![1])) &&
  !p.testPathIgnorePatterns.some((re) => new RegExp(re.replace(/<rootDir>/g, rootDir)).test(file));

test('every testMatch pattern is a plain suffix, which is all this file knows how to read', () => {
  expect(projects.flatMap((p) => p.testMatch).filter((glob) => !SHAPE.test(glob))).toEqual([]);
});

test('every test file under src/ is run by exactly one project, whichever way its name spells "web"', () => {
  const files = walk(path.join(root, 'src')).filter(looksLikeATest);
  expect(files.length).toBeGreaterThan(50); // the walk found the suite, not an empty directory
  const owners = files.map((f) => ({ file: path.relative(root, f), by: projects.filter((p) => claims(p, f)).map((p) => p.displayName) }));
  expect(owners.filter((o) => o.by.length !== 1)).toEqual([]);
  expect(new Set(owners.map((o) => o.by[0]))).toEqual(new Set(['native', 'web']));
});

test('the spellings a newcomer might use all land in the web project, and a plain test in the native one', () => {
  const owner = (name: string) => projects.filter((p) => claims(p, path.join(root, 'src/x', name))).map((p) => p.displayName);
  for (const name of ['Keyboard.web.test.tsx', 'Keyboard.test.web.tsx', 'keys.web.test.ts', 'keys.test.web.ts', 'Keyboard.web.spec.tsx', 'Keyboard.spec.web.tsx']) expect([name, owner(name)]).toEqual([name, ['web']]);
  for (const name of ['Keyboard.test.tsx', 'keys.test.ts', 'keys.spec.ts']) expect([name, owner(name)]).toEqual([name, ['native']]);
});

test('the nested-worktree ignore hides the other worktrees and never the checkout jest runs in', () => {
  // `.claude/worktrees/<name>` is the desktop app's per-session worktree directory, and it lives inside the repo. Without this
  // ignore, jest from the repo root collects every sibling worktree's copy of every test — 8 paths for one file on 20 Sept with
  // 7 worktrees present — and runs other sessions' in-progress code against their own node_modules, so `pnpm verify` goes red
  // for reasons that have nothing to do with the tree being verified.
  // Two unrelated names, and nothing here depends on those directories existing: an ignore narrowed to one worktree's name still
  // collects every other worktree, and with a single name in the sweep that mutant survives — it did, in review.
  const sibling = (worktree: string, name: string) => path.join(root, '.claude/worktrees', worktree, 'src/x', name);
  for (const worktree of ['adoring-goldstine-0cd3a9', 'kind-darwin-c82ab1'])
    for (const name of ['a.test.ts', 'a.web.test.ts'])
      expect([worktree, name, projects.filter((p) => claims(p, sibling(worktree, name))).map((p) => p.displayName)]).toEqual([worktree, name, []]);

  // The `<rootDir>` anchor is the whole pattern. Drop it and it also matches the checkout's OWN path whenever that checkout IS one of
  // those worktrees, which is where `pnpm verify` runs: `pnpm test` there dies with `No tests found, exiting with code 1` and names
  // `testPathIgnorePatterns … - 0 matches`, so the gate can never pass inside a worktree (measured; `--listTests` alone exits 0 with
  // nothing, which is what makes the unanchored spelling look harmless).
  const own = '/repo/.claude/worktrees/this-session';
  expect(projects.filter((p) => claims(p, `${own}/src/x/a.test.ts`, own)).map((p) => p.displayName)).toEqual(['native']);
  expect(projects.filter((p) => claims(p, `${own}/src/x/a.web.test.ts`, own)).map((p) => p.displayName)).toEqual(['web']);
});
