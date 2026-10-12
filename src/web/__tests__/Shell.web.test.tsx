/**
 * The arcade shell in a DOM (W1.1, #123). jsdom lays nothing out, so what is asserted is what the shell decides: which tier,
 * what is drawn around the app, what the copy says, what the app is told about its frame, and that the app's element is the
 * SAME element in every tier (a resize must never remount the app: a pull may be in progress). The pixels are the browser
 * runs' job.
 */
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Shell, SHELL_MARKER } from '../Shell.web';
import { VALUE_PROPS } from '../ShellChrome.web';
import { SITE_DESCRIPTION } from '@/navigation/appPaths';
import { PRIVACY_URL, TERMS_URL } from '@/legal/urls';
import { provideShellCommand } from '@/state/shellCommands';
import { useAppFrame, useGestureScale } from '@/state/appFrame';

// The phone card reads the URL through the router's hooks (its own test drives them); here the shell stands alone.
jest.mock('expo-router', () => ({ usePathname: () => '/', useGlobalSearchParams: () => ({}) }));
jest.mock('react-native-qrcode-svg', () => ({ __esModule: true, default: () => null }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root; let host: HTMLElement; let mounts = 0;
function App() {
  const frame = useAppFrame(); const k = useGestureScale();
  React.useEffect(() => { mounts++; }, []);
  return <div data-testid="app" data-frame={`${frame.width}x${frame.height}@${frame.scale}`} data-k={k.toFixed(3)} />;
}
const size = async (w: number, h: number) => { await act(async () => { Object.assign(window, { innerWidth: w, innerHeight: h }); window.dispatchEvent(new Event('resize')); }); };
const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

beforeEach(async () => {
  mounts = 0; Object.assign(window, { innerWidth: 1440, innerHeight: 900 });
  host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<Shell ready><App /></Shell>); });
});
afterEach(async () => { await act(async () => { root.unmount(); }); host.remove(); });

test('desktop: the cabinet at the formula scale, the copy to its right, the footer, and the app told it lives in 390×844', () => {
  expect(q('[data-shell]')!.dataset.shell).toBe(SHELL_MARKER);
  expect(q('[data-shell]')!.dataset.tier).toBe('desktop');
  expect(q('[data-testid="cabinet"]')!.dataset.scale).toBe('0.776');
  expect(q('[data-testid="cabinet"]')!.style.transform).toBe('scale(0.776) translateY(0px)');
  expect(q('[data-testid="shell-copy"]')!.style.gridColumn).toBe('3');
  expect(q('[data-testid="shell-footer"]')).not.toBeNull();
  expect(q('[data-testid="app"]')!.dataset.frame).toBe('390x844@0.776');
  expect(q('[data-testid="app"]')!.dataset.k).toBe((1 / 0.776).toFixed(3)); // what a gesture multiplies a touch by
});

test('across every tier boundary the app is the same element, mounted once; each tier draws what the design says', async () => {
  const app = q('[data-testid="app"]');
  await size(1100, 800);
  expect([q('[data-shell]')!.dataset.tier, q('[data-testid="shell-copy"]'), !!q('[data-testid="shell-footer"]')]).toEqual(['laptop', null, true]);
  expect(q('[data-testid="cabinet"]')!.dataset.scale).toBe('0.696'); // the machine keeps the height; the copy does not take 250px first
  await size(1100, 1400);
  expect(q('[data-testid="shell-copy"]')!.style.gridRow).toBe('2'); // a tall laptop still has the copy under the cabinet
  await size(820, 1180);
  expect([q('[data-shell]')!.dataset.tier, q('[data-testid="shell-copy"]'), !!q('[data-testid="shell-footer"]')]).toEqual(['tablet', null, true]);
  await size(390, 844);
  expect([q('[data-shell]')!.dataset.tier, q('[data-testid="shell-copy"]'), q('[data-testid="shell-footer"]')]).toEqual(['mobile', null, null]);
  expect(q('[data-testid="cabinet"]')!.style.transform).toBe(''); // frameless: nothing scaled, nothing lifted
  expect(q('[data-testid="app"]')!.dataset.frame).toBe('390x844@1'); // frameless: the visual viewport, scale 1
  expect(document.documentElement.hasAttribute('data-ga-cabinet')).toBe(false); // and Modals go back to the window
  await size(1440, 900);
  expect(q('[data-testid="app"]')).toBe(app);
  expect(mounts).toBe(1);
});

