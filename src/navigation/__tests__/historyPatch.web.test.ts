/**
 * The expo-router patch (patches/expo-router@57.0.23.patch; PR #165's third review), against the patched module itself.
 * expo-router's web history keeps its own `index` into its list of entries and, unlike React Navigation's copy of the same
 * file, did not move it when the USER pressed Back or Forward. The next replace() then wrote the entry the browser had left,
 * two entries ended up sharing one id, and a later Back found the old path under the browser's id and rebuilt the whole app
 * from the URL (seen in Chromium and WebKit: open a sheet → Back → change page → open a sheet → Back = sign-in).
 */
import { afterEach, beforeEach, expect, test } from '@jest/globals';
import { createMemoryHistory } from 'expo-router/build/fork/createMemoryHistory';

/** A user's browser Back: the browser moves and fires popstate (asynchronously, as browsers do). */
const userBack = () => new Promise<void>((resolve) => { window.addEventListener('popstate', () => resolve(), { once: true }); window.history.back(); });

let stop = () => {};
beforeEach(() => { window.history.replaceState(null, '', '/'); });
afterEach(() => { stop(); });

test('after a user Back, a replace writes the entry the browser is on, and the next Back finds the path the address says', async () => {
  const h = createMemoryHistory();
  stop = h.listen(() => {});
  h.replace({ path: '/', state: undefined as never }); // the app's route
  h.push({ path: '/odds', state: undefined as never }); // a sheet
  await userBack(); // closed by the browser's Back
  expect([window.location.pathname, h.index]).toEqual(['/', 0]);
  h.replace({ path: '/wallet', state: undefined as never }); // the app's address follows a page change
  expect(h.get(h.index)!.path).toBe('/wallet');
  h.push({ path: '/odds', state: undefined as never }); // a sheet again
  await userBack();
  // The entry under the browser's id is the one the address names; the stale `index` put `/` here, and the router rebuilt.
  expect([window.location.pathname, h.get(h.index)!.path]).toEqual(['/wallet', '/wallet']);
});
