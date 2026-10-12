// Which addresses are the app's, and what the tab says on each (W2.2, #129; plan §4.4). Pure: no router, no platform.
import { PRODUCT_NAME } from '@/brand/name';
import { PAGE, type PageIndex } from '@/state/session';

/** Tab title and og:site_name. The working product name; bundle id and scheme stay `gachapon`. */
export const SITE = PRODUCT_NAME;
/** The one description the site has. The shell's headline (#398), so no second public claim is made here. */
export const SITE_DESCRIPTION = 'Everyone\u2019s chasing grails. Finish a binder instead.';

/** A page address the catch-all route answers with the app: `/`, `/pull`, `/binder`, `/binder/:albumId`, `/wallet`,
 *  `/wallet/deposit` (a trailing slash and percent-encoding are nothing). The shape is what is checked: an album id that
 *  does not exist still opens the albums grid, because the albums are only known after sign-in (W2.1). Anything else is
 *  not found. `/card/:id` and `/odds` are routes of their own and never reach this. */
export function isAppPath(segments: readonly string[]): boolean {
  const [first, second, ...more] = segments;
  if (more.length) return false;
  if (first === undefined) return true;
  if (first === 'pull') return second === undefined;
  if (first === 'binder') return true;
  if (first === 'wallet') return second === undefined || second === 'deposit';
  return false;
}
/** The catch-all's OWN `path`, as segments. expo-router copies every query key into a route's params unless the route has a
 *  param of that name, so at `/` (no path of its own) `?path=nope` arrived as `path: 'nope'` and the site root drew the
 *  not-found page (W2.2's review). The route's own value is always an array, and at the site root it has none, whatever the
 *  query says (`?path=a&path=b` arrives as an array too). */
export function ownSegments(path: string | string[] | undefined, pathname: string): string[] {
  if (!Array.isArray(path) || !pathname.split('/').some(Boolean)) return [];
  return segmentsOf(path);
}
/** The catch-all's own `path` param as segments (undefined at `/`, a string or an array depending on the router's parse). */
export function segmentsOf(path: string | string[] | undefined): string[] {
  const raw = path === undefined ? [] : Array.isArray(path) ? path : path.split('/');
  return raw.filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });
}

/** `<thing> · Gotchapon`, or the site's name alone. */
export const titled = (thing?: string | null) => (thing ? `${thing} · ${SITE}` : SITE);
/** The tab's title for the app's own pages, from the session: the machine before anyone is signed in. */
export function pageTitle(s: { signedIn: boolean; page: PageIndex; albumTitle?: string | null }): string {
  if (!s.signedIn) return titled();
  if (s.page === PAGE.albums) return titled(s.albumTitle ?? 'Albums');
  if (s.page === PAGE.wallet) return titled('Wallet');
  return titled('Pull');
}
