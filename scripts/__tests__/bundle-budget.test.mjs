// The export gate's own tests (#169; PR #177's second review: nothing in the repo tested its branches, so a revert to a weaker
// check would pass silently). node's own runner, so the script is tested as it runs, ESM and all:
// `node --test scripts/__tests__/bundle-budget.test.mjs`, run by `pnpm verify:web` before the gate checks the real export (the
// file is named, not globbed: on Node 22 and 24 a glob that matches nothing runs 0 tests and exits 0, PR #180's review). Every case builds a small export folder and runs the real
// `checkBudget` on it. The history fixtures are excerpts of the minified text of expo-router 57.0.22's two copies, from a real
// export: the middle of each `go()` is left out, and everything the check reads (the fork's anchor, the ~75 characters to its
// listener, the patched and shipped listeners) is verbatim.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBudget, checkHistoryPatch, ENTRY_CHUNK, ENTRY_GZ_CEILING, FIRST_PAINT_GZ_CEILING } from '../bundle-budget.mjs';

/** The repo root from a module URL. `fileURLToPath`, never `new URL(u).pathname`, which stays percent-encoded: the guard
 *  below read `…/spaced%20path/package.json` and threw ENOENT on a correct checkout whose path holds a space or a
 *  non-ASCII character, so `verify:web` could not pass from one (#169, measured from such a checkout). */
const rootFrom = (url) => path.resolve(path.dirname(fileURLToPath(url)), '..', '..');
const ROOT = rootFrom(import.meta.url);
/** What `node --test` auto-runs, measured on this repo's Node (24.14.1) over directories of one-test files: `x.test`,
 *  `x-test`, `x_test`, `test-x` and `test` — each in `.js`, `.cjs`, `.mjs`, `.ts`, `.cts` or `.mts`, never `.jsx` or
 *  `.tsx` — and EVERY file with one of those six extensions inside a directory named `test`, helpers included, at any
 *  depth. `.spec` is NOT node's (measured: it runs neither `.spec.mjs` nor `.spec.ts`); it is counted anyway, because a
 *  `.spec.mjs` put here would run nowhere just the same. */
const NODE_RUNS = /^test\.[cm]?[jt]s$|^test-.*\.[cm]?[jt]s$|[.\-_](?:test|spec)\.[cm]?[jt]s$/;
const NODE_EXT = /\.[cm]?[jt]s$/;
/** What jest's two projects already claim, so it does not run nowhere: `**\/*.{test,spec}.ts(x)` (package.json →
 *  `jest.projects[*].testMatch`). Measured with `jest --listTests`, which DOES claim a `.test.ts` placed under
 *  `scripts/` — so `.ts` is excluded because jest runs it, not because node does not.
 *  #169 round 2: `.mts` and `.cts` match neither jest's globs nor node's `.js`-only reading of this list, and
 *  `scripts/test/helper.ts` and `test.ts` match jest's globs either, so each ran nowhere with this guard silent —
 *  exactly the defect it exists to catch, one spelling over. The two rules are written from the two configs rather
 *  than from a list of names, so neither can drift without the other being read. */
const JEST_CLAIMS = /\.(?:test|spec)\.tsx?$/;
/** Would node's runner pick this basename up, with nothing else claiming it? */
const runsNowhere = (name, inTestDir) => (inTestDir ? NODE_EXT : NODE_RUNS).test(name) && !JEST_CLAIMS.test(name);
/** Every file under `dir` that node's runner would pick up, relative to `root`. A function, not a filter inlined in the
 *  guard, so a test can run it over a directory built on purpose: with the filter inlined, narrowing it back to
 *  `.test.mjs` left the whole suite green (measured, #169) because no file under scripts/ has another spelling — the
 *  guard's behaviour was identical either way, and only the constant was pinned.
 *  A consequence worth knowing: a future `scripts/test-utils.mjs`, or any helper under a `scripts/test/` directory,
 *  fails the gate until `verify:web` names it. That is node's own rule — it would run the file as a test — not this
 *  guard being over-eager, and the fix is to name it or to not put it there. */
const testFilesUnder = (root, dir) => {
  const found = [];
  const walk = (d, inTestDir) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, inTestDir || e.name === 'test');
      else if (runsNowhere(e.name, inTestDir)) found.push(path.relative(root, p));
    }
  };
  walk(dir, path.basename(dir) === 'test');
  return found;
};

// React Navigation's copy: its go() writes `this.index` on popstate, and its listener syncs.
const RN = `go(t){s();const c=n+t;return new Promise((i,s)=>{const w=()=>{n=this.index;const t=o.pop();window.removeEventListener('popstate',w),t?.cb()};window.addEventListener('popstate',w),window.history.go(t)})},listen(t){const i=()=>{n=this.index,o.length||t()};return window.addEventListener('popstate',i),()=>window.removeEventListener('popstate',i)}`;
// expo-router's fork: its go() settles the index with Math.max; LISTEN is its listener, patched or as shipped.
const FORK_GO = `go(t){s();const c=n+t;return new Promise((s,c)=>{const p=()=>{const t=window.history.state?.id,s=i.findIndex(n=>n.id===t);n=Math.max(s,0);const c=o.pop();window.removeEventListener('popstate',p),c?.cb()};window.addEventListener('popstate',p),window.history.go(t)})},`;
const PATCHED = `listen(t){const i=()=>{n=this.index,o.length||t()};return window.addEventListener('popstate',i),()=>window.removeEventListener('popstate',i)}`;
const SHIPPED = `listen(t){const n=()=>{o.length||t()};return window.addEventListener('popstate',n),()=>window.removeEventListener('popstate',n)}`;
const fork = (listen) => FORK_GO + listen;
const REACT_DOM = `window.addEventListener("popstate",x)`;
const SKIA = 'SkiaPictureView'; const CHROME = 'gachapon-shell-chrome-web-only'; const HTML2CANVAS = 'data-html2canvas-ignore';
const POSTHOG = 'https://us.i.posthog.com'; // posthogChunk (#143): the web SDK's default host, in the chunk and nowhere the page loads first
const PRIVY = 'gachapon-privy-web-only'; // privyWebChunk (W5.1): the marker written only in that chunk
const PRIVY_SDK = 'https://auth.privy.io'; // the SDK's own body (#280): lazy only when the library is, not just our wrapper

