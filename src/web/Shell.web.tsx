// The arcade shell (W1.1, #123): what a browser wider than a phone shows around the app. From `design/Web Arcade.dc.html`:
// a dim room, the cabinet (466×1000 as drawn, scaled by shellLayout's formula) with the app running at 390×844 in its screen,
// a copy column (right of it on a desktop, under it on a laptop, absent on a tablet), and a footer strip. Under 768 px there is
// no shell at all: the app is the page (W0.3).
//
// ONE element tree for every tier. The app's parents are the same elements, in the same slots, whether or not the chrome is
// drawn around them (`tier && <chrome/>` leaves a hole, it does not shift the siblings), so dragging a window across 768,
// 1024 or 1280 re-styles and never remounts: a pull in progress survives (AC-2).
//
// The key hints are the bridge's (W1.2 #124; the bridge itself lives with the ritual). What is NOT here yet, each its own
// ticket: the cabinet shake (W1.3, deferred), the gold flare. ("Get it on your phone" is PhoneCard.web.tsx, W1.4; the footer's
// links are W1.5.) The canvas's referral headline is post-launch (plan §7.23).
//
// Web only by construction: nothing outside this file imports it (`Shell.tsx` is what a phone gets), and an iOS bundle is
// checked for the marker below (AC-5).
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AppFrameProvider, type AppFrame } from '@/state/appFrame';
import { color } from '@/theme/tokens';
import { CABINET, SCREEN, shellLayout, viewportBox } from './shellLayout';
import { installSpaceGuard } from './spaceKey';

export const SHELL_MARKER = 'gachapon-arcade-shell-web-only';
const LIFT = -6; // px, as drawn: the cabinet rises under the pointer

// What is drawn around the app is its own chunk (ShellChrome.web.tsx, W3.5 #142): a phone never draws it, so never fetches it.
// A window that opens wide asks for it at once, beside the fonts; one widened later asks then. The module is plain state, drawn
// the moment it is here: no React.lazy, no Suspense. A lazy part with no error boundary above it took the whole root down
// when the chunk failed to load (a network blip, an old tab after a deploy: the app blanked mid-pull), and React's Suspense
// reveal throttle showed the screen ~320 ms before the cabinet on every wide load (PR #170's review measured both). A chunk
// that fails is forgotten, so the next widen asks again; until then the app runs with no chrome around it.
type Chrome = typeof import('./ShellChrome.web');
let chrome: Promise<Chrome> | null = null;
let loaded: Chrome | null = null;
const loadChrome = (): Promise<Chrome> =>
  (chrome ??= import('./ShellChrome.web').then((m) => (loaded = m), (e: unknown) => { chrome = null; throw e; }));
if (typeof window !== 'undefined' && shellLayout(window.innerWidth, window.innerHeight).tier !== 'mobile') loadChrome().catch(() => {});

