// What the web export's entry chunk is called. Metro names it after the app's entry module — `package.json` → `main` —
// so `expo-router/entry` gave `entry-<hash>.js` and `entrypoint.js` (F7.4, #6: the native polyfills load in front of
// expo-router's entry) gives `entrypoint-<hash>.js`.
//
// Derived, in one place, rather than written down in each of the two checks that read it. Both were hard-coded `entry-`,
// and renaming the entry module broke them in opposite directions on the same export: `bundle-budget.mjs` failed closed
// ("found 0: the budget DID NOT RUN", measured) while `gone.mjs`'s APP_MARKER quietly stopped matching its half — a
// deleted-URL probe that reads a page still serving the app would have called it gone. A name a check writes down about
// the build is a name that can drift from it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The entry chunk's basename before its hash, e.g. `entrypoint`. */
export const ENTRY_CHUNK = path.basename(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).main, '.js');
/** Regex-safe, for building patterns around it. */
export const ENTRY_CHUNK_RE = ENTRY_CHUNK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** One exported chunk's filename: the entry, and not a chunk that merely starts with the same letters. */
export const ENTRY_RE = new RegExp(`^${ENTRY_CHUNK_RE}-[a-f0-9]+\\.js$`);