const made = [];
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); }); // PR #180's review: ~1 MB a run was left behind
/** A minimal export: the page names its scripts; chunks are written as given. */
/** The entry chunk's name as Metro writes it, from the same place the check reads it — so a rename of the app's entry
 *  module moves the fixture and the check together instead of leaving the suite green against a stale name. */
const ENTRY_JS = `${ENTRY_CHUNK}-aaaa.js`;
function makeExport({ entry, lazy = {}, scripts = [ENTRY_JS], page = true, extraPages = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'budget-')); made.push(dir);
  const js = path.join(dir, 'client', '_expo', 'static', 'js', 'web'); fs.mkdirSync(js, { recursive: true });
  fs.mkdirSync(path.join(dir, 'server'));
  if (page) fs.writeFileSync(path.join(dir, 'server', '[...path].html'), scripts.map((s) => `<script src="/_expo/static/js/web/${s}" defer></script>`).join(''));
  // Pages beside the entry one, by path relative to server/ — for the gone-check marker, which reads every page.
  for (const [name, body] of Object.entries(extraPages)) {
    const f = path.join(dir, 'server', name); fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  if (entry !== undefined) fs.writeFileSync(path.join(js, ENTRY_JS), entry);
  for (const [name, body] of Object.entries({ 'skiaChunk-bbbb.js': SKIA, 'ShellChrome-cccc.js': CHROME, 'posthogChunk-dddd.js': POSTHOG, 'privyWebChunk-eeee.js': `${PRIVY};${PRIVY_SDK}`, ...lazy })) if (body !== null) fs.writeFileSync(path.join(js, name), body);
  return dir;
}
// session.tsx's payment decision and paymentFlow.ts's mock signature, verbatim from the 25 Sept export (`__DEV__` false folds
// the EXPO_PUBLIC_DEV_PAYMENTS half to `!1`; `usingMock` stays a binding).
const DECISION = 'P=(e,t)=>({prepared:e,useMockPayment:r.usingMock||!1,expected:S.expectedUsdcPayment,authority:t})';
const PRODUCER = 'e.signPreparedTransfer=async function(n){if(n.useMockPayment)return`mock:${n.prepared.pullId}`;const s=n.';
const PAYMENT_DECISION = `${DECISION};${PRODUCER}`;
const GOOD_ENTRY = `${REACT_DOM};${RN};${fork(PATCHED)};${PAYMENT_DECISION}`;
const run = (o) => checkBudget(makeExport(o));
const fails = (r) => r.lines.filter((l) => l.startsWith('FAIL')).join('\n');