test('the copy: Option A headline, three bullets, and scan line, and none of the claims that were cut (#398)', () => {
  const text = q('[data-testid="shell-copy"]')!.textContent!;
  expect(SITE_DESCRIPTION).toBe('Everyone\u2019s chasing grails. Finish a binder instead.');
  expect(text).toContain(SITE_DESCRIPTION);
  expect(VALUE_PROPS.map((p) => p.text)).toEqual([
    '$1 pulls of real cards into albums built to complete \u2014 not just hunt the expensive hit.',
    'Finish an album \u2192 Claim pack: free Jupiter Degen pack credit (open on Jupiter).',
    'Paid pulls stamp the seasonal raffle; keep your streak for extra tickets.',
  ]);
  for (const p of VALUE_PROPS) expect(text).toContain(p.text);
  expect(text).toContain('Scan to play on your phone. \u00B7 App Store & Google Play \u00B7 soon');
  expect(text).toContain('App Store \u00B7 soon');
  expect(text).toContain('Google Play \u00B7 soon');
  expect(text).toContain('GOTCHA');
  expect(text).toContain('PON');
  expect(text).not.toMatch(/free pulls?|3 free|\bdupes?\b|\bduplicates?\b/i);
  const shell = q('[data-shell]')!.textContent!;
  expect(shell).not.toMatch(/counted|audit|weekly|quarterly|ship home|any time|18\+|pocket ?binder/i);
  expect(shell).not.toMatch(/\b(mint|NFT|token|on-chain|Solana)\b/i); // no crypto vocabulary in public copy
});

test('before the app is ready the cabinet is drawn dark, without copy or footer (their font is not in yet); the app arrives in the same slot', async () => {
  await act(async () => { root.render(<Shell ready={false}>{null}</Shell>); });
  expect(q('[data-testid="cabinet"]')).not.toBeNull();
  expect([q('[data-testid="shell-copy"]'), q('[data-testid="shell-footer"]'), q('.ga-boot')]).toEqual([null, null, null]);
  await act(async () => { root.render(<Shell ready><App /></Shell>); });
  expect(q('.ga-boot')!.contains(q('[data-testid="app"]'))).toBe(true);
});

test('Modals are steered into the screen: the root says a cabinet is up and where its screen is; hovering lifts both together', async () => {
  const root$ = document.documentElement;
  expect(root$.getAttribute('data-ga-cabinet')).toBe('1');
  expect(root$.style.getPropertyValue('--ga-s')).toBe('0.776');
  const y0 = parseFloat(root$.style.getPropertyValue('--ga-y'));
  await act(async () => { q('[data-testid="cabinet"]')!.dispatchEvent(new MouseEvent('pointerover', { bubbles: true })); }); // React's onPointerEnter listens to pointerover
  expect(q('[data-testid="cabinet"]')!.style.transform).toBe('scale(0.776) translateY(-6px)');
  expect(parseFloat(root$.style.getPropertyValue('--ga-y'))).toBeCloseTo(y0 - 6 * 0.776, 3);
  // The wordmark is a React Native tree, so react-native-web's own sheet can sit ahead of the shell's. The rules are still in the page.
  const css = [...document.querySelectorAll('style')].map((s) => s.textContent).join('\n');
  expect(css).toContain('html[data-ga-cabinet] body>div:has([aria-modal="true"])');
  expect(css).toContain('html[data-ga-cabinet] body>#headlessui-portal-root');
  // Privy's Wallet Standard chooser is a sibling portal. It must paint over the app's sign-in Modal
  // regardless of which portal was inserted first, or "Choose browser wallet" appears to do nothing.
  expect(css).toContain('body>div:has([aria-modal="true"]){z-index:9999!important}');
  expect(css).toContain('body>#headlessui-portal-root{z-index:10000!important}');
  // Privy sizes the chooser with viewport units. Inside the scaled cabinet those refer to the browser,
  // so pin its centering layer to the 390x844 portal instead.
  expect(css).toContain('#privy-dialog-backdrop+div{width:100%!important;min-height:100%!important;height:100%!important}');
  // reduced motion stills every moving bit of the shell (its own rule: the Modal's transition has a separate one below it)
  expect(css).toContain('@media(prefers-reduced-motion:reduce){.ga-anim,.ga-boot,.ga-cab{animation:none!important;transition:none!important}}');
});

