// Sheets as routes (W2.1, #128; plan §4.4). On the web, the two surfaces browser Back should close, the card detail sheet
// (`/card/:cardId`) and the odds sleeve (`/odds`), are routes pushed over the app: Back pops them, `esc` calls `router.back()`,
// and a cold load of their URL boots into them. On a phone, and in a test that renders a screen without a router, they stay
// what they were: component / session state. `sheetsRouted()` is the switch, set by the web Home once it is inside the
// router (src/navigation/useUrlState.web.ts), never on native.
import { router } from 'expo-router';
import type { Tier } from '@/api/contract';

let routed = false;
export function setSheetsRouted(on: boolean): void { routed = on; }
export function sheetsRouted(): boolean { return routed; }

export const oddsHref = () => '/odds' as const;
export const cardHref = (cardId: string, rarity?: Tier) => ({ pathname: '/card/[cardId]' as const, params: rarity && rarity !== 'common' ? { cardId, tier: rarity } : { cardId } });

/** A sheet route cold-loaded before sign-in cannot stay: its screen, empty, sits over the sign-in and takes every click (seen
 *  in Chromium: `/odds` cold, "Continue with Apple" unreachable), and react-native-screens hides the screen beneath from
 *  assistive tech. So the route steps back to the app and leaves its href here; the web Home pushes it again the moment the
 *  collector is signed in. */
let pending: SheetHref | null = null;
export type SheetHref = ReturnType<typeof oddsHref> | ReturnType<typeof cardHref>;
export function deferSheet(href: SheetHref): void { pending = href; }
export function takeDeferredSheet(): SheetHref | null { const h = pending; pending = null; return h; }

/** The odds route's own close, while it is mounted: the ONE way a routed sleeve is closed, whoever asks (its ✕, esc, a page
 *  change, the app going). Guarded inside the route, so it sends exactly one Back. Two closers with a flag each raced: the
 *  route's cleanup cleared the session's flag, the session's close then saw nothing open and sent no Back, and the empty route
 *  stayed on top of the other-tab card, taking its clicks (seen after PR #165's first review). */
let oddsClose: (() => void) | null = null;
export function provideOddsClose(fn: () => void): () => void { oddsClose = fn; return () => { if (oddsClose === fn) oddsClose = null; }; }
export function closeRoutedOdds(): void { oddsClose?.(); }

/** Push a sheet route. Singular: a second press while it is opening pushes no second copy. */
export function pushSheet(href: SheetHref): void { router.push(href, { dangerouslySingular: true }); }

/** A card tapped in the binder: on the web a route (Back closes it), elsewhere whatever the page does with it. */
export function openCardSheet(cardId: string, rarity: Tier | undefined, inPage: (cardId: string, rarity?: Tier) => void): void {
  if (routed) pushSheet(cardHref(cardId, rarity));
  else inPage(cardId, rarity);
}