test('a good export passes every check', () => {
  const r = run({ entry: GOOD_ENTRY });
  assert.equal(r.ok, true, fails(r));
  assert.ok(r.lines.some((l) => /history patch: the fork's own popstate listener syncs/.test(l)));
});

// ---- the history patch ----
const history = (...texts) => checkHistoryPatch(texts);
test('history: patched fork + React Navigation copy passes', () => { assert.equal(history(REACT_DOM, RN, fork(PATCHED)), null); });
test('history: the fork as shipped fails (unsynced)', () => { assert.match(history(RN, fork(SHIPPED)), /NOT in the bundle: 1/); });
test('history: the shipped listener with longer minified names still fails', () => {
  assert.match(history(RN, fork(SHIPPED.replaceAll('listen(t)', 'listen(tt)').replace('const n=()=>{o.length||t()}', 'const nn=()=>{oo.length||tt()}'))), /NOT in the bundle/);
});
// PR #177's reviews: shapes that "at least one" and "exactly two" synced listeners both let through.
for (const [what, listen] of [
  ['`let` instead of `const`', 'listen(t){let n=()=>{o.length||t()};return window.addEventListener(\'popstate\',n)}'],
  ['a function expression', 'listen(t){const n=function(){o.length||t()};return window.addEventListener(\'popstate\',n)}'],
  ['`o.length>0||`', 'listen(t){const n=()=>{o.length>0||t()};return window.addEventListener(\'popstate\',n)}'],
  ['a guard first', 'listen(t){const n=()=>{if(!t)return;o.length||t()};return window.addEventListener(\'popstate\',n)}'],
  ['synced a different variable after the check', 'listen(t){const i=()=>{o.length||t(),n=this.index};return window.addEventListener(\'popstate\',i)}'],
]) {
  test(`history: the fork's listener reshaped (${what}) fails`, () => { assert.match(history(RN, fork(listen)), /not the synced shape|NOT in the bundle/); });
  test(`history: reshaped (${what}) plus a third synced copy still fails`, () => { assert.notEqual(history(RN, RN, fork(listen)), null); });
}
test('history: the fork\'s listen() removed fails, and says so', () => { assert.match(history(RN, FORK_GO + 'foo(){}'), /no listen\(\) within/); });
test('history: the fork gone (only React Navigation\'s copy) fails', () => { assert.match(history(REACT_DOM, RN), /found 0/); });
test('history: the fork twice fails', () => { assert.match(history(RN, fork(PATCHED), fork(PATCHED)), /found 2/); });
test('history: a listen() too far after the fork\'s go() fails', () => { assert.match(history(RN, FORK_GO + 'x'.repeat(500) + PATCHED), /no listen\(\) within/); });
test('history: no chunk mentions popstate says it DID NOT RUN', () => { assert.match(history(), /DID NOT RUN/); });
test('history: through checkBudget, an export with no popstate anywhere says DID NOT RUN', () => {
  assert.match(fails(run({ entry: 'nothing here' })), /history-patch check DID NOT RUN/);
});

// PR #180's review: gaps its extra mutants found (each would fail closed or needs a second change, but the tests could not see them).
const LET = "listen(t){let n=()=>{o.length||t()};return window.addEventListener('popstate',n)}";
test('history: in one chunk, as a real export lays it out, the listener checked is the one after the fork, not the first', () => {
  // React Navigation's copy and other listen(() => …) calls come before the fork in the same chunk (module order in the entry).
  const chunk = `${REACT_DOM};${RN};x.listen(()=>{});y.listen(()=>{});${fork(LET)}`;
  assert.match(history(chunk), /not the synced shape/);
  assert.equal(history(`${REACT_DOM};${RN};x.listen(()=>{});${fork(PATCHED)}`), null);
});
test('history: a Math.max(x,0) elsewhere is not the fork', () => {
  assert.equal(history(`${RN};const w=Math.max(q,0);${fork(PATCHED)}`), null);
  assert.equal(history(`${RN};r=Math.max(q,0),z();${fork(PATCHED)}`), null);
});
test('history: the synced shape must start the fork\'s listener, not appear somewhere in the 200 characters after it', () => {
  assert.match(history(RN, fork(LET) + ';' + PATCHED), /not the synced shape/);
});
test('history: a patched fork does not excuse an unsynced listener elsewhere', () => {
  assert.match(history(RN, fork(PATCHED), `other.${SHIPPED}`), /NOT in the bundle: 1/);
  assert.match(history(`other.${SHIPPED}`, RN, fork(PATCHED)), /NOT in the bundle: 1/); // in a chunk before the fork's, too
});
// `$` is a legal minified name. The fork's own listener losing it fails closed (the synced shape would not match), but a
// NON-fork unsynced listener losing it fails OPEN: dropping `$` from HISTORY_UNSYNCED's classes left the whole suite green
// (measured, #169), and this is the case that kills it.
test('history: an unsynced listener with `$` in its minified names is still counted', () => {
  // `$t$` / `$n$` / `$o$`: each name needs `$` at BOTH ends, so both halves of all three character classes are
  // load-bearing here. With leading-only names (`$t`), dropping `$` from the first class's `[\w$]*` survived (#169 r2).
  const dollar = SHIPPED
    .replace('listen(t){const n=()=>{o.length||t()}', 'listen($t$){const $n$=()=>{$o$.length||$t$()}')
    .replaceAll("'popstate',n)", "'popstate',$n$)");
  assert.notEqual(dollar, SHIPPED); // the variant really differs
  assert.match(history(RN, fork(PATCHED), `other.${dollar}`), /NOT in the bundle: 1/);
});
// The minifier's other spellings of the fork's go() (a comma join, `let` / `var`, double quotes) still find the fork.
for (const [what, go] of [
  ['a comma join', FORK_GO.replace('n=Math.max(s,0);const c=o.pop();', 'n=Math.max(s,0),c=o.pop(),')],
  ['`let`', FORK_GO.replace('const c=o.pop()', 'let c=o.pop()')],
  ['`var`', FORK_GO.replace('const c=o.pop()', 'var c=o.pop()')],
  ['double quotes', FORK_GO.replace("removeEventListener('popstate'", 'removeEventListener("popstate"')],
  ['longer minified names', FORK_GO.replace('n=Math.max(s,0);const c=o.pop();', 'nn=Math.max(ss,0);const cc=oo.pop();')],
  ['`$` in the names', FORK_GO.replace('n=Math.max(s,0);const c=o.pop();', '$n=Math.max(s$,0);const c$=$o.pop();')],
]) {
  test(`history: the fork's go() written with ${what} is still found`, () => {
    assert.notEqual(go, FORK_GO); // the variant really differs
    assert.equal(history(RN, go + PATCHED), null);
    assert.match(history(RN, go + SHIPPED), /NOT in the bundle/);
  });
}
// Two forks in ONE chunk: keeping only the first anchor match per chunk left the suite green (measured, #169). The count
// is what tells the check it can still find the fork's listener, so it must see both.
test('history: the fork twice in one chunk fails (every anchor is counted, not the first per chunk)', () => {
  assert.match(history(RN, `${fork(PATCHED)};${fork(PATCHED)}`), /exactly once, found 2/);
});
test('the fork in a lazily loaded chunk is still checked (every chunk, not only the first paint)', () => {
  const r = run({ entry: `${REACT_DOM};${RN};${PAYMENT_DECISION}`, lazy: { 'router-eeee.js': fork(PATCHED) } });
  assert.equal(r.ok, true, fails(r));
  assert.match(fails(run({ entry: `${REACT_DOM};${RN}`, lazy: { 'router-eeee.js': fork(SHIPPED) } })), /NOT in the bundle/);
});

test('history: the fork\'s patched listener with longer minified names passes (a narrower match would fail closed)', () => {
  const long = PATCHED.replace('listen(t){const i=()=>{n=this.index,o.length||t()}', 'listen(tt){const ii=()=>{nn=this.index,oo.length||tt()}');
  assert.notEqual(long, PATCHED);
  assert.equal(history(RN, FORK_GO + long), null);
});

// What the gate's export is pinned to (#182). Without these, it compiles whatever the machine-wide Metro cache was last
// left holding and whatever `.env.local` says — measured: one unchanged command produced a bundle with the mock compiled
// in after a mock-on export elsewhere, and without it after a mock-off one. The numbers in bundle-budget.mjs's header,
// and the ceiling itself, are only meaningful for the pinned flavour, so this fails if any of it is dropped.
test('verify:web pins the export it measures: private cache, no dotenv, mock off', () => {
  const verifyWeb = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['verify:web'];
  const exportCmd = verifyWeb.slice(verifyWeb.indexOf('expo export'));
  const PINS = [
    ['a Metro cache of its own', 'TMPDIR=$PWD/.expo/verify-cache'],
    ['no .env.local', 'EXPO_NO_DOTENV=1'],
    ['the mock off, as a visitor is served', 'EXPO_PUBLIC_USE_MOCK=0'],
    ['no ambient API URL', 'EXPO_PUBLIC_API_URL='],
    ['no ambient Privy app id', 'EXPO_PUBLIC_PRIVY_APP_ID='],
    ['no ambient mobile Privy client id', 'EXPO_PUBLIC_PRIVY_CLIENT_ID='],
    ['no ambient web Privy client id', 'EXPO_PUBLIC_PRIVY_CLIENT_ID_WEB='],
  ];
  for (const [what, needle] of [...PINS, ['the directory for it', 'mkdir -p .expo/verify-cache']]) {
    assert.ok(verifyWeb.includes(needle), `verify:web no longer gives the export ${what} (${needle})`);
  }
  // Each pin between `expo export` and the command before it — an assignment before `node --test`, or after the export,
  // never reaches the exporting process. (Four separate assertions: checking only one let four mutants live.)
  const beforeExport = verifyWeb.slice(verifyWeb.lastIndexOf('&&', verifyWeb.indexOf('expo export')), verifyWeb.indexOf('expo export'));
  for (const [what, needle] of PINS) {
    assert.ok(beforeExport.includes(needle), `${needle} (${what}) is in verify:web but not in front of the export it pins`);
  }
  // And the artifact is checked, not just this command: a cache once written mock-on keeps answering mock-on.
  assert.ok(exportCmd.includes('--no-mock'), 'the budget must be asked to check the flavour of what was exported (--no-mock)');
  // The directory exported to and the directory measured must be the same one. `expo export` empties its own output dir
  // first, so pointing them apart leaves the budget reading the previous run's export indefinitely — #182's own defect
  // coming back in through the guard meant to close it.
  const exportedTo = /--output-dir (\S+)/.exec(verifyWeb)?.[1];
  const measured = /bundle-budget\.mjs (\S+)/.exec(verifyWeb)?.[1];
  assert.ok(exportedTo, 'verify:web no longer names an --output-dir');
  assert.equal(measured, exportedTo, 'the budget measures a different directory than the export writes');
  // A pin can be overridden as well as dropped: in sh the last assignment wins, so each must appear exactly once.
  for (const [what, needle] of PINS) {
    assert.equal(beforeExport.split(needle.split('=')[0] + '=').length - 1, 1, `${needle.split('=')[0]} (${what}) is set more than once in front of the export; the last one would win`);
  }
});

// PR #181's review: naming the test file closed the zero-match glob, and opened another hole: a new test file there would run
// nowhere (jest only matches .ts/.tsx). This one fails when any test file under scripts/ is not named in `verify:web`.
// It read `.test.mjs` alone until #169, so a `.test.js` or `.spec.mjs` there still ran nowhere and this guard said nothing.
test('every test file under scripts/ is run by verify:web', () => {
  const verifyWeb = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts['verify:web'];
  const found = testFilesUnder(ROOT, path.join(ROOT, 'scripts'));
  assert.ok(found.length > 0);
  for (const f of found) assert.ok(verifyWeb.includes(f), `${f} is not run by verify:web`);
});

test('the repo root is found from a checkout path holding a space or a non-ASCII character', () => {
  assert.equal(rootFrom('file:///tmp/a b/repo/scripts/__tests__/t.test.mjs'), path.resolve('/tmp/a b/repo'));
  assert.equal(rootFrom('file:///tmp/caf%C3%A9/scripts/__tests__/t.test.mjs'), path.resolve('/tmp/caf\u00e9'));
});
// Over a directory built for it, so this exercises the walk the guard runs, not a regex on its own: narrowing the filter
// back to `.test.mjs` kills this, and killed nothing before (#169). Every name below was run through bare `node --test`
// first, except the `.spec` ones, which node does not run and this counts on purpose (see NODE_RUNS), and the two jest
// claims. The `test/` directory carries a nested directory and a second extension so the recursion and the extension
// set are each load-bearing here, not only in the comment.
test('the walk finds every file that would run nowhere, over a real directory', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-')); made.push(d);
  for (const sub of ['scripts/__tests__', 'scripts/test/deep', 'scripts/lib']) fs.mkdirSync(path.join(d, sub), { recursive: true });
  const counted = [
    // node runs them, jest claims none of them
    'scripts/__tests__/a.test.mjs', 'scripts/__tests__/a.test.js', 'scripts/__tests__/a.test.cjs',
    'scripts/__tests__/a.test.mts', 'scripts/__tests__/a.test.cts',
    'scripts/__tests__/b-test.mjs', 'scripts/__tests__/b_test.mjs', 'scripts/__tests__/test-b.mjs',
    'scripts/__tests__/test-.js', // `test-` with nothing after it: node runs it
    'scripts/__tests__/test.mjs', 'scripts/__tests__/test.ts', 'scripts/__tests__/a-test.ts',
    'scripts/__tests__/a.spec.mjs', 'scripts/__tests__/a.spec.js', // not node's; counted on purpose
    // a `test/` directory: node runs everything in it, at any depth, helpers included
    'scripts/test/inner.mjs', 'scripts/test/helper.ts', 'scripts/test/plain.cjs', 'scripts/test/deep/nested.mjs',
  ];
  const not = [
    'scripts/__tests__/a.test.ts', 'scripts/__tests__/a.test.tsx', // jest's two projects claim these
    'scripts/__tests__/a.test.jsx', // node does not run .jsx
    'scripts/__tests__/plain.mjs', 'scripts/__tests__/testing.mjs', 'scripts/__tests__/protest.mjs',
    'scripts/lib/helper.mjs',
  ];
  for (const f of [...counted, ...not]) fs.writeFileSync(path.join(d, f), '');
  assert.deepEqual(testFilesUnder(d, path.join(d, 'scripts')).sort(), [...counted].sort());
  // started ON a `test/` directory, which the guard does not do but the function allows
  assert.deepEqual(testFilesUnder(d, path.join(d, 'scripts', 'test')).sort(),
    counted.filter((f) => f.startsWith('scripts/test/')).sort());
});

// ---- the rest of the gate ----
test('an entry over the ceiling fails', () => {
  const big = crypto.randomBytes(ENTRY_GZ_CEILING + 50_000).toString('base64'); // does not compress
  assert.match(fails(run({ entry: GOOD_ENTRY + big })), /over the ceiling/);
});
test('Skia in what the page loads first fails', () => { assert.match(fails(run({ entry: GOOD_ENTRY + SKIA })), /Skia's JS is in what the page loads first/); });
test('PostHog in what the page loads first fails (#143: the SDK is five times the entry chunk\'s headroom)', () => {
  assert.match(fails(run({ entry: `${GOOD_ENTRY};${POSTHOG}` })), /PostHog .* is in what the page loads first/);
});
test('the PostHog marker in no chunk fails (the check could no longer see it)', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'posthogChunk-dddd.js': null } })), /PostHog .*: its marker .* is in no chunk/);
});
test('Privy in what the page loads first fails (W5.1: the SDK stays out of the entry chunk)', () => {
  assert.match(fails(run({ entry: `${GOOD_ENTRY};${PRIVY}` })), /Privy web SDK .* is in what the page loads first/);
});
test('the Privy marker in no chunk fails (the check could no longer see it)', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'privyWebChunk-eeee.js': null } })), /Privy web SDK .*: its marker .* is in no chunk/);
});
// #280: `__common` carried Privy's whole SDK into every first paint while the entry chunk passed its ceiling and the wrapper's
// marker passed as lazy. Each of these fails on that export shape.
const COMMON_JS = '__common-ffff.js';
test("Privy's SDK body in __common, loaded first, fails although the wrapper is lazy (#280)", () => {
  const r = run({ entry: GOOD_ENTRY, scripts: [COMMON_JS, ENTRY_JS], lazy: { 'privyWebChunk-eeee.js': PRIVY, [COMMON_JS]: PRIVY_SDK } });
  assert.match(fails(r), /Privy's SDK body .* is in what the page loads first \(__common-ffff\.js\)/);
  assert.ok(r.lines.some((l) => /ok {3}Privy web SDK .*only in privyWebChunk/.test(l)), 'the wrapper alone still reads as lazy: that is why the body has its own marker');
});
test("the Privy SDK body's marker in no chunk fails (the check could no longer see it)", () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'privyWebChunk-eeee.js': PRIVY } })), /Privy's SDK body .*: its marker .* is in no chunk/);
});
test('a first paint over its ceiling fails even with the entry under its own (#280)', () => {
  const big = crypto.randomBytes(FIRST_PAINT_GZ_CEILING).toString('base64'); // does not compress; the entry stays small
  const r = run({ entry: GOOD_ENTRY, scripts: [COMMON_JS, ENTRY_JS], lazy: { [COMMON_JS]: big } });
  assert.match(fails(r), /what the page loads first .* over the first-paint ceiling/);
  assert.doesNotMatch(fails(r), /the entry chunk is .* over the ceiling/);
});
test('the first-paint ceiling sits just above the entry ceiling: it is there to catch a new eager script, not to be a second, looser budget', () => {
  // What may legitimately load beside the entry is Metro's runtime (~1.5 KB, split out only when a __common exists). A
  // first-paint ceiling far above the entry's would let a whole __common back in unseen, which is #280 all over again.
  assert.ok(FIRST_PAINT_GZ_CEILING >= ENTRY_GZ_CEILING, 'a first paint cannot be smaller than the entry chunk in it');
  assert.ok(FIRST_PAINT_GZ_CEILING - ENTRY_GZ_CEILING <= 10_000, `${FIRST_PAINT_GZ_CEILING - ENTRY_GZ_CEILING} bytes of room beside the entry`);
});
test('a first paint under its ceiling passes, and the report names the ceiling', () => {
  const r = run({ entry: GOOD_ENTRY, scripts: [COMMON_JS, ENTRY_JS], lazy: { [COMMON_JS]: 'var shared=1' } });
  assert.equal(r.ok, true, fails(r));
  assert.ok(r.lines.some((l) => new RegExp(`the page loads 2 script\\(s\\), \\d+ gzipped \\(ceiling ${FIRST_PAINT_GZ_CEILING}\\)`).test(l)));
});
test('the chrome marker in no chunk fails (the check could no longer see it)', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'ShellChrome-cccc.js': null } })), /chrome: its marker .* is in no chunk/);
});
test('html2canvas anywhere fails', () => { assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'other-dddd.js': HTML2CANVAS } })), /html2canvas .* is in the export/); });
test('no page, no script, a missing script or two entries: DID NOT RUN', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, page: false })), /no page .* DID NOT RUN/);
  assert.match(fails(run({ entry: GOOD_ENTRY, scripts: [] })), /names no script: the budget DID NOT RUN/);
  assert.match(fails(run({ entry: GOOD_ENTRY, scripts: [ENTRY_JS, `${ENTRY_CHUNK}-zzzz.js`] })), /does not have .*DID NOT RUN/);
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { [`${ENTRY_CHUNK}-bbbb.js`]: 'x' }, scripts: [ENTRY_JS, `${ENTRY_CHUNK}-bbbb.js`] })), /found 2: the budget DID NOT RUN/);
});

