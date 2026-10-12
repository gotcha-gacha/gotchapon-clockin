#!/usr/bin/env node
// The web bundle budget (W3.5, #142), run by `pnpm verify:web` on its export: node scripts/bundle-budget.mjs <export dir>.
//
// What the page loads first is the JavaScript its HTML names (`<script src>`); everything else is fetched later, on demand.
// This fails when:
//   - the entry chunk, gzipped, is over ENTRY_GZ_CEILING;
//   - everything the page loads first, gzipped and summed, is over FIRST_PAINT_GZ_CEILING (#280: `__common` was 2.5 MB of
//     Privy's SDK on every first paint while the entry chunk stayed under its own ceiling);
//   - Skia's JS or the desktop shell's chrome is in what the page loads first (a phone would fetch it on its first paint);
//   - html2canvas is anywhere in the export (the web has no image share until W4.4: plan §7.24);
//   - `EXPO_PUBLIC_DEV_PAYMENTS` could be on: the mock payment signature #206 allows only in `__DEV__` is not folded away
//     (any export, whatever its mock flavour; see DEV_PAYMENTS_SITE);
//   - the expo-router history patch is not in the bundle (the fork's own popstate listener, found by what only the fork has,
//     does not sync its index, or any listener anywhere has the fork's shipped, unsynced shape; #169);
//   - it cannot see what it is checking: no HTML page, no script in it, no entry chunk, or a marker that is in no chunk at all
//     (a check whose marker vanished would pass forever).
//
// **Which export this measures** (#182). `pnpm verify:web` pins it: the mock OFF, which is what a visitor is served (and
// `EXPO_PUBLIC_API_URL=` plus all Privy ids empty, so an ambient one cannot leak in), with
// `EXPO_NO_DOTENV=1` so no `.env.local` can change it and `TMPDIR` pointed at `.expo/verify-cache` so it does not compile
// whatever another checkout last left in the machine-wide Metro cache. Before that, the gate's export inherited both: after
// a mock-on export elsewhere the same command produced a bundle WITH the mock compiled in, and — from a cleared cache —
// after a mock-off one it did not (measured 21 Sept, byte-different outputs from one unchanged command). The cache does
// not key on the flag in EITHER direction — whichever flavour wrote the entry wins, so a mock-off export against a
// mock-on cache emits the mock, and a mock-on export against a mock-off cache does not (both measured, PR #205's
// rounds). Hence `--no-mock` reads the artifact rather than the command that made it. The converse is worth holding on
// to as well: a right artifact does not prove a right command, because a warm cache hides a wrong flag until someone's
// cache is cold.
//
// **What is still not deterministic**, so the ceiling has to carry room for it: Metro numbers and orders modules differently
// from a cold cache than from a warm one, which is worth about 2 KB gzipped. Measured here on the pinned flavour — warm:
// 2,745,752 bytes, 670,062 gzipped, the same in 10 consecutive runs; cold (a fresh machine's first run): 2,746,269 bytes,
// 667,903 gzipped. The ids differ, not the code: both carry the same 1,501 module bodies, and the counter that numbers
// them is shared with the server-render bundle, so which one claims an id first decides (PR #205's review) — `--max-workers`
// cannot help. `--clear` does not settle it either (it leaves `metro-file-map-*` beside the cache; 1 of 4 cleared runs
// landed on the warm ordering). What WOULD is `rm -rf .expo/verify-cache` before every run — 4 of 4 fresh dirs gave the
// cold bundle byte for byte — at about 11.5 s instead of 2.4 s. Not paid, because the gate runs on every change; instead
// the ceiling carries room for both, and read it as covering the larger of the two. **Keep that room.** It had shrunk to
// 958 bytes by 26 Sept (689,042 against 690,000), and a warm export then measured 691,004 — red on 1 run in 7 with no code
// change (#280). A ceiling with less than ~5 KB left is a flaky gate, not a tight one: raise it, or trim the entry.
//
// The cache grows (about 34 MB after 25 runs) and nothing evicts it. Delete `.expo/verify-cache` if it gets large; the
// next run is simply cold.
//
// Raising the ceiling is a decision, in its own commit, that says what grew and why. First measured 18 Sept at W3.5, by this
// script's own measure (node zlib, level 9), then on `EXPO_PUBLIC_USE_MOCK=1 pnpm export:web`: the entry chunk 2,736,890
// bytes, 665,165 gzipped; before W3.5 (main 75da540) the page loaded 831,154 gzipped: the entry 715,934, __common 113,708
// (all of Skia's JS) and the runtime 1,512.
//
// **690,000 → 710,000 (26 Sept, #280).** The entry went 669,772 (19 Sept) → 689,042 (26 Sept, main 4d85262) as launch work
// landed in it; by a source-mapped export, the 25 `src/` files added since 19 Sept that sit in the entry are ~75 KB raw:
// the first screen's cold open (#211: FirstScreen, HeroCapsule, HeroSky, StillSky, BrandMarks, ~28 KB), the web sign-in
// sheet with wallet sign-in (#244: AuthSheet.web, WalletMarks, solanaWallets, ~31 KB), the deposit sheet (#256, ~5.5 KB),
// the payment guard (#186, ~2.5 KB), and the web Privy wrapper and OAuth handoff (W5.1). Then #280 itself added ~1.1 KB:
// with no `__common` left, Metro no longer splits its runtime into a separate eager script (it does that only beside a
// common chunk), so the runtime now sits in the entry — 690,149, while the page's first paint fell from 3,244,542 to that
// same 690,149. 710,000 restores the ~20 KB of room the ceiling was set with. The first paint's ceiling sits 5 KB above.
// **710,000 → 730,000 (30 Sept, #371).** Season One raffle 6a measured the entry at 712,486 gzipped. 730,000 restores ~17.5 KB of room; the first paint's ceiling stays 5 KB above.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { APP_MARKER } from './gone.mjs';
import { ENTRY_CHUNK, ENTRY_RE } from './entryChunk.mjs';

