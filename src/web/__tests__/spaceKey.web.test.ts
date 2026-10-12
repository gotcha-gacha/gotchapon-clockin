// Space never scrolls (W1.6, #139, AC-2): what the guard cancels, what it presses, and what it leaves to the browser.
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { installSpaceGuard } from '../spaceKey';

let remove: () => void;
const el = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; document.body.appendChild(d); return d.firstElementChild as HTMLElement; };
/** Dispatches the key on `target`; answers whether the browser's default (the scroll) was cancelled. */
const key = (target: HTMLElement, k = ' ', init: KeyboardEventInit = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }); target.dispatchEvent(e); return e.defaultPrevented; };
const clicksOn = (target: HTMLElement) => { const seen = { n: 0 }; target.addEventListener('click', () => { seen.n++; }); return seen; };

beforeEach(() => { remove = installSpaceGuard(); });
afterEach(() => { remove(); document.body.innerHTML = ''; });

test('with focus on nothing, space is cancelled and presses nothing', () => {
  const clicks = clicksOn(document.body);
  expect(key(document.body)).toBe(true);
  expect(clicks.n).toBe(0);
});

test('on a control that is not a real button (a rail tab, the "see odds" link), space is a press, once, and never a scroll', () => {
  for (const html of ['<div role="tab" tabindex="0">Wallet page</div>', '<span role="link" tabindex="0">see odds</span>', '<div tabindex="0">Skip</div>']) {
    const target = el(html); const clicks = clicksOn(target);
    expect(key(target)).toBe(true);
    expect(clicks.n).toBe(1);
    expect(key(target, ' ', { repeat: true })).toBe(true); // a held key still never scrolls,
    expect(clicks.n).toBe(1); // and never presses again
  }
});

test('a disabled control, and something that cannot take focus, are not pressed', () => {
  for (const html of ['<div role="tab" tabindex="-1" aria-disabled="true">Pull page, current</div>', '<div role="tab" tabindex="0" aria-disabled="true">x</div>', '<div>plain text</div>']) {
    const target = el(html); const clicks = clicksOn(target);
    expect(key(target)).toBe(true);
    expect(clicks.n).toBe(0);
  }
});

test('the browser keeps what is its own: a real button, a text field, a select; and space with a modifier', () => {
  for (const html of ['<button>Continue with Apple</button>', '<input type="text">', '<textarea></textarea>', '<select><option>a</option></select>', '<summary>more</summary>']) {
    const target = el(html); const clicks = clicksOn(target);
    expect(key(target)).toBe(false);
    expect(clicks.n).toBe(0);
  }
  const tab = el('<div role="tab" tabindex="0">Wallet page</div>'); const clicks = clicksOn(tab);
  expect([key(tab, ' ', { metaKey: true }), key(tab, ' ', { ctrlKey: true }), key(tab, ' ', { altKey: true }), clicks.n]).toEqual([false, false, false, 0]);
});

test('no other key is touched, and after removal neither is space', () => {
  const tab = el('<div role="tab" tabindex="0">Wallet page</div>'); const clicks = clicksOn(tab);
  expect([key(tab, 'Enter'), key(tab, 'ArrowRight'), key(tab, 'o'), clicks.n]).toEqual([false, false, false, 0]);
  remove();
  expect([key(tab), clicks.n]).toEqual([false, 0]);
});

// Seen in Chromium: the guard pressed the Wallet tab, the press moved focus to the body, and the keyboard bridge (a second
// keydown listener on the window) then read the same event as "space with focus on nothing" and paged back to Pull.
test('a space that became a press reaches nobody else, whoever registered first; a space that was only cancelled still does', () => {
  const heardBefore: string[] = []; const heardAfter: string[] = [];
  remove(); // re-install between two stand-ins for the bridge, one registered before the guard and one after
  const early = (e: Event) => { heardBefore.push((e.target as HTMLElement).tagName); };
  const late = (e: Event) => { heardAfter.push((e.target as HTMLElement).tagName); };
  window.addEventListener('keydown', early);
  remove = installSpaceGuard();
  window.addEventListener('keydown', late);
  try {
    const tab = el('<div role="tab" tabindex="0">Wallet page</div>'); const clicks = clicksOn(tab);
    key(tab);
    expect([clicks.n, heardBefore, heardAfter]).toEqual([1, [], []]);
    key(tab, ' ', { repeat: true }); // held: no second press, and still nobody else's
    expect([clicks.n, heardBefore, heardAfter]).toEqual([1, [], []]);
    key(document.body); // focus on nothing: cancelled, and the bridge still hears it
    expect([heardBefore, heardAfter]).toEqual([['BODY'], ['BODY']]);
    key(tab, 'Enter'); // not this guard's key
    expect([heardBefore.length, heardAfter.length]).toEqual([2, 2]);
  } finally { window.removeEventListener('keydown', early); window.removeEventListener('keydown', late); }
});