// The entry chunk is found by the app's own entry module, not by a name written down here (#6: `main` became
// `entrypoint.js` so the native polyfills load before expo-router's entry, and the gate answered "found 0" on a correct
// export until this was derived).
test("the entry chunk's name comes from package.json's main", () => {
  const main = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).main;
  assert.equal(ENTRY_CHUNK, path.basename(main, '.js'));
  // A page that names a chunk under any other name is not this app's entry, and the budget refuses to run rather than
  // measure whatever else it found.
  assert.match(fails(run({ entry: GOOD_ENTRY, scripts: ['somethingelse-aaaa.js'], lazy: { 'somethingelse-aaaa.js': GOOD_ENTRY } })), /found 0: the budget DID NOT RUN/);
});

// ---- the gone-check marker (#189) ----
// `web-probe.mjs --expect gone` tells a deleted URL from a 404 still serving the app by looking for these markers, and its
// first version looked for strings no exported byte carries, so the check could never fire. This branch is what keeps that
// from coming back — and it had no test at all: deleting its filter, or its no-pages guard, survived the whole suite
// (measured, PR #197's round 2).
const MARKED = '<meta property="og:site_name" content="Gotchapon"/>';
test('gone-check marker: a page carrying neither marker fails the export', () => {
  const r = run({ entry: GOOD_ENTRY, extraPages: { 'odds.html': '<html>nothing the probe would recognise</html>' } });
  assert.match(fails(r), /carry neither marker/);
});