// `.ga-anim` marks everything of the shell's that moves; reduced motion stills exactly those and nothing of the app's.
// The last rule puts react-native-web's Modals inside the cabinet's screen: RNW portals a Modal to <body> and fixes it to the
// window, which here is the whole room. A transformed box is the containing block of its fixed descendants, so the portal's own
// <div> is given the screen's place and scale (the variables are this component's, below) and the Modal lays itself out in
// 390×844 as it does on a phone. RNW's Escape handling and focus trap are untouched. If `:has()` is missing the Modal is
// window-sized, as it was before the shell: usable, not pretty.
const CSS = `
@keyframes gaDust{0%{transform:translate(0,0);opacity:0}15%{opacity:.5}85%{opacity:.5}100%{transform:translate(18px,-90px);opacity:0}}
@keyframes gaLed{0%,100%{opacity:1}50%{opacity:.55}}
@keyframes gaBoot{0%{opacity:0;transform:scale(.985)}100%{opacity:1;transform:scale(1)}}
.ga-boot{animation:gaBoot .5s ease-out}
.ga-cab{transition:transform .35s cubic-bezier(.2,.9,.2,1)}
@media(prefers-reduced-motion:reduce){.ga-anim,.ga-boot,.ga-cab{animation:none!important;transition:none!important}}
html[data-ga-cabinet] body>div:has([aria-modal="true"]),html[data-ga-cabinet] body>#headlessui-portal-root{position:fixed!important;inset:auto!important;left:var(--ga-x)!important;top:var(--ga-y)!important;width:${SCREEN.width}px!important;height:${SCREEN.height}px!important;transform:scale(var(--ga-s))!important;transform-origin:0 0!important;overflow:hidden;border-radius:${SCREEN.radius}px;transition:top .35s cubic-bezier(.2,.9,.2,1)}
html[data-ga-cabinet] body>div:has([aria-modal="true"]){z-index:9999!important}
html[data-ga-cabinet] body>#headlessui-portal-root{z-index:10000!important}
html[data-ga-cabinet] body>#headlessui-portal-root #privy-dialog-backdrop+div{width:100%!important;min-height:100%!important;height:100%!important}
@media(prefers-reduced-motion:reduce){html[data-ga-cabinet] body>div:has([aria-modal="true"]),html[data-ga-cabinet] body>#headlessui-portal-root{transition:none}}
`;

const abs = (s: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', ...s });
const fill: React.CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 };

