// What must never be committed, checked against what git actually tracks (#226–#228 round 2).
//
// `.gitignore` said `node_modules/`, and a trailing slash matches a DIRECTORY only. A `node_modules` **symlink** is a file
// to git, so `git add -A` committed one — an absolute path out of the machine it was made on — and it rode three squash
// merges into `main` before anyone looked. A clone then lands a broken link exactly where the dependencies go.
//
// The rule is read from git, not from `.gitignore`: an ignore rule is a claim about what would be added, and this is the
// thing itself. Anything else that is generated, huge, or machine-specific belongs in the list below as it comes up.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from '@jest/globals';

const ROOT = path.resolve(__dirname, '..', '..');
/** Every path git tracks, or null where git cannot answer (no git binary, or an export with no repository). */
function tracked(): string[] | null {
  try { return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean); }
  catch { return null; }
}

test('nothing under a node_modules path is tracked, symlink or file', () => {
  const files = tracked();
  if (!files) return; // no git here: the guard is silent rather than wrong
  expect(files.filter((f) => f === 'node_modules' || f.split('/').includes('node_modules'))).toEqual([]);
});

test('no tracked path is an absolute-path symlink to somewhere on the machine that made it', () => {
  const files = tracked();
  if (!files) return;
  // `git ls-files -s` prints the mode; 120000 is a symlink. Its blob is the target it points at.
  const out = execFileSync('git', ['ls-files', '-s', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
  const links = out.filter((l) => l.startsWith('120000')).map((l) => l.split('\t')[1]);
  const escaping = links.filter((f) => {
    const target = execFileSync('git', ['show', `HEAD:${f}`], { cwd: ROOT, encoding: 'utf8' });
    return path.isAbsolute(target.trim());
  });
  expect(escaping).toEqual([]);
});
