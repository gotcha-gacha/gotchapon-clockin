// The patched dependencies are real (#191). `pnpm.patchedDependencies` names a file per package, and the web app's Back
// button depends on the one patch there is (expo-router's forked history, PR #165): without it, Back can rebuild the whole
// app from the URL — sign-in under the mock, a waiting capsule losing its reveal.
//
// The other two checks see different things: `scripts/bundle-budget.mjs` reads the exported bundle, so it proves the
// patched behaviour as it ships, and `historyPatch.web.test.ts` runs the real module, so it is the only one that
// reproduces the bug. This file reads `package.json` and `node_modules`, which covers the window neither of them can see,
// measured on 20 Sept:
//
//   - A fresh install with the patch file missing DOES fail: `rm -rf node_modules` then `pnpm install --frozen-lockfile`
//     exits 254 with `ENOENT … patches/expo-router@<version>.patch`. So CI, EAS and a clean clone are covered by pnpm itself.
//   - With node_modules already there, `pnpm install --frozen-lockfile` answers "Already up to date" in ~120 ms and checks
//     nothing at all — not the patch file, not even whether the package is still on disk (it did not restore a deleted
//     `node_modules/expo-router`, with or without `--force`). A developer who deletes or renames the patch file, or bumps
//     expo-router without re-keying it, sees nothing until someone else's clean install.
//
// The version in the key is the other half: the patch is keyed to an exact version, so an upgrade that forgets to re-key it
// leaves a patch that names a version nobody installs.
import { expect, test } from '@jest/globals';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(__dirname, '../..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { pnpm?: { patchedDependencies?: Record<string, string> } };
const patched = Object.entries(pkg.pnpm?.patchedDependencies ?? {});

test('the repo still patches what this file is about', () => {
  // Not a fixed count: a second patch is allowed, none is not. If the expo-router patch is dropped because upstream landed
  // the line (expo/expo#50317), delete the expo-router expectation below — and this whole file only if expo-router is
  // the last patched dependency, since the two rows under it guard whatever else is patched.
  // `historyPatch.web.test.ts` and the export gate stay: they assert
  // the behaviour rather than the patch, so they go green by themselves the day upstream lands it and are what would
  // catch a revert (docs/BUILDS.md step 2, and CLAUDE.md's "either way ... must pass"). An earlier draft of this comment
  // said the gate goes too, which PR #198's round 2 caught still sitting here after the doc had been corrected.
  expect(patched.length).toBeGreaterThanOrEqual(1);
  expect(patched.map(([name]) => name.split('@')[0])).toContain('expo-router');
});

test.each(patched)('%s: the patch file named in package.json exists and is not empty', (_key, file) => {
  const p = path.join(root, file);
  expect(fs.existsSync(p)).toBe(true);
  expect(fs.readFileSync(p, 'utf8').length).toBeGreaterThan(0);
});

/** A key is `name@version` or, legally, a bare `name` — and a name may be scoped, so the version is after the LAST `@`.
 *  (Measured on pinned pnpm 10.0.0: a bare name installs and patches; a range key, `expo-router@~57.0.22`, is refused by
 *  pnpm itself, so the equality below cannot false-positive on one.) */
const keyed = patched.map(([key, file]) => {
  const at = key.lastIndexOf('@');
  return at > 0 ? { name: key.slice(0, at), version: key.slice(at + 1), file } : { name: key, version: null, file };
}).filter((k) => k.version !== null) as { name: string; version: string; file: string }[];

test('the versioned keys are the ones checked below, and there is at least one', () => {
  // A bare-name key has no version to compare, so it drops out of the table. Without this the row below would print and
  // pass while checking nothing — the failure mode a `return` inside a `test.each` body hides.
  expect(keyed.length).toBe(patched.length);
  // ...and the name is not a lie: with no patched dependencies at all, `toBe` above is 0 === 0 and passes (PR #198's
  // round 2). The count that matters is asserted here.
  expect(keyed.length).toBeGreaterThanOrEqual(1);
});

test.each(keyed)('$name: the version it is keyed to is the version installed', ({ name, version }) => {
  // Resolved rather than joined onto node_modules/: the hoisted layout is this repo's (`.npmrc`), but a patched
  // transitive dependency under any other linker would throw a bare ENOENT here instead of saying what is wrong.
  // Ask the resolver, then the disk, and let the disk decide what went wrong — not the error's `code`. Under jest the
  // resolver is jest-resolve, not Node's, and every failure it throws is `MODULE_NOT_FOUND`, so a branch keyed on
  // `ERR_PACKAGE_PATH_NOT_EXPORTED` never runs and the "hidden package.json" case would still have been reported as
  // "not installed" (measured, PR #203's reviews). That case is real: 68 of the 306 packages here with an `exports` map
  // hide their own package.json from a resolver. The disk is also what saves a non-hoisted layout, where the resolve is
  // what fails while `node_modules/<name>/package.json` is there as a symlink — the resolver is the one that copes with
  // a layout where there is no such path at all.
  let manifest: string;
  try {
    manifest = createRequire(path.join(root, 'package.json')).resolve(`${name}/package.json`);
  } catch {
    manifest = path.join(root, 'node_modules', name, 'package.json');
    if (!fs.existsSync(manifest)) throw new Error(`${name} is patched in package.json but is not installed — run pnpm install`);
  }
  expect((JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }).version).toBe(version);
});