export { ENTRY_CHUNK } from './entryChunk.mjs';

export const ENTRY_GZ_CEILING = 730_000;
/** Every script the page's HTML names, gzipped one by one and summed (#280). The entry ceiling alone could not see
 *  `__common`: Metro moves whatever two async chunks share into it and the HTML loads it with the entry, so a library that
 *  splits itself with its own `import()`s (Privy's SDK: ~120 screen and icon chunks) put its whole core in every first paint
 *  — 2,546,256 gzipped, the page 3,244,542 — while the entry chunk passed. */
export const FIRST_PAINT_GZ_CEILING = 735_000;

/** Strings that survive minification, each found in exactly one place when things are as they should be. */
export const LAZY = [
  { what: "Skia's JS", marker: 'SkiaPictureView' }, // skiaChunk: fetched only after CanvasKit, which waits for the machine
  { what: "the desktop shell's chrome", marker: 'gachapon-shell-chrome-web-only' }, // ShellChrome: only from 768 px up
  { what: 'PostHog (posthog-js, ~100 KB gzipped)', marker: 'us.i.posthog.com' }, // posthogChunk: asked for after the app mounts, only with a key (#143)
  { what: 'Privy web SDK (@privy-io/react-auth)', marker: 'gachapon-privy-web-only' }, // privyWebChunk: only when the app id is set (W5.1)
  // The SDK's own body, not our wrapper (#280). The marker above is written in `privyWebChunk.tsx`, so it proved the wrapper
  // lazy while the library it imports sat in `__common`, loaded first. `auth.privy.io` is the SDK's API host: in the SDK's
  // core, and nowhere in `src/`.
  { what: "Privy's SDK body (its API host)", marker: 'auth.privy.io' },
];
export const ABSENT = [{ what: 'html2canvas (react-native-view-shot on the web)', marker: 'data-html2canvas-ignore' }];