// W1.5 (#127), #354. Terms and Privacy open the interim drafts. Shipping and Contact are off the strip (soft-launch product lock).
// Odds is not in the footer (#332).
const footerItem = (text: string) => [...q('[data-testid="shell-footer"]')!.querySelectorAll('button, span, a')].find((el) => el.textContent === text) as HTMLElement | undefined;

test('footer: Terms and Privacy open the interim drafts; Shipping and Contact are hidden; no address, no age line', () => {
  const footer = q('[data-testid="shell-footer"]')!;
  expect(footerItem('Shipping · soon')).toBeUndefined();
  expect(footerItem('Contact · soon')).toBeUndefined();
  expect(footer.textContent).not.toMatch(/Shipping|Contact|· soon/);
  const terms = footerItem('Terms') as HTMLAnchorElement;
  const privacy = footerItem('Privacy') as HTMLAnchorElement;
  expect([terms.tagName, terms.getAttribute('href'), terms.getAttribute('target'), terms.getAttribute('rel')]).toEqual(['A', TERMS_URL, '_blank', 'noopener noreferrer']);
  expect([privacy.tagName, privacy.getAttribute('href'), privacy.getAttribute('target')]).toEqual(['A', PRIVACY_URL, '_blank']);
  expect(footer.querySelectorAll('a').length).toBe(2);
  expect(footer.innerHTML).not.toMatch(/mailto|pocketbinder|@|shipping policy/i);
  expect(footer.textContent).toContain('Collectibles marketplace, not a casino. © 2026 Gotchapon');
  expect(q('[data-shell]')!.textContent).not.toMatch(/18\s*\+|18 or over/);
});

test('the shell fills the visual viewport, so browser chrome does not leave the rail below the page', async () => {
  const prev = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const vv = { width: 390, height: 640, offsetTop: 48, offsetLeft: 0, addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => vv });
  try {
    await size(390, 844);
    const shell = q('[data-shell]')!;
    expect([shell.style.top, shell.style.height, shell.style.width]).toEqual(['48px', '640px', '390px']);
    expect(q('[data-testid="app"]')!.dataset.frame).toBe('390x640@1');
  } finally {
    if (prev) Object.defineProperty(window, 'visualViewport', prev);
    else delete (window as { visualViewport?: unknown }).visualViewport;
    await size(1440, 900);
  }
});

test('footer has no Odds control; the strip lets clicks through and the links take them (#332)', async () => {
  expect(footerItem('Odds')).toBeUndefined();
  expect(q('[data-testid="shell-footer"]')!.textContent).not.toMatch(/Sign in to see the odds|Odds per/);
  expect(q('[data-testid="shell-keys"]')!.textContent).not.toMatch(/odds/i);
  let opened = 0;
  await act(async () => { provideShellCommand('odds', () => { opened++; }); });
  expect(footerItem('Odds')).toBeUndefined();
  expect(opened).toBe(0);
  expect(getComputedStyle(footerItem('Terms')!.parentElement!).pointerEvents).toBe('auto');
  expect(getComputedStyle(q('[data-testid="shell-footer"]')!).pointerEvents).toBe('none');
});