test('gone-check marker: every page carrying one passes, including a page in a subdirectory', () => {
  const r = run({ entry: GOOD_ENTRY, extraPages: { 'odds.html': MARKED, 'card/[cardId].html': MARKED } });
  assert.equal(fails(r), '');
  assert.match(r.lines.join('\n'), /gone-check marker: all 3 exported page\(s\) carry it/); // the entry page counts too
});

test('gone-check marker: a page in a subdirectory carrying neither is not missed', () => {
  // The first version read `server/` non-recursively, so `server/card/[cardId].html` was never looked at.
  const r = run({ entry: GOOD_ENTRY, extraPages: { 'card/[cardId].html': '<html>no markers here</html>' } });
  assert.match(fails(r), /carry neither marker/);
});

test('an export with no page at all is refused before any check reads one', () => {
  // Why the marker branch needs no empty-pages guard of its own: this return happens first, so it is the only way to
  // reach the checks with nothing to read.
  assert.match(fails(checkBudget(makeExport({ entry: GOOD_ENTRY, page: false }))), /no page at .*the budget DID NOT RUN/);
});

// The flavour of the artifact (#182, PR #205's review). The pin is on the command; this is on what the command produced,
// because Metro's transform cache does not key on `EXPO_PUBLIC_*` — a `.expo/verify-cache` once written by a mock-on
// export answers mock-on however the gate is invoked, and nothing else would notice.
// The shapes a real export has, measured on both flavours: the mock's definition is in the bundle either way (the api
// module imports it unconditionally), and only the call site's `)(` differs.
const MOCK_DEFINITION = '_e.createMockApi=function(){};';
const NO_MOCK_ENTRY = `${GOOD_ENTRY};${MOCK_DEFINITION}const c=!1,p=null,f=(0,t.createHttpApi)({baseUrl:""});`;
const MOCK_ENTRY = `${NO_MOCK_ENTRY};const f2=(0,n.createMockApi)();`;

