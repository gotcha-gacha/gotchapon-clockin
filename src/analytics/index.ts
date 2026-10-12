// Analytics events (F0.4, BUILD_PLAN §6). Event names are shared with Dev 2; the vendor sits behind a seam: PostHog (#143,
// Ben's pick 17 Sept), installed at boot by `installAnalytics()` (`posthog.ts` on a phone, `posthog.web.ts` in a browser)
// when a project key is in the environment, and nothing at all when it is not. Until a sink is installed events go to a
// bounded buffer, so a sink that arrives late (the web's is a chunk fetched after the app mounts) still gets the session's
// start; in development they also go to the console. Gate metrics (D7 repeat-pull, pulls per session, burn rate,
// completion %, top-up sizes, EV delivered vs published) are computed from these server-side.
import type { Tier } from '@/api/contract';

export type AnalyticsEvent =
  | { name: 'session_start'; props: { usingMock: boolean } }
  // `wallet` is the wallet's name (Phantom, Backpack, …), never its address (#244).
  | { name: 'signup'; props: { provider: 'Apple' | 'Google' | 'email' } | { provider: 'wallet'; wallet: string } }
  // No wallet address on the event (#143, audit item 7): the vendor already knows who the user is (`identify`), and the
  // address is the one property that would tie an analytics profile to what happens on-chain.
  | { name: 'wallet_created'; props: Record<string, never> }
  // The deposit-key modal (#352). No address and no key material: Privy shows the key, this app does not.
  | { name: 'export_clicked'; props: Record<string, never> }
  | { name: 'export_completed'; props: Record<string, never> }
  | { name: 'deposit_address_viewed'; props: Record<string, never> }
  | { name: 'deposit_credited'; props: { usd: number } }
  | { name: 'pull_committed'; props: { count: number; targeted: boolean; freePulls: number; costUsd: number } }
  | { name: 'pull_revealed'; props: { rarity: Tier; isDupe: boolean; albumId?: string; source: 'crank' | 'burn'; count: number } }
  | { name: 'withdraw'; props: { usd: number } }
  | { name: 'burn'; props: { extrasBefore: number } }
  | { name: 'album_completed'; props: { albumId: string } }
  | { name: 'reward_claimed'; props: { albumId: string; packType: string } }
  | { name: 'odds_viewed'; props: Record<string, never> }
  | { name: 'render_error'; props: { message: string } } // the root ErrorBoundary caught a screen that could not be drawn (W0.2d)
  | { name: 'redemption_requested'; props: { cardCount: number } }; // BUILD_PLAN §6 name; issue #5 calls it shipment_requested

export type Sink = (event: AnalyticsEvent & { at: string }) => void;
/** A vendor: where events go, and (each optional) who the user is, that they signed out, and an error worth a stack. */
export type Vendor = { send: Sink; identify?: (userId: string) => void; reset?: () => void; captureError?: (error: unknown) => void };

/** Events kept while no sink is installed, oldest dropped first past this many (#143, audit item 7: the buffer had no
 *  cap, and a web tab left open all day had no ceiling). A session produces a few dozen; the cap is for the build that
 *  never installs a sink, where the buffer would otherwise grow for the life of the page. */
export const BUFFER_CAP = 200;
/** Errors kept the same way: fewer, because each carries a stack. */
export const ERROR_CAP = 20;

const buffer: (AnalyticsEvent & { at: string })[] = [];
const errors: unknown[] = [];
let vendor: Vendor | null = null;
/** The signed-in user, remembered so a vendor installed after sign-in (the web's chunk) still learns who this is. */
let identity: string | null = null;

/** Install the vendor; buffered events are replayed once, in order, then the identity and any errors caught meanwhile. */
export function setAnalyticsSink(next: Sink | Vendor | null) {
  vendor = typeof next === 'function' ? { send: next } : next;
  if (!vendor) return;
  for (const e of buffer.splice(0)) vendor.send(e);
  if (identity) vendor.identify?.(identity);
  for (const err of errors.splice(0)) vendor.captureError?.(err);
}

export function track<E extends AnalyticsEvent>(name: E['name'], props: E['props']) {
  const event = { name, props, at: new Date().toISOString() } as AnalyticsEvent & { at: string };
  if (vendor) vendor.send(event);
  else { if (buffer.length >= BUFFER_CAP) buffer.shift(); buffer.push(event); }
  if (__DEV__) console.log(`[analytics] ${name}`, props);
}

/** Who the user is, by the API's own id (never the wallet address): on sign-in, and again for a vendor installed later. */
export function identify(userId: string) {
  identity = userId;
  vendor?.identify?.(userId);
}

/** Sign-out: the vendor forgets the user, and so does this seam. */
export function resetIdentity() {
  identity = null;
  vendor?.reset?.();
}

/** An error worth a stack (the root ErrorBoundary's, W0.2d): to the vendor's error tracking, or kept until one exists. */
export function captureError(error: unknown) {
  if (vendor) vendor.captureError?.(error);
  else { if (errors.length >= ERROR_CAP) errors.shift(); errors.push(error); }
}

/** For tests and debugging: what has not reached a sink yet. */
export function pendingEvents() { return buffer.slice(); }
/** For tests: the seam as new — no vendor, no identity, nothing buffered. */
export function resetAnalyticsForTests() { vendor = null; identity = null; buffer.length = 0; errors.length = 0; }
