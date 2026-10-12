// The `--expect gone` classifier (#189). Every case here is one PR #197's review measured against the real thing — a live
// site, a deleted demo, a hung server, a 404 serving the app's own bytes — and each was a way the first version answered
// "gone" when it was not. The probe's own sampling and its "a failed request decides nothing" rule are in web-probe.mjs;
// this pins the rule for one response, which is the part that can be tested without a network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_MARKER, classifyGone } from '../gone.mjs';
import { ENTRY_CHUNK } from '../entryChunk.mjs';

const EAS_404 = 'error code: 1042 No worker deployment was found matching the current domain';
/** The head of a page the web export really emits (`dist/server/*.html`), shortened. */
const APP_PAGE = '<!DOCTYPE html><html lang="en"><head><meta property="og:site_name" content="Gotchapon"/>'
  + `<script src="/_expo/static/js/web/${ENTRY_CHUNK}-ee952cc65d94b67f9560b1fd56005bc0.js" defer></script></head><body></body></html>`;

const CASES = [
  ['a deleted deployment: 404 with no app in it', { status: 404, body: EAS_404 }, true],
  ['a 404 with an empty body', { status: 404, body: '' }, true],
  ['410 Gone', { status: 410, body: '' }, true],
  ['a live site', { status: 200, body: APP_PAGE }, false],
  ['a live site that happens to be empty', { status: 200, body: '' }, false],
  ['a redirect to somewhere else', { status: 302, body: '' }, false],
  ['a 404 that still serves the app (a cached shell)', { status: 404, body: APP_PAGE }, false],
  ['a 404 carrying only the site head', { status: 404, body: '<meta property="og:site_name" content="Gotchapon"/>' }, false],
  ['a 500 during the delete window', { status: 500, body: '' }, false],
  ['a 502 from the edge', { status: 502, body: EAS_404 }, false],
  ['a 503', { status: 503, body: '' }, false],
  ['rate limited', { status: 429, body: '' }, false],
  // A live server refusing the probe. The first version said "gone" for every 4xx, so a Cloudflare block page ended the
  // loop on a URL that was still serving (measured).
  ['a Cloudflare block page', { status: 403, body: '<html><title>Attention Required! | Cloudflare</title></html>' }, false],
  ['behind a login', { status: 401, body: '' }, false],
  ['blocked for legal reasons', { status: 451, body: '' }, false],
  ['a bad request', { status: 400, body: '' }, false],
];

for (const [name, res, gone] of CASES) {
  test(name, () => {
    const out = classifyGone(res);
    assert.equal(out.gone, gone, `${name}: ${out.why}`);
    assert.match(out.why, /\S/); // every answer says why, since the answer is what an operator acts on
  });
}

// The wording is part of the answer, not decoration: an operator reads it to tell "my demo is still up, keep waiting"
// from "something is refusing my prober, so this loop will never end". A version that collapsed all three into "the
// server answered and refused" passed every test above, because nothing looked at `why` (PR #202's review).
const SAYS = [
  ['a live site says it is serving', { status: 200, body: '' }, /still serving/],
  ['a redirect says it is serving', { status: 302, body: '' }, /still serving/],
  ['a 5xx says the server is there', { status: 503, body: '' }, /still there/],
  ['a 403 says it refused, and that the loop will not end by itself', { status: 403, body: '' }, /refused.*will not end by itself/],
  ['a rate limit reads as a refusal, not a deletion', { status: 429, body: '' }, /refused/],
  ['a deleted deployment names what EAS served', { status: 404, body: EAS_404 }, /no deployment behind the URL/],
  ['a cached shell says the app is still there', { status: 404, body: APP_PAGE }, /still carries the app/],
];
for (const [name, res, pattern] of SAYS) test(name, () => assert.match(classifyGone(res).why, pattern));

// Not a range: two statuses. A range is what let a 403 end the loop, so this sweeps every status a server can answer with
// and asserts the answer is "gone" for exactly the two that a removed deployment was observed to give.
test('across every status code, only 404 and 410 are gone', () => {
  const gone = [];
  for (let status = 100; status <= 599; status++) if (classifyGone({ status, body: '' }).gone) gone.push(status);
  assert.deepEqual(gone, [404, 410]);
});

// The marker itself is checked against a real export by `scripts/bundle-budget.mjs`, which runs on the export `verify:web`
// has just built — this file runs before that export exists, so a check here could only pass vacuously.
test('the marker is a pattern, not a literal, and matches an exported page head', () => {
  const head = `<meta property="og:site_name" content="Gotchapon"/><script src="/_expo/static/js/web/${ENTRY_CHUNK}-abc123.js" defer></script>`;
  assert.match(head, APP_MARKER);
  assert.doesNotMatch('error code: 1042 No worker deployment was found matching the current domain', APP_MARKER);
  // Half the marker is the entry script's path, built from `package.json` → `main` (#6). Written down as `entry-` it
  // stopped matching the day the entry module was renamed, and this half of the check could never fire again.
  assert.match(`<script src="/_expo/static/js/web/${ENTRY_CHUNK}-abc123.js">`, APP_MARKER);
  assert.doesNotMatch('<script src="/_expo/static/js/web/somethingelse-abc123.js">', APP_MARKER);
});
