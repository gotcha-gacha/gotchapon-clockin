// Page-wide CSS for the web document (W1.6, #139), written into <head> by +html.tsx. A string and nothing else: +html runs in
// Node at export.
import { color } from '@/theme/tokens';

/** The focus ring. The browser's own is a 1 px dark blue line: on this room's navy it cannot be seen (measured: `auto 1px
 *  rgb(0, 95, 204)` on every control). `:focus-visible`, so a mouse or a finger never draws it; a text field always does,
 *  which is the platform's rule, not ours. */
export const FOCUS_RING = `:focus-visible { outline: 2px solid ${color.yellow} !important; outline-offset: 2px; }`;

/** Reduced motion, the belt. The app's own animations are Reanimated's, which already jump to their end under the system
 *  setting, and its two frame loops stop (F6.2); the shell turns its own off by name (W1.1). This catches what neither owns:
 *  any CSS animation or transition a library brings (react-native-web's spinner, a Modal's slide), and smooth scrolling.
 *  Transitions are `none`, not "very short": the usual `transition-duration: 0.01ms` on `*` makes every per-frame style write
 *  Reanimated does into a new transition (22 of them running at once on the globe's capsules, measured). */
export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; animation-iteration-count: 1 !important; transition: none !important; scroll-behavior: auto !important; } }';

/**
 * The first screen fills the dark panel (the cabinet's screen, or the phone viewport). It used to scroll
 * (`overflow-y: auto`, #326) so a short window could reach the call to action, and that is a native scrollbar:
 * the sky canvas is inset 12px past the panel on purpose, and a column a few pixels taller scrolls the whole
 * panel. The panel clips. When the in-flow column is actually taller, FirstScreen scales it to fit (#325).
 */
export const FIRST_SCREEN_PANEL = '[data-testid="first-screen"]{overflow:hidden}';

/** A deposit address has no spaces. Without this it is one unbreakable line and widens the wallet page on a phone. */
export const ADDRESS_WRAP = '[data-testid="deposit-address"],[data-testid="export-deposit-address"]{overflow-wrap:anywhere}';

/**
 * While the wallet is unread, the app frame is one `filter: blur`. A descendant with its own
 * `transform` is a separate layer, and Chrome paints that layer sharp on top of the blur — the
 * rail's scaled tabs, the machine's moving parts. Those transforms stay off until the frost
 * clears (`data-balance-pending` on the document, set beside the blur).
 */
export const HYDRATION_FLAT = 'html[data-balance-pending] [data-frost] div{transform:none !important;will-change:auto !important}';

export const PAGE_CSS = `${FOCUS_RING}\n${REDUCED_MOTION}\n${FIRST_SCREEN_PANEL}\n${ADDRESS_WRAP}\n${HYDRATION_FLAT}`;