test('flavour: a mock-on export fails the gate when it asked for no mock', () => {
  const r = checkBudget(makeExport({ entry: MOCK_ENTRY }), { expectNoMock: true });
  assert.match(fails(r), /has the in-app mock compiled in/);
});

test('flavour: the same export passes when nobody asked (a demo deploy is mock-on on purpose)', () => {
  assert.equal(fails(checkBudget(makeExport({ entry: MOCK_ENTRY }))), '');
});

test('flavour: a mock-off export passes, and says so, so the check is visibly running', () => {
  const r = checkBudget(makeExport({ entry: NO_MOCK_ENTRY }), { expectNoMock: true });
  assert.equal(fails(r), '');
  assert.match(r.lines.join('\n'), /ok +the flavour: the in-app mock is not compiled/);
});

// The positive control. Without it the check's PASS is the absence of a string, which is what "a check whose marker
// vanished would pass forever" means — and renaming the marker did print "ok" on a real export before it existed.
test('flavour: a bundle with no trace of the mock at all is refused, not passed', () => {
  const r = checkBudget(makeExport({ entry: GOOD_ENTRY }), { expectNoMock: true });
  assert.match(fails(r), /can no longer see what it checks/);
});

test('flavour: the call site is what decides, not the definition beside it', () => {
  // Both fixtures carry the definition; only MOCK_ENTRY calls it.
  assert.ok(NO_MOCK_ENTRY.includes('createMockApi') && !NO_MOCK_ENTRY.includes('createMockApi)('));
  assert.equal(fails(checkBudget(makeExport({ entry: NO_MOCK_ENTRY }), { expectNoMock: true })), '');
  assert.match(fails(checkBudget(makeExport({ entry: MOCK_ENTRY }), { expectNoMock: true })), /compiled in/);
});

