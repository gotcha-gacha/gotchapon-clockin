#!/usr/bin/env node
// The headless probe for a web deploy (W3.1 #131; the production launch, W3.2 #132, is gated on it). It loads the DEPLOYED
// site in a real browser and reports what a visitor's browser does: is the demo pill there (by its own handle, never by its words: #185), which origins were asked
// for anything, were there page errors. The artifact read-back (plan §4.5) says what was exported; this says what is served.
//
//   demo:        node scripts/web-probe.mjs https://gachapon--<id>.expo.app --expect demo
//   production:  node scripts/web-probe.mjs https://<site> --expect production --api-origin https://<Dev 2's API>
//   deleted:     node scripts/web-probe.mjs https://gachapon--<id>.expo.app --expect gone
//
// `--expect demo`:        `<html data-demo="1">` before sign-in, the pill after it, AND nothing requested from an API origin (the mock
//                         answers in the page).
// `--expect production`:  no marker AND at least one request went to --api-origin. (It also checks there is no pill, but the pill
//                         lives past sign-in, where this mode never goes: the marker is the half that can fail.)
// `--expect gone`:        the URL answers nothing a visitor could use. `eas deploy:delete` returns before the URL stops
//                         answering — on 19 Sept five of six deleted demos still served 200 an hour and a quarter later, and
//                         all six were 404 within about four hours (#189) — so "deleted" is a request, not a state. This mode
//                         is what says it happened. It needs no browser and no PW_DIR: only a 404 or 410 can be gone, and
//                         then only when the body carries nothing of the app, so a cached shell cannot read as deleted.
//                         Loop it: `until node scripts/web-probe.mjs <url> --expect gone; do sleep 300; done`.
// Exit 0 only when the expectation holds with zero page errors. It signs in the way a visitor would on a demo (the mock's
// "Continue with Apple" needs no account); on production it stops at the sign-in screen, which is as far as a probe may go.
//
// Playwright is not a dependency of this repo (nothing in the app needs it). Point PW_DIR at any directory that has it
// installed, with a Chromium it can launch:  npm i --prefix /tmp/pw playwright && npx --prefix /tmp/pw playwright install chromium
import { createRequire } from 'node:module';
import { classifyGone } from './gone.mjs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a));
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const expectMode = opt('--expect');
const apiOrigin = opt('--api-origin');
// A demo names no API origin: there is none to allow. (Given one, the first version counted requests to it as explained and
// passed a demo that was calling an API: PR #156's review ran it.)
if (!url || !['demo', 'production', 'gone'].includes(expectMode ?? '') || (expectMode === 'production' && !apiOrigin) || (expectMode !== 'production' && apiOrigin)) {
  console.error('usage: web-probe.mjs <url> --expect demo | --expect production --api-origin <origin> | --expect gone');
  process.exit(2);
}