export function Shell({ children, ready }: { children: React.ReactNode; ready: boolean }) {
  // Nothing is known about the window on the server, or in the first client render that has to match it: both are the
  // frameless page. The size arrives in a layout effect, so the first thing painted already has the right tier.
  const [win, setWin] = useState<{ w: number; h: number; top: number; left: number } | null>(null);
  const [hover, setHover] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // visualViewport, not only window resize: mobile browser chrome changes the visible box without a window resize,
    // and a layout viewport taller than that box left the rail under the chrome (#325).
    const read = () => setWin(viewportBox(window));
    read();
    window.addEventListener('resize', read);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', read);
    vv?.addEventListener('scroll', read);
    return () => {
      window.removeEventListener('resize', read);
      vv?.removeEventListener('resize', read);
      vv?.removeEventListener('scroll', read);
    };
  }, []);

  const L = shellLayout(win?.w ?? 0, win?.h ?? 0);
  const cab = !!win && L.tier !== 'mobile';
  // On a phone the frame is the visual viewport (scale 1), so a sleeve or a takeover sizes to the box that is actually on screen.
  const frame = useMemo<AppFrame | null>(() => {
    if (!win) return null;
    return cab ? { width: SCREEN.width, height: SCREEN.height, scale: L.scale } : { width: win.w, height: win.h, scale: 1 };
  }, [cab, L.scale, win]);
  // The chrome's module, once it is here (above). Asked for when the tier first needs it; a failed ask is retried by the next.
  const [C, setC] = useState<Chrome | null>(() => loaded);
  useEffect(() => {
    if (!cab || C) return;
    let live = true;
    loadChrome().then((m) => { if (live) setC(m); }, () => {});
    return () => { live = false; };
  }, [cab, C]);

  // Where the screen is in the window, for the Modal rule above. The grid centres the stage, so the stage is measured (it is
  // never transformed, so the answer does not depend on a lift in mid-transition) and the rest is the cabinet's own geometry:
  // it scales about its top centre, and the screen is cut at (38, 70) of it.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!cab || !stage.current) { root.removeAttribute('data-ga-cabinet'); return; }
    const r = stage.current.getBoundingClientRect();
    root.setAttribute('data-ga-cabinet', '1');
    root.style.setProperty('--ga-x', `${r.left + r.width / 2 + (SCREEN.left - CABINET.width / 2) * L.scale}px`);
    root.style.setProperty('--ga-y', `${r.top + (SCREEN.top + (hover ? LIFT : 0)) * L.scale}px`);
    root.style.setProperty('--ga-s', String(L.scale));
  }, [cab, L.scale, L.tier, win?.w, win?.h, hover]);
  useLayoutEffect(() => () => document.documentElement.removeAttribute('data-ga-cabinet'), []);
  useEffect(() => installSpaceGuard(), []); // every tier: a tablet or a phone with a keyboard scrolls on space too

  return (
    <div data-shell={SHELL_MARKER} data-tier={win ? L.tier : 'unknown'} style={{ position: 'fixed', top: win?.top ?? 0, left: win?.left ?? 0, width: win ? win.w : '100%', height: win ? win.h : '100%', overflow: 'hidden', color: color.text, background: cab ? 'radial-gradient(ellipse at 50% 30%,#141A30 0%,#0B0E1A 45%,#05070F 100%)' : color.room }}>
      <style>{CSS}</style>
      {cab && C && <C.Room opacity={L.roomOpacity} dust={L.dust} />}
      <div style={cab ? { ...fill, display: 'grid', gridTemplateColumns: L.cols, gridTemplateRows: L.rows, alignItems: 'center', justifyItems: 'center', alignContent: 'center', gap: L.gap, padding: L.pagePad, boxSizing: 'border-box', overflow: 'hidden' } : fill}>
        <div ref={stage} style={cab ? { position: 'relative', width: L.stageW, height: L.stageH, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', gridColumn: L.copy === 'right' ? 2 : 1, gridRow: 1 } : fill}>
          {cab && C && <C.Floor stageW={L.stageW} stageH={L.stageH} />}
          <div
            className="ga-cab" data-testid="cabinet" data-scale={cab ? L.scale : undefined}
            onPointerEnter={cab ? () => setHover(true) : undefined} onPointerLeave={cab ? () => setHover(false) : undefined}
            style={cab ? { position: 'relative', flex: 'none', width: CABINET.width, height: CABINET.height, transformOrigin: 'top center', transform: `scale(${L.scale}) translateY(${hover ? LIFT : 0}px)` } : fill}
          >
            {cab && C && <C.CabinetBack />}
            <div data-testid="cabinet-screen" style={cab ? abs({ left: SCREEN.left, top: SCREEN.top, width: SCREEN.width, height: SCREEN.height, borderRadius: SCREEN.radius, overflow: 'hidden', background: '#000' }) : fill}>
              {cab && !ready && <ScreenOff />}
              <div className={cab && ready ? 'ga-boot' : undefined} style={{ ...fill, display: 'flex', flexDirection: 'column' }}>
                <AppFrameProvider value={frame}>{children}</AppFrameProvider>
              </div>
              {cab && <div aria-hidden style={{ ...fill, pointerEvents: 'none', borderRadius: SCREEN.radius, boxShadow: 'inset 0 0 22px rgba(0,0,0,.55),inset 0 2px 0 rgba(255,255,255,.06)', background: 'linear-gradient(115deg,rgba(255,255,255,.05),transparent 35%)' }} />}
            </div>
            {cab && C && <C.CabinetFront />}
          </div>
        </div>
        {cab && C && ready && L.copy !== 'none' && <C.Copy where={L.copy} />}
      </div>
      {cab && C && ready && L.copy !== 'none' && <C.KeyHints />}
      {cab && C && ready && L.footer && <C.Footer />}
    </div>
  );
}

/** The cabinet's screen before the app is ready (its fonts are still on the way): dark glass, a dim capsule. */
function ScreenOff() {
  return (
    <div aria-hidden style={{ ...fill, background: 'radial-gradient(ellipse at 50% 40%,#0C1020,#03040A 80%)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'linear-gradient(180deg,#2A3148 50%,#3E4660 50%)', opacity: 0.5, boxShadow: 'inset -4px -5px 8px rgba(0,0,0,.4)' }} />
    </div>
  );
}