// EXPO_PUBLIC_DEV_PAYMENTS (#206): a development build may commit `mock:<pullId>` against a mock-payments worker. CLAUDE.md
// requires it provably absent from every EAS profile and every web export. An export is built with `__DEV__` false, so the
// gate in session.tsx folds the flag's half of the payment decision to `!1`; the check reads that from the artifact.
test('dev payments: the folded decision passes, and says so', () => {
  const r = run({ entry: GOOD_ENTRY });
  assert.equal(fails(r), '');
  assert.match(r.lines.join('\n'), /ok +dev payments: EXPO_PUBLIC_DEV_PAYMENTS is folded off/);
});

test('dev payments: a decision whose dev half is not false fails, on a mock-on and a mock-off export alike', () => {
  for (const decision of ['useMockPayment:r.usingMock||!0', 'useMockPayment:r.usingMock||"1"===n.env.EXPO_PUBLIC_DEV_PAYMENTS', 'useMockPayment:!0',
    // A `!1` elsewhere in the value is not the dev half being off: only the last operand is.
    'useMockPayment:r.usingMock?!1:!0', 'useMockPayment:!1||!0']) {
    const entry = GOOD_ENTRY.replace('useMockPayment:r.usingMock||!1', decision);
    assert.notEqual(entry, GOOD_ENTRY); // the control: the fixture really changed
    assert.match(fails(run({ entry })), /EXPO_PUBLIC_DEV_PAYMENTS half is not folded to false/);
    assert.match(fails(checkBudget(makeExport({ entry }), { expectNoMock: true })), /not folded to false/);
  }
});

test('dev payments: no decision anywhere, or two, is refused rather than passed', () => {
  assert.match(fails(run({ entry: `${REACT_DOM};${RN};${fork(PATCHED)}` })), /found 0: the dev-payments check can no longer see/);
  // The decision alone in the second chunk, so the count of decisions is what fails, not the count of mock signatures.
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'other-ffff.js': DECISION } })), /found 2: the dev-payments check can no longer see/);
});

test('dev payments: the decision in a lazily loaded chunk is still read', () => {
  const lazyOnly = { 'session-ffff.js': PAYMENT_DECISION.replace('||!1', '||!0') };
  assert.match(fails(run({ entry: `${REACT_DOM};${RN};${fork(PATCHED)}`, lazy: lazyOnly })), /not folded to false/);
});

test('dev payments: anything but `<x>.usingMock` in front of `||!1` fails', () => {
  for (const decision of ['useMockPayment:r.usingMock||o.devPay||!1', 'useMockPayment:r.usingMock&&!0||!1', 'useMockPayment:o.devPay||!1']) {
    assert.match(fails(run({ entry: GOOD_ENTRY.replace('useMockPayment:r.usingMock||!1', decision) })), /not folded to false/);
  }
});

test('dev payments: a second reader of the flag at the mock signature fails, though the decision is folded', () => {
  // PR #255's review: `if (input.useMockPayment || process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1')` exported with the flag at 1
  // compiled to this (the flag's half folded to true, the `if` gone), and a check on the decision alone passed it.
  const unguarded = PAYMENT_DECISION.replace('if(n.useMockPayment)return`mock:', 'return n.useMockPayment,`mock:');
  assert.notEqual(unguarded, PAYMENT_DECISION);
  assert.match(fails(run({ entry: GOOD_ENTRY.replace(PAYMENT_DECISION, unguarded) })), /found 1 template\(s\), 0 so guarded/);
});

test('dev payments: a second mock signature anywhere fails', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'other-ffff.js': 'return`mock:${x.id}`' } })), /found 2 template\(s\), 1 so guarded/);
});

test('dev payments: no mock signature at all is refused, not passed (the check could no longer see it)', () => {
  assert.match(fails(run({ entry: GOOD_ENTRY.replace(PRODUCER, '') })), /found 0 template\(s\), 0 so guarded/);
});

/** Build profiles that set EXPO_PUBLIC_DEV_PAYMENTS, at the profile level or per platform (eas-json allows `env` in
 *  `build.<profile>.ios` / `.android` too; PR #255's review found the profile-level read missed those). */
const devPaymentsSetters = (eas) => Object.entries(eas.build ?? {}).flatMap(([name, p]) =>
  [['', p], ['.ios', p.ios], ['.android', p.android]]
    .filter(([, scope]) => scope?.env && Object.hasOwn(scope.env, 'EXPO_PUBLIC_DEV_PAYMENTS'))
    .map(([where]) => `${name}${where}`));

test('dev payments: no EAS build profile sets EXPO_PUBLIC_DEV_PAYMENTS, per platform included', () => {
  const eas = JSON.parse(fs.readFileSync(path.join(ROOT, 'eas.json'), 'utf8'));
  const profiles = Object.keys(eas.build ?? {});
  assert.ok(profiles.length >= 5, `eas.json has ${profiles.length} build profiles: this check is reading the wrong file`); // the control
  assert.deepEqual(devPaymentsSetters(eas), []);
  // ... and the reader finds every spelling, so the empty answer above means something.
  const set = { env: { EXPO_PUBLIC_DEV_PAYMENTS: '1' } };
  assert.deepEqual(devPaymentsSetters({ build: { a: set, b: { ios: set }, c: { android: set }, d: { env: {} } } }), ['a', 'b.ios', 'c.android']);
});

