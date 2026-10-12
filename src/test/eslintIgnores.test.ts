// `pnpm lint` (`eslint .`) from the repo root must not lint the desktop app's nested worktrees, and must still lint a checkout
// that IS one of them — the lint half of the rule jestProjects.test.ts pins for jest. On 27 Sept the main checkout's lint died
// with 14,934 errors, every one under `.claude/worktrees/<name>/` (their `design/support.js`, their in-progress code), while the
// same commit linted clean from a worktree outside the repo.
// This runs the real eslint on the real eslint.config.js, in a child process: eslint loads its config with `import()`, which
// jest's VM refuses. The fixture's config files re-export the repo's, so each sits where a checkout's own config would and
// eslint resolves the ignores against that directory, as it does for real.
import { afterAll, beforeAll, expect, test } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const WORKTREES = ['adoring-goldstine-0cd3a9', 'kind-darwin-c82ab1'];
let repo: string;

/** Every file `eslint .` reports an error in, run from `cwd`, relative to `cwd`. */
function lintErrors(cwd: string): string[] {
  const script = `
    const { ESLint } = require(${JSON.stringify(require.resolve('eslint', { paths: [root] }))});
    new ESLint({ cwd: process.argv[1] }).lintFiles(['.']).then((rs) => {
      process.stdout.write(JSON.stringify(rs.filter((r) => r.errorCount > 0).map((r) => r.filePath)));
    });`;
  const out = execFileSync(process.execPath, ['-e', script, cwd], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return (JSON.parse(out) as string[]).map((f) => path.relative(fs.realpathSync(cwd), fs.realpathSync(f))).sort();
}

function write(file: string, text: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
const reExport = `module.exports = require(${JSON.stringify(path.join(root, 'eslint.config.js'))});\n`;
const broken = 'const x = ;\n'; // a parsing error: an error under any rule set

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'eslint-ignores-'));
  write(path.join(repo, 'eslint.config.js'), reExport);
  write(path.join(repo, 'src/own.ts'), broken);
  // Two unrelated names: an ignore narrowed to one worktree's name would still pass with a single name in the sweep.
  for (const name of WORKTREES) {
    const wt = path.join(repo, '.claude/worktrees', name);
    write(path.join(wt, 'eslint.config.js'), reExport);
    write(path.join(wt, 'src/bad.ts'), broken);
    write(path.join(wt, 'design/support.js'), broken);
  }
});
afterAll(() => {
  if (repo) fs.rmSync(repo, { recursive: true, force: true });
});

test('from the repo root, eslint reports its own files and none of the nested worktrees', () => {
  expect(lintErrors(repo)).toEqual(['src/own.ts']);
});

test('from inside a nested worktree, eslint still reports that worktree’s own files', () => {
  // The pattern is anchored because flat-config ignores match paths relative to the config file's directory: here the files
  // are `src/bad.ts`, never `.claude/worktrees/…`. `design/` is the repo config's own ignore, applied here as anywhere.
  for (const name of WORKTREES) expect([name, lintErrors(path.join(repo, '.claude/worktrees', name))]).toEqual([name, ['src/bad.ts']]);
});
