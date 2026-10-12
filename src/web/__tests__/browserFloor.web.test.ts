/**
 * The browser floor (W0.3, #121). The card and its check are strings placed in the document ahead of the bundle, so they are
 * run here the way a browser runs them: the markup parsed into the page, the script evaluated as a classic script. jsdom has
 * none of the three capabilities by itself (no ResizeObserver, no CSS.supports; its RegExp is V8's), so each test says what
 * the browser has.
 */
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { BROWSER_FLOOR_HTML, BROWSER_FLOOR_ID, BROWSER_FLOOR_SCRIPT } from '@/web/browserFloor';

type Win = { ResizeObserver?: unknown; CSS?: unknown; RegExp: RegExpConstructor };
const w = window as unknown as Win;
const RealRegExp = RegExp;
const modern = () => {
  w.ResizeObserver = function ResizeObserver() {};
  w.CSS = { supports: (prop: string, value: string) => prop === 'scroll-snap-type' && value === 'x mandatory' };
  w.RegExp = RealRegExp;
};
const run = () => {
  document.body.innerHTML = BROWSER_FLOOR_HTML;
  const s = document.createElement('script'); s.textContent = BROWSER_FLOOR_SCRIPT; document.body.appendChild(s); // a classic script, as +html.tsx places it
  const card = document.getElementById(BROWSER_FLOOR_ID)!;
  return { shown: card.style.display !== 'none', flagged: document.documentElement.getAttribute('data-browser-floor') === '1', card };
};

beforeEach(() => { modern(); });
afterEach(() => { delete w.ResizeObserver; delete w.CSS; w.RegExp = RealRegExp; document.documentElement.removeAttribute('data-browser-floor'); document.body.innerHTML = ''; });

test('a browser with everything the app needs never sees the card', () => {
  expect(run()).toMatchObject({ shown: false, flagged: false });
});

test('no ResizeObserver (react-native-web could size nothing): the card', () => {
  delete w.ResizeObserver;
  expect(run()).toMatchObject({ shown: true, flagged: true });
});

test('no CSS scroll snap (the three-page track): the card; and no CSS.supports at all is the same answer, not a throw', () => {
  w.CSS = { supports: () => false };
  expect(run().shown).toBe(true);
  delete w.CSS;
  expect(run().shown).toBe(true);
});

test('a RegExp without lookbehind (Safari before 16.4 throws a SyntaxError on it): the card', () => {
  w.RegExp = function (pattern: string, flags?: string) { if (/\(\?<[=!]/.test(pattern)) throw new SyntaxError('Invalid regular expression: invalid group specifier name'); return new RealRegExp(pattern, flags); } as unknown as RegExpConstructor;
  expect(run()).toMatchObject({ shown: true, flagged: true });
});

test('the card is plain words: what to do, no product vocabulary the UI bans, and it covers the page above everything', () => {
  const { card } = (delete w.ResizeObserver, run());
  expect(card.textContent).toContain('Gotchapon needs a newer browser');
  expect(card.textContent).toContain('iOS 16.4 or later');
  expect(card.textContent).not.toMatch(/mint|NFT|token|on-chain|Solana|wallet/i);
  expect(card.getAttribute('role')).toBe('alert');
  expect(card.style.position).toBe('fixed'); expect(card.style.zIndex).toBe('2147483647');
});

test('the check is ES5: an old browser has to be able to parse the thing that tells it it is old', () => {
  expect(BROWSER_FLOOR_SCRIPT).not.toMatch(/=>|\bconst\b|\blet\b|`|\?\.|\?\?/);
  expect(() => new Function(BROWSER_FLOOR_SCRIPT)).not.toThrow();
});