/** The expo-router history patch (patches/, PR #165; #169): its forked `createMemoryHistory` must sync `index` on popstate, as
 *  React Navigation's own copy (bundled inside expo-router too) always does. Minified, a synced listener reads
 *  `listen(t){const i=()=>{n=this.index,o.length||…`, the fork as shipped `listen(t){const n=()=>{o.length||…`.
 *
 *  Counting synced listeners cannot tell the two copies apart: "at least one" was met by React Navigation's twin while the
 *  fork's own listener changed shape (PR #177's first review), and "exactly two" by a third synced copy added alongside a
 *  reshaped fork (its second review). So the fork is found by what only it has: its `go()` settles the index with
 *  `Math.max(<found>, 0)` right before its own popstate listener (React Navigation's `go()` writes `this.index`), and the
 *  `listen()` that follows that anchor must be the synced shape. Separately, no listener anywhere may have the fork's shipped,
 *  unsynced shape.
 *  `$` is a legal minified name in all three. Dropped from FORK_ANCHOR or HISTORY_SYNCED the check fails CLOSED (the
 *  fork goes unfound, or its listener unrecognised); dropped from HISTORY_UNSYNCED it fails OPEN — a non-fork
 *  unsynced listener slips past uncounted, with the suite green. That asymmetry is why the `$` case is pinned on the
 *  unsynced side too (#169), and why a narrower match here is not automatically the safe direction.
 *  An expo-router release that reshapes the fork fails this by design: look at the new fork, then update the check. */
