/**
 * @jest-environment node
 *
 * (+html.tsx runs in Node, at export and on the server: react-dom/server wants Node's MessageChannel, which jsdom hides.)
 *
 * The document itself (W0.3, #121): +html.tsx has to carry the browser-floor card, and the check AFTER the card (the script
 * looks the card up by id and says nothing if it is not there yet) and BEFORE the app, whose bundle an old browser may not
 * parse. browserFloor.web.test.ts builds its own DOM, so without this nothing noticed the two being dropped or swapped
 * (PR #155's review: both mutants survived).
 */
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Root from '@/app/+html';
import { BROWSER_FLOOR_ID, BROWSER_FLOOR_SCRIPT } from '@/web/browserFloor';

jest.mock('expo-router/html', () => ({ ScrollViewStyleReset: () => null }));

test('the served document: the card, then its check, then the app', () => {
  const html = renderToStaticMarkup(<Root><div id="root">app</div></Root>);
  const card = html.indexOf(`id="${BROWSER_FLOOR_ID}"`);
  const check = html.indexOf(BROWSER_FLOOR_SCRIPT.slice(0, 40));
  const app = html.indexOf('id="root"');
  expect(card).toBeGreaterThan(-1); expect(check).toBeGreaterThan(-1); expect(app).toBeGreaterThan(-1);
  expect([card, check, app]).toEqual([card, check, app].slice().sort((a, b) => a - b));
  expect(BROWSER_FLOOR_SCRIPT).toContain('window.CSS&&'); // the check has an && in it...
  expect(html).toContain('window.CSS&&window.CSS.supports'); // ...and it reaches the page as written, not as &amp;&amp; (a SyntaxError). React 19 leaves a script's text alone either way (ran it), so this guards the output, whichever way the script is put in
});

// INDEXABLE is read once, when +html.tsx is loaded (at export that is the command line's value, baked in), so each case loads it afresh.
const documentWith = (indexable: string | undefined) => {
  const before = process.env.EXPO_PUBLIC_WEB_INDEXABLE;
  if (indexable === undefined) delete process.env.EXPO_PUBLIC_WEB_INDEXABLE; else process.env.EXPO_PUBLIC_WEB_INDEXABLE = indexable;
  let html = '';
  jest.isolateModules(() => {
    jest.doMock('react', () => React);
    const Fresh = jest.requireActual<typeof import('@/app/+html')>('@/app/+html').default;
    html = renderToStaticMarkup(<Fresh><div id="root">app</div></Fresh>);
  });
  if (before === undefined) delete process.env.EXPO_PUBLIC_WEB_INDEXABLE; else process.env.EXPO_PUBLIC_WEB_INDEXABLE = before;
  return html;
};

test('search engines are kept out unless the export opts in: a demo or staging deploy must never be indexed (W3.1)', () => {
  const demo = documentWith(undefined);
  expect(demo).toContain('<meta name="robots" content="noindex, nofollow"/>');
  expect(demo.indexOf('name="robots"')).toBeLessThan(demo.indexOf('</head>')); // in the head, where a crawler reads it. (React 19 hoists a <meta> there from anywhere, so moving the tag cannot break this: PR #156's round 2 rendered both)
  expect(documentWith('0')).toContain('noindex');
  expect(documentWith('true')).toContain('noindex'); // only the exact opt-in counts
  expect(documentWith('1')).not.toContain('robots');
});

// W1.6 (#139): the focus ring and the reduced-motion belt are page-wide CSS, so they are in the document itself, before any script.
test('the served document carries a visible focus ring and turns CSS motion off under prefers-reduced-motion', () => {
  const html = renderToStaticMarkup(<Root><div id="root">app</div></Root>);
  const css = /<style[^>]*>([\s\S]*?)<\/style>/g; const sheets = [...html.matchAll(css)].map((m) => m[1]).join('\n');
  expect(sheets).toMatch(/:focus-visible\s*\{\s*outline:\s*2px solid #[0-9A-Fa-f]{6} !important;\s*outline-offset:\s*2px;\s*\}/); // not the browser's 1 px dark blue, which the room's navy hides
  expect(sheets).not.toMatch(/:focus\s*\{[^}]*outline:\s*(none|0)/); // and nothing takes a ring away
  const reduce = sheets.slice(sheets.indexOf('@media (prefers-reduced-motion: reduce)'));
  expect(sheets).toContain('@media (prefers-reduced-motion: reduce)');
  expect(reduce).toContain('animation-duration: 0.01ms !important');
  expect(reduce).toContain('transition: none !important'); // none, not "very short": see pageCss.ts
  expect(reduce).not.toContain('transition-duration');
});

// #325: the first screen used to be overflow-y:auto, so a panel a few pixels short grew a native scrollbar.
test('the first screen clips its panel instead of scrolling it', () => {
  const html = renderToStaticMarkup(<Root><div id="root">app</div></Root>);
  const css = /<style[^>]*>([\s\S]*?)<\/style>/g;
  const sheets = [...html.matchAll(css)].map((m) => m[1]).join('\n');
  expect(sheets).toContain('[data-testid="first-screen"]{overflow:hidden}');
  expect(sheets).toContain('html[data-balance-pending] [data-frost] div{transform:none !important;will-change:auto !important}');
  expect(sheets).not.toContain('overflow-y:auto');
  expect(sheets).not.toContain('overflow-y: scroll');
});