/** The lines of a file that read EXPO_PUBLIC_DEV_PAYMENTS as code. Block comments are cut out of each line first, so
 *  `/* x *\/ export const y = process.env.EXPO_PUBLIC_DEV_PAYMENTS` is a reader (skipping every line that merely started
 *  with `/*` let one through: PR #261's review); what is left starting with `//`, `*` or `/*` is comment. */
const flagReaders = (text) => text.split('\n').flatMap((line, i) => {
  // A leading `…*/` closes a comment opened on an earlier line: what follows it is code (PR #261's round 2).
  const code = line.replace(/^.*?\*\//, '').replace(/\/\*.*?\*\//g, '').trim();
  return code.includes('EXPO_PUBLIC_DEV_PAYMENTS') && !/^(?:\/\/|\*|\/\*)/.test(code) ? [{ line: i + 1, code }] : [];
});

test('dev payments: a comment is not a reader, and code behind a comment is', () => {
  assert.deepEqual(flagReaders('// EXPO_PUBLIC_DEV_PAYMENTS\n * EXPO_PUBLIC_DEV_PAYMENTS\n/* EXPO_PUBLIC_DEV_PAYMENTS */\n/** EXPO_PUBLIC_DEV_PAYMENTS'), []);
  for (const line of ["/* dev */ export const d = process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1';",
    " */ export const d = process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1';"]) {
    assert.deepEqual(flagReaders(line).map((r) => r.code), ["export const d = process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1';"]);
  }
});

test('dev payments: the app reads the flag in one place, on exactly the gated line (covers native, which no export gate reads)', () => {
  // Every file the app can bundle, from git's own list (tracked, plus untracked files that are not ignored: a new file counts
  // before its first commit, a local ignored folder never does), in every JS/TS extension; not the worker (its own bundle),
  // this gate's own scripts, the pack's reference folders, or tests and their setup (PR #255's and #261's reviews).
  const GATED = "useMockPayment: usingMock || (__DEV__ && process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1'),";
  const NOT_APP = /^(?:server|scripts|docs|design|prototypes|data|model|patches|\.github|\.claude|\.cursor|\.vscode)\/|\/__(?:tests|fixtures)__\//;
  const CODE = /\.(?:[cm]?[jt]s|[jt]sx)$/;
  const TEST_OR_SETUP = /\.test\.|^jest\.[^/]*$/;
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0').filter((f) => f && CODE.test(f) && !NOT_APP.test(f) && !TEST_OR_SETUP.test(f) && fs.existsSync(path.join(ROOT, f)));
  assert.ok(files.length > 100 && files.includes('entrypoint.js'), `read ${files.length} code files: this check is not reading the app`); // the control
  const readers = files.flatMap((f) => flagReaders(fs.readFileSync(path.join(ROOT, f), 'utf8')).map((r) => ({ at: `${f}:${r.line}`, code: r.code })));
  assert.equal(readers.length, 1, `EXPO_PUBLIC_DEV_PAYMENTS is read at: ${readers.map((r) => r.at).join(', ')}`);
  // The whole line, not a substring: `!(__DEV__ && …)` or `(__DEV__ && …) || x` contain the gate and undo it.
  assert.equal(readers[0].code, GATED, `${readers[0].at} is not the gated line`);
});

test('dev payments: a concatenated mock signature counts like the template', () => {
  const concat = (guarded) => PAYMENT_DECISION.replace('if(n.useMockPayment)return`mock:${n.prepared.pullId}`', guarded ? 'if(n.useMockPayment)return"mock:"+n.prepared.pullId' : 'return n.useMockPayment,"mock:"+n.prepared.pullId');
  assert.equal(fails(run({ entry: GOOD_ENTRY.replace(PAYMENT_DECISION, concat(true)) })), ''); // guarded: fine
  assert.match(fails(run({ entry: GOOD_ENTRY.replace(PAYMENT_DECISION, concat(false)) })), /found 1 template\(s\), 0 so guarded/);
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'other-ffff.js': 'return"mock:"+x.id' } })), /found 2 template\(s\), 1 so guarded/);
  // ... and in single quotes, which is how this repo's minifier writes strings (`startsWith('mock:')` in every export).
  const single = (guarded) => PAYMENT_DECISION.replace('if(n.useMockPayment)return`mock:${n.prepared.pullId}`', guarded ? "if(n.useMockPayment)return'mock:'+n.prepared.pullId" : "return n.useMockPayment,'mock:'+n.prepared.pullId");
  assert.equal(fails(run({ entry: GOOD_ENTRY.replace(PAYMENT_DECISION, single(true)) })), '');
  assert.match(fails(run({ entry: GOOD_ENTRY.replace(PAYMENT_DECISION, single(false)) })), /found 1 template\(s\), 0 so guarded/);
  assert.match(fails(run({ entry: GOOD_ENTRY, lazy: { 'other-ffff.js': "return'mock:'+x.id" } })), /found 2 template\(s\), 1 so guarded/);
});

test("dev payments: the commit wire's startsWith('mock:') is not a mock signature", () => {
  // pullCommitWireRequest in paymentFlow.ts, as the export has it (single quotes), and in double quotes.
  assert.equal(fails(run({ entry: `${GOOD_ENTRY};n.txSignature&&!n.txSignature.startsWith('mock:')` })), '');
  assert.equal(fails(run({ entry: `${GOOD_ENTRY};n.txSignature&&!n.txSignature.startsWith("mock:")` })), '');
});