// `gone` answers from HTTP alone, so it runs before Playwright is required: an ops check that has to be repeated until it
// passes should need nothing installed. `classifyGone` (scripts/gone.mjs) decides one response; this part decides how many
// responses to ask for, and what a failed request means — which is nothing. Both were wrong in the first version and both
// are now what PR #197's review measured (that file carries the list).
if (expectMode === 'gone') {
  // 5 s, not 1 s: Node's global fetch keeps an idle socket about 4 s, so samples a second apart all travel down one
  // connection — five samples that are one sample. Measured on the real deleted demo by counting undici's own
  // `undici:client:connected` events: 1 s apart → 1 connection, 5 s apart → 5. (`cf-ray` suffixes tell the same story
  // but can under-report, two connections sharing one — PR #202's review.) The 4 s is these hosts' behaviour, not a
  // law: undici holds a socket longer if a response asks it to with `keep-alive: timeout=N`, which `*.expo.app` does
  // not send. And separate connections are not separate edges — which PoP anycast hands you is not ours to choose — so
  // each sample's colo is reported below, and the note says so when they were all the same.
  const SAMPLES = 5, GAP_MS = 5000, TIMEOUT_MS = 15000;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) {
    if (i) await sleep(GAP_MS);
    let res, body, edge;
    try {
      // `redirect: 'manual'` so a redirect to a live page reads as what it is rather than as its destination's status.
      res = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS) });
      // Inside the try: the timeout aborts the response stream too, so a server that sends headers and then stalls
      // throws here. Outside it, that crashed the probe instead of reporting (PR #197's round 2 measured 15.8 s and no
      // JSON) — the one thing this mode promises is that it always says what it saw.
      body = (await res.text()).slice(0, 200000);
      edge = (res.headers.get('cf-ray') ?? '').split('-')[1] || null; // Cloudflare's colo, when it is behind Cloudflare
    } catch (e) {
      // The prober's own failure — a dropped connection, a proxy, a timeout — says nothing about the server. It certainly
      // does not mean a deployment was deleted: `*.expo.app` is wildcard DNS, so even a name that never existed resolves
      // and answers. Never a PASS; exit 1 so an `until` loop keeps going.
      console.log(JSON.stringify({ url, expect: 'gone', samples, requestFailed: String(e.message).slice(0, 200),
        verdict: 'DID NOT RUN', note: 'the request never completed, so this says nothing about the URL — check the network and run it again' }, null, 2));
      process.exit(1);
    }
    samples.push({ status: res.status, edge, ...classifyGone({ status: res.status, body }) });
  }
  // Every sample must agree. One answer from one edge is not the state of the URL: the deletes on 19 Sept answered 200 "on
  // most requests", and ten requests to one deleted demo came back from two Cloudflare PoPs within ten seconds.
  const ok = samples.every((x) => x.gone);
  const edges = [...new Set(samples.map((x) => x.edge).filter(Boolean))];
  console.log(JSON.stringify({ url, expect: 'gone', samples, edgesReached: edges, verdict: ok ? 'PASS' : 'FAIL',
    note: ok ? `nothing usable is served at this URL, in ${SAMPLES} samples over ${((SAMPLES - 1) * GAP_MS) / 1000}s`
               // The least-informed run must not get the most confident sentence: with no `cf-ray` at all there is
               // nothing to say about edges, and saying nothing reads as coverage (PR #202's review).
               + (edges.length > 1 ? ` across ${edges.length} edges (${edges.join(', ')})`
                  : edges.length === 1 ? ` — all of them from one edge (${edges[0]}), so another may still differ`
                  : ' — no edge was reported (not behind Cloudflare, or the header was stripped), so whether more than one answered is unknown')
             : 'the URL still answers: it is not gone yet, keep probing' }, null, 2));
  process.exit(ok ? 0 : 1);
}
let api = null;
if (apiOrigin) { try { api = new URL(apiOrigin).origin; } catch { console.error(`--api-origin is not a URL: ${apiOrigin}. The probe DID NOT RUN.`); process.exit(2); } }
const pwDir = process.env.PW_DIR;
if (!pwDir) { console.error('PW_DIR is not set: a directory with playwright installed (see the top of this file). The probe DID NOT RUN.'); process.exit(2); }
const { chromium } = createRequire(path.join(path.resolve(pwDir), 'probe.js'))('playwright');

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const page = await (await browser.newContext({ viewport: { width: 402, height: 874 } })).newPage();
const pageErrors = []; page.on('pageerror', (e) => pageErrors.push(String(e.message).slice(0, 200)));
const origins = new Map(); page.on('request', (r) => { try { const o = new URL(r.url()).origin; if (o !== 'null') origins.set(o, (origins.get(o) ?? 0) + 1); } catch { /* data:, blob: */ } });

const site = new URL(url).origin;
const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
const robots = await page.evaluate(() => document.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null);
const text = async () => (await page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ');
const signIn = /Continue with Apple/.test(await text());
// The mock marks the root element before sign-in (src/app/_layout.tsx): the one demo signal a probe can read on a site it cannot sign in to.
const marker = await page.evaluate(() => document.documentElement.getAttribute('data-demo'));
let signedIn = false;
if (expectMode === 'demo' && signIn) {
  await page.getByText('Continue with Apple').first().click();
  await page.waitForTimeout(3500);
  const skip = page.getByText('Skip', { exact: true }); if (await skip.count()) { await skip.first().click(); await page.waitForTimeout(1500); }
  signedIn = /PULLS/.test(await text());
}
// The pill by the one handle only it has, not by its words: the Wallet's demo notice says "the DEMO pill in the header"
// in its own copy, and the web pager keeps all three pages in the document, so a text match reports the pill on any
// signed-in demo whether or not the pill is there (PR #194's review measured it in jsdom and in Chromium). This probe is
// the positive control for the production gate (plan §4.5, LAUNCH_CHECKLIST row 9): a control that cannot fail is the one
// thing it must not be.
const pill = (await page.locator('[aria-label^="Demo data:"]').count()) > 0;
await browser.close();

const others = [...origins.keys()].filter((o) => o !== site);
const toApi = api ? (origins.get(api) ?? 0) : 0;
// A demo has no API origin to name: anything that is neither the site itself nor a card image host would be one.
const IMAGE_HOSTS = ['https://images.pokemontcg.io'];
const unexplained = others.filter((o) => !IMAGE_HOSTS.includes(o) && o !== api); // (a demo is refused an --api-origin above, so nothing is excused there)
// In production mode requests to the API origin are wanted; every other origin must be explained there too.
const ok = pageErrors.length === 0 && response?.status() === 200 && signIn && (expectMode === 'demo'
  ? marker === '1' && pill && signedIn && unexplained.length === 0 && toApi === 0
  : marker === null && !pill && toApi >= 1 && unexplained.length === 0);
console.log(JSON.stringify({ url, expect: expectMode, status: response?.status() ?? null, bootsToSignIn: signIn, demoMarkerBeforeSignIn: marker, signedInWithTheMock: signedIn, demoPill: pill, robots,
  requestsByOrigin: Object.fromEntries(origins), requestsToApiOrigin: toApi, originsNobodyExplained: unexplained, pageErrors, verdict: ok ? 'PASS' : 'FAIL' }, null, 2));
process.exit(ok ? 0 : 1);