export const FORK_ANCHOR = /=Math\.max\([A-Za-z_$][\w$]*,0\)[;,](?:const |let |var )?[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\.pop\(\)[;,]window\.removeEventListener\(['"]popstate['"]/g;
export const HISTORY_SYNCED = /^listen\([A-Za-z_$][\w$]*\)\{const [A-Za-z_$][\w$]*=\(\)=>\{[A-Za-z_$][\w$]*=this\.index,/;
export const HISTORY_UNSYNCED = /listen\([A-Za-z_$][\w$]*\)\{const [A-Za-z_$][\w$]*=\(\)=>\{[A-Za-z_$][\w$]*\.length\|\|/g;
/** How far past the anchor the fork's `listen(` may start (measured 19 Sept: about 70 characters). */
export const FORK_LISTEN_WITHIN = 400;

/** The history-patch check over the text of the chunks that mention popstate. Returns a failure message, or null when the
 *  fork's own listener syncs its index and no listener anywhere has the fork's shipped, unsynced shape. (Other popstate
 *  listeners, react-dom's for one, sync nothing and are not the fork's business.) */
export function checkHistoryPatch(texts) {
  if (texts.length === 0) return 'no chunk mentions popstate: the history-patch check DID NOT RUN';
  const unsynced = texts.reduce((n, t) => n + (t.match(HISTORY_UNSYNCED) ?? []).length, 0);
  if (unsynced > 0) return `the expo-router history patch is NOT in the bundle: ${unsynced} popstate listener(s) never sync their index (Back can rebuild the app, PR #165)`;
  const anchors = texts.flatMap((t) => [...t.matchAll(FORK_ANCHOR)].map((m) => ({ t, at: m.index + m[0].length })));
  if (anchors.length !== 1) return `expected expo-router's forked history (its go() settling the index with Math.max) exactly once, found ${anchors.length}: the fork changed or moved, so this check cannot find its listener; look at the new fork, then update the check`;
  const { t, at } = anchors[0];
  const listen = t.indexOf('listen(', at);
  if (listen < 0 || listen - at > FORK_LISTEN_WITHIN) return `no listen() within ${FORK_LISTEN_WITHIN} characters after expo-router's forked go(): the fork changed shape; look at it, then update the check`;
  if (!HISTORY_SYNCED.test(t.slice(listen, listen + 200))) return `expo-router's forked popstate listener is not the synced shape (\`${t.slice(listen, listen + 60)}\`): the patch may be missing, or the fork changed; look at it`;
  return null;
}

/** Every check, over an export directory. Returns { ok, lines }; never throws for a finding. */
/** The call site the mock leaves in the entry chunk. Its *definition* survives either way (`src/api/index.ts` imports it
 *  unconditionally), so the discriminator is the paren: `createMockApi)(` is there exactly once with the mock on and not
 *  at all with it off — measured both ways. */
const MOCK_CALL_SITE = 'createMockApi)(';
/** The same function's name, which is in the bundle either way — the control that says the check can still see. */
const MOCK_NAME = 'createMockApi';

/** Where `src/state/session.tsx` decides whether a pull's payment is signed for real:
 *  `useMockPayment: usingMock || (__DEV__ && process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1')`. `EXPO_PUBLIC_DEV_PAYMENTS=1`
 *  lets a development build commit `mock:<pullId>` against a mock-payments worker (#206), and CLAUDE.md requires it to be
 *  provably absent from every export. An export is built with `__DEV__` false, so the second half folds to `!1` whatever
 *  the variable says: measured `useMockPayment:r.usingMock||!1` (25 Sept, both with the variable unset and set to 1). The
 *  property name survives minification, so it is also the control that the check can still see. `usingMock` is not
 *  folded (it is an imported binding) and is the flavour check's business, not this one's. */
export const DEV_PAYMENTS_SITE = /useMockPayment:([^,}]*)/g;
/** What the decision may compile to: `!1`, or the api module's `usingMock` binding `||!1`. Anything else — a second live
 *  operand (`r.usingMock||o.devPay||!1`), any other binding in front, a ternary — is refused rather than guessed about, so this
 *  check stands on its own without the source test beside it (PR #255's reviews). */
export const DEV_PAYMENTS_FOLDED = /^(?:[A-Za-z_$][\w$]*\.usingMock\|\|)?!1$/;
/** The code that makes a mock signature (`src/state/paymentFlow.ts`): `if (input.useMockPayment) return \`mock:${…}\``.
 *  The decision above is only what feeds it; a second reader of the flag beside this `if` passed a check that read the
 *  decision alone, with every paid pull signed `mock:` (PR #255's review, measured). So the producer is read too: exactly
 *  one mock signature in the export, and it is the one guarded by `useMockPayment` alone. Both spellings a minifier emits
 *  are counted, the template and a concatenation (`"mock:"+id`); the commit wire's `startsWith("mock:")` is neither. */
export const MOCK_SIGNATURE = /`mock:\$\{|["']mock:["']\+/g;
export const MOCK_SIGNATURE_GUARDED = /if\([A-Za-z_$][\w$]*\.useMockPayment\)return(?:`mock:\$\{|["']mock:["']\+)/g;

/**
 * @param {string} dir the export to check
 * @param {{ expectNoMock?: boolean }} [opts] `expectNoMock` for the gate's own export, which is pinned mock-off: the
 *   command that made it can be right and the artifact still wrong, because Metro's transform cache does not key on
 *   `EXPO_PUBLIC_*` — a cache once written by a mock-on export keeps answering mock-on (measured, PR #205's review).
 *   Not for a demo export, which is mock-on on purpose and is checked by `docs/BUILDS.md`'s readback instead.
 */
export function checkBudget(dir, opts = {}) {
  const lines = []; let ok = true;
  const fail = (msg) => { ok = false; lines.push(`FAIL ${msg}`); };
  const js = path.join(dir, 'client', '_expo', 'static', 'js', 'web');
  const html = path.join(dir, 'server', '[...path].html');
  if (!fs.existsSync(html)) return { ok: false, lines: [`FAIL no page at ${html}: the budget DID NOT RUN`] };
  const eager = [...fs.readFileSync(html, 'utf8').matchAll(/<script src="\/_expo\/static\/js\/web\/([^"]+\.js)"/g)].map((m) => m[1]);
  if (eager.length === 0) return { ok: false, lines: [`FAIL the page names no script: the budget DID NOT RUN`] };
  const all = fs.existsSync(js) ? fs.readdirSync(js).filter((f) => f.endsWith('.js')) : [];
  const missing = eager.filter((f) => !all.includes(f));
  if (missing.length) return { ok: false, lines: [`FAIL the page names scripts the export does not have (${missing.join(', ')}): the budget DID NOT RUN`] };
  const entry = eager.filter((f) => ENTRY_RE.test(f));
  if (entry.length !== 1) return { ok: false, lines: [`FAIL expected one entry chunk (${ENTRY_CHUNK}-<hash>.js, after package.json's main) among the page's scripts, found ${entry.length}: the budget DID NOT RUN`] };
  const text = Object.fromEntries(all.map((f) => [f, fs.readFileSync(path.join(js, f))]));

  const gz = zlib.gzipSync(text[entry[0]], { level: 9 }).length;
  const firstGz = eager.reduce((n, f) => n + zlib.gzipSync(text[f], { level: 9 }).length, 0);
  lines.push(`entry chunk ${text[entry[0]].length} bytes, ${gz} gzipped (ceiling ${ENTRY_GZ_CEILING}); the page loads ${eager.length} script(s), ${firstGz} gzipped (ceiling ${FIRST_PAINT_GZ_CEILING})`);
  if (gz > ENTRY_GZ_CEILING) fail(`the entry chunk is ${gz} bytes gzipped, over the ceiling of ${ENTRY_GZ_CEILING} by ${gz - ENTRY_GZ_CEILING}`);
  if (firstGz > FIRST_PAINT_GZ_CEILING) fail(`what the page loads first (${eager.join(', ')}) is ${firstGz} bytes gzipped, over the first-paint ceiling of ${FIRST_PAINT_GZ_CEILING} by ${firstGz - FIRST_PAINT_GZ_CEILING}: something moved into a chunk the page loads with the entry, usually \`__common\``);

  const holders = (marker) => all.filter((f) => text[f].includes(marker));
  for (const { what, marker } of LAZY) {
    const h = holders(marker);
    if (h.length === 0) fail(`${what}: its marker "${marker}" is in no chunk at all, so this check can no longer see it`);
    const early = h.filter((f) => eager.includes(f));
    if (early.length) fail(`${what} is in what the page loads first (${early.join(', ')})`);
    else if (h.length) lines.push(`ok   ${what}: only in ${h.map((f) => f.replace(/-[a-f0-9]+\.js$/, '')).join(', ')}, fetched later`);
  }
  for (const { what, marker } of ABSENT) {
    const h = holders(marker);
    if (h.length) fail(`${what} is in the export (${h.join(', ')})`);
    else lines.push(`ok   ${what}: not in the export`);
  }

  // The flavour of this very export, when the caller says what it should be (#182). Over every script the page loads, not
  // the entry alone: a future `__common` split could carry the call site past a check that read one chunk.
  //
  // With a positive control, because the absence of a marker is the weakest kind of evidence and this file's own promise
  // (above) is that it never passes on a marker it can no longer see. `src/api/index.ts` imports the mock unconditionally,
  // so its NAME is in the bundle either way — 1 occurrence with the mock off (the definition), 2 with it on — while the
  // call site's shape is what differs. Renaming `MOCK_CALL_SITE` in a scratch copy made this print "ok" on a real export
  // before the control existed (PR #205's round 2). What the control still cannot see: a minifier that stops emitting
  // `)(` for the call. The deploy-time demo readback (`docs/WEB_BUILD_PLAN.md` §4.5) is what validates the pattern itself.
  if (opts.expectNoMock) {
    const loaded = eager.map((f) => text[f].toString()).join('\n');
    if (!loaded.includes(MOCK_NAME)) fail(`\`${MOCK_NAME}\` is in none of the scripts the page loads, so the flavour check can no longer see what it checks: look at the bundle, then fix the marker`);
    else if (loaded.includes(MOCK_CALL_SITE)) fail(`the page's scripts call ${MOCK_CALL_SITE.replace(')(', '()')}: this export has the in-app mock compiled in, so it is not what a visitor is served. Usually a stale \`.expo/verify-cache\` — clear it and run again; if it fails again, \`verify:web\`'s own flags are wrong`);
    else lines.push('ok   the flavour: the in-app mock is not compiled into what the page loads');
  }

  // Dev payments, on every export: mock-on demos and real-API deploys alike must sign for real or not at all. Over every chunk,
  // not only what loads first, because a split could move the session module out of the entry.
  const sites = all.flatMap((f) => [...text[f].toString().matchAll(DEV_PAYMENTS_SITE)].map((m) => m[1]));
  if (sites.length !== 1) fail(`expected one \`useMockPayment:\` (src/state/session.tsx's payment decision) in the export, found ${sites.length}: the dev-payments check can no longer see what it checks — look at the bundle, then fix DEV_PAYMENTS_SITE`);
  else if (!DEV_PAYMENTS_FOLDED.test(sites[0])) fail(`the payment decision compiled to \`useMockPayment:${sites[0]}\`: its EXPO_PUBLIC_DEV_PAYMENTS half is not folded to false, so this export could commit mock signatures. The \`__DEV__ &&\` gate in session.tsx is what folds it`);
  else {
    const templates = all.reduce((n, f) => n + [...text[f].toString().matchAll(MOCK_SIGNATURE)].length, 0);
    const guarded = all.reduce((n, f) => n + [...text[f].toString().matchAll(MOCK_SIGNATURE_GUARDED)].length, 0);
    if (templates !== 1 || guarded !== 1) fail(`expected one mock signature (\`mock:\${…}\` or \`"mock:"+…\`), made only under \`if(….useMockPayment)return\`; found ${templates} template(s), ${guarded} so guarded: something else can make a mock signature, or the check can no longer see paymentFlow.ts's — look at the bundle`);
    else lines.push('ok   dev payments: EXPO_PUBLIC_DEV_PAYMENTS is folded off in this export, and the one mock signature (template or concatenation) is made only under it');
  }

  // What `web-probe.mjs --expect gone` looks for to tell a deleted URL from a 404 that still serves the app (#189). It is
  // checked here, against a real export, because the first version of that check looked for strings no exported byte
  // carries (`data-demo` is set in an effect at runtime; the sign-in text is client-rendered) and so could never fire.
  // A render change that moves both markers fails here instead of taking the gone check quiet with it. (The entry page
  // cannot fail it: the budget above already requires it to name `_expo/static/js/web/<entry>-*.js`, which is the first
  // marker. The other pages are the ones at risk, and are why this reads them all.)
  const serverDir = path.join(dir, 'server');
  // Every page, at any depth: `server/card/[cardId].html` is a real route, and a non-recursive read never looked at it.
  const walkPages = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walkPages(p) : (e.name.endsWith('.html') ? [path.relative(serverDir, p)] : []);
  });
  // No "if there are no pages" guard here: an export without `server/[...path].html` has already returned above, and any
  // export that gets this far has at least that page — so such a branch would be unreachable, and a mutant removing it
  // survives every test because nothing can reach it (measured). The count in the ok line is what shows it ran.
  const pages = walkPages(serverDir);
  const without = pages.filter((f) => !APP_MARKER.test(fs.readFileSync(path.join(serverDir, f), 'utf8')));
  if (without.length) fail(`${without.length} of ${pages.length} page(s) carry neither marker web-probe's --expect gone looks for (${without.join(', ')}): a cached shell would read as deleted`);
  else lines.push(`ok   the gone-check marker: all ${pages.length} exported page(s) carry it`);

  // (react-dom also says "popstate", so "no chunk mentions it" is a backstop: in a real export the fork's anchor decides.)
  const historyFail = checkHistoryPatch(all.filter((f) => text[f].includes('popstate')).map((f) => text[f].toString()));
  if (historyFail) fail(historyFail);
  else lines.push('ok   the expo-router history patch: the fork\'s own popstate listener syncs its index, and none anywhere has its shipped, unsynced shape');
  return { ok, lines };
}

// Run as a script, however it was reached. Comparing `import.meta.url` with `file://${argv[1]}` never matched a path with a space
// or a non-ASCII character (the URL is percent-encoded) or one reached through a symlink, and the script then exited 0 having
// checked nothing (PR #170's review). Real paths on both sides.
const invoked = process.argv[1] ? fs.realpathSync(path.resolve(process.argv[1])) : null;
if (invoked === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const unknown = args.filter((a) => a.startsWith('--') && a !== '--no-mock');
  if (unknown.length) { console.error(`bundle budget: unknown flag(s) ${unknown.join(', ')}: refusing rather than running a check nobody asked for`); process.exit(2); }
  const expectNoMock = args.includes('--no-mock');
  const dir = args.find((a) => !a.startsWith('--'));
  if (!dir) { console.error('usage: node scripts/bundle-budget.mjs <web export dir> [--no-mock]'); process.exit(2); }
  const { ok, lines } = checkBudget(path.resolve(dir), { expectNoMock });
  for (const l of lines) (l.startsWith('FAIL') ? console.error : console.log)(`bundle budget: ${l}`);
  process.exit(ok ? 0 : 1);
}
