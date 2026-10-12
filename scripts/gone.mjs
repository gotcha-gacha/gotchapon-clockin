// Is a URL gone? (#189.) `eas deploy:delete` returns long before a demo URL stops answering — on 19 Sept five of six
// deleted demos still served 200 after 75 minutes — so "deleted" is a request, and this is what decides whether it took.
//
// It is a pure function over one response so it can be table-tested (`scripts/__tests__/gone.test.mjs`); the fetching,
// the sampling and the exit code are `web-probe.mjs --expect gone`'s. Every rule here was wrong in the first version and
// is now the answer to a measurement in PR #197's review:
//
//   - **A failed request decides nothing.** The first version passed on any `fetch` rejection, so a dropped wifi second,
//     a captive portal or a TLS-intercepting proxy read as "gone" — reproduced by pointing NODE_EXTRA_CA_CERTS at a
//     garbage file: a live 200 site came back PASS. Worse for these URLs, `*.expo.app` is wildcard DNS, so even a name
//     that never existed resolves and answers: a resolution failure can never mean a deployment was removed.
//   - **Only 404 and 410 are gone.** The first version took anything >= 400, and then anything 4xx: a Cloudflare-style
//     403 block page from a live server came back PASS, exit 0 (measured, PR #202's review). A 502 or 503 during the
//     delete window is a server that is still there, and a 429 is a rate limit, not a deletion. 404 is what EAS was
//     observed to answer for a removed deployment; 410 is accepted because that is what the status means, not because
//     anything here has seen one.
//   - **The body check has to match what this app actually serves.** It looked for `data-demo` and "Continue with Apple",
//     neither of which is in any exported byte: the attribute is set in an effect at runtime and the sign-in text is
//     client-rendered. Measured on a real `EXPO_PUBLIC_USE_MOCK=1 pnpm export:web`: 0 of 5 pages carry either, while
//     every page carries the entry script's path. So the half that was supposed to catch a 404 still serving the app
//     could never fire.

import { ENTRY_CHUNK_RE } from './entryChunk.mjs';

/** In every page the web export emits, and in nothing EAS Hosting serves for a deployment that is not there. The
 *  script's path is built from the app's entry module (`scripts/entryChunk.mjs`), which renames the chunk when it changes. */
export const APP_MARKER = new RegExp(`_expo/static/js/web/${ENTRY_CHUNK_RE}-|og:site_name" content="Gotchapon"`);

/** What EAS answers for a URL with no deployment behind it. Only used to tell "gone" from "never existed" in the report. */
export const NO_DEPLOYMENT = /No worker deployment was found/i;

/**
 * @param {{ status: number, body: string }} res one completed HTTP response — never a failed request
 * @returns {{ gone: boolean, why: string }}
 */
export function classifyGone({ status, body }) {
  // The fall-through is "not gone". Only the status a removed deployment was actually observed to answer — 404, and 410
  // as the explicit spelling of the same thing — can end the loop; everything else is a server that answered and refused.
  // The first version said gone for any 4xx, and a Cloudflare-style 403 block page from a live site came back PASS, exit 0
  // (measured, PR #197's round 2). That is the same fail-open shape as reading a failed request as a deletion: when this
  // is wrong in the "gone" direction the URL keeps serving the demo to everyone but the person who probed it.
  // Three "not gone" answers, not one: the verdict is the same but the report is this tool's only product, and an
  // operator has to tell "my demo is still up, keep waiting" from "something is refusing my prober, this loop will
  // never end on its own". Collapsing them called a live 200 site "answered and refused" (PR #202's review).
  if (status < 400) return { gone: false, why: `still serving (HTTP ${status})` };
  if (status >= 500) return { gone: false, why: `the server is still there and unwell (HTTP ${status}) — not a deletion` };
  if (status !== 404 && status !== 410) return { gone: false, why: `HTTP ${status} — the server answered and refused (a block page, a login, a rate limit); not a deletion, and this loop will not end by itself` };
  if (APP_MARKER.test(body)) return { gone: false, why: `HTTP ${status}, but the page still carries the app — a cached shell, not a deletion` };
  return { gone: true, why: NO_DEPLOYMENT.test(body) ? `HTTP ${status}, no deployment behind the URL` : `HTTP ${status}, nothing of the app in the body` };
}
