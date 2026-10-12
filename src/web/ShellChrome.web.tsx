// What the arcade shell draws around the app from 768 px up (W1.1 #123, W1.4 #126, W1.5 #127): the room, the floor, the
// cabinet's body and front, the copy with "Get it on your phone", the key hints and the footer. Its own async chunk (W3.5,
// #142): a phone never draws any of it, so a phone never fetches it. Shell.web.tsx keeps the elements the app sits in (one
// tree for every tier) and loads this beside the fonts when the window opens wide, or when it is first widened past 768.
import React from 'react';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { FOOTER_H } from './shellLayout';
import { useKeyUsed } from './keyHints';
import { PhoneCard } from './PhoneCard.web';
import { SITE_DESCRIPTION } from '@/navigation/appPaths'; // the headline IS the site's description (W2.2): one copy
import { PRODUCT_NAME } from '@/brand/name';
import { BrandLockup } from '@/brand/Wordmark';
import { PRIVACY_URL, TERMS_URL } from '@/legal/urls';

/** In the chunk and nowhere else: the budget check (scripts/bundle-budget.mjs) finds it in an async chunk and never in what
 *  the page loads first. */
export const SHELL_CHROME_MARKER = 'gachapon-shell-chrome-web-only';
const SHELL = ['#E9464B', '#B8242E', '#7A1620'] as const; // the coral cabinet

// Dust motes: fixed, not random (a render must not roll dice; and two renders must agree).
const MOTES = Array.from({ length: 14 }, (_, i) => ({ l: `${(i * 37 + 11) % 97}%`, t: `${(i * 53 + 29) % 83 + 10}%`, s: 2 + (i % 3), d: `${9 + (i % 5) * 2}s`, dl: `${-(i * 1.3).toFixed(1)}s` }));

const abs = (s: React.CSSProperties): React.CSSProperties => ({ position: 'absolute', ...s });
const fill: React.CSSProperties = { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 };

export function Room({ opacity, dust }: { opacity: number; dust: boolean }) {
  return (
    <div aria-hidden data-chrome={SHELL_CHROME_MARKER} style={{ ...fill, pointerEvents: 'none', opacity }}>
      <div style={abs({ left: '-6%', top: '6%', width: '34%', height: '70%', borderRadius: 40, background: 'linear-gradient(180deg,#3A1F2A,#1A0E14)', filter: 'blur(28px)', opacity: 0.55 })} />
      <div style={abs({ left: '8%', top: '16%', width: 6, height: '46%', borderRadius: 4, background: color.rimCoral, filter: 'blur(14px)', opacity: 0.5 })} />
      <div style={abs({ right: '-4%', top: '10%', width: '30%', height: '62%', borderRadius: 40, background: 'linear-gradient(180deg,#14233A,#0B1220)', filter: 'blur(30px)', opacity: 0.6 })} />
      <div style={abs({ right: '11%', top: '22%', width: 5, height: '38%', borderRadius: 4, background: '#5BE0FF', filter: 'blur(14px)', opacity: 0.42 })} />
      <div style={abs({ right: '16%', top: '14%', width: 150, height: 44, borderRadius: 12, background: color.yellow, filter: 'blur(36px)', opacity: 0.14 })} />
      <div style={{ ...fill, background: 'radial-gradient(ellipse at 50% 55%,transparent 30%,rgba(3,4,10,.55) 75%,#03040A 100%)' }} />
      {dust && (
        <div style={{ ...fill, overflow: 'hidden' }}>
          {MOTES.map((m, i) => <div key={i} className="ga-anim" style={abs({ left: m.l, top: m.t, width: m.s, height: m.s, borderRadius: '50%', background: 'rgba(255,240,200,.7)', animation: `gaDust ${m.d} linear ${m.dl} infinite` })} />)}
        </div>
      )}
    </div>
  );
}

/** The surface the cabinet stands on: a highlight line, a faint reflection, a soft shadow. */
export function Floor({ stageW, stageH }: { stageW: number; stageH: number }) {
  const centre: React.CSSProperties = { position: 'absolute', left: '50%', transform: 'translateX(-50%)' };
  return (
    <>
      <div aria-hidden style={{ ...centre, bottom: 0, width: Math.round(stageW * 1.5), height: 3, borderRadius: 2, background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent)' }} />
      <div aria-hidden style={{ ...centre, bottom: -2, width: Math.round(stageW * 1.5), height: Math.round(stageH * 0.1), background: 'linear-gradient(180deg,rgba(255,255,255,.07),transparent)', maskImage: 'linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)', WebkitMaskImage: 'linear-gradient(90deg,transparent,#000 20%,#000 80%,transparent)', borderRadius: '0 0 40px 40px' }} />
      <div aria-hidden style={{ ...centre, bottom: -6, width: Math.round(stageW * 0.9), height: 40, borderRadius: '50%', background: 'rgba(0,0,0,.75)', filter: 'blur(22px)' }} />
    </>
  );
}

/** Behind the screen: the shell's body, its sheen, the top label row, the bezel. */
export function CabinetBack() {
  return (
    <>
      <div aria-hidden style={{ ...fill, borderRadius: '44px 44px 52px 52px', background: `linear-gradient(160deg,${SHELL[0]} 0%,${SHELL[1]} 45%,${SHELL[2]} 100%)`, boxShadow: 'inset 0 3px 0 rgba(255,255,255,.35),inset 0 -6px 14px rgba(0,0,0,.45),inset 3px 0 6px rgba(255,255,255,.08),inset -3px 0 6px rgba(0,0,0,.25),0 40px 90px rgba(0,0,0,.7),0 0 0 2px rgba(0,0,0,.5)' }} />
      <div aria-hidden style={abs({ left: 0, right: 0, top: 0, height: '46%', borderRadius: '44px 44px 0 0', background: 'linear-gradient(180deg,rgba(255,255,255,.14),rgba(255,255,255,0))', pointerEvents: 'none', mixBlendMode: 'screen' })} />
      <div aria-hidden style={abs({ left: 24, right: 24, top: 22, height: 26, display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' })}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div className="ga-anim" style={{ width: 8, height: 8, borderRadius: '50%', background: color.mint, boxShadow: `0 0 10px ${color.mint},0 0 2px #fff`, animation: 'gaLed 3.2s ease-in-out infinite' }} />
          <div style={{ fontFamily: font.black, fontSize: 9, letterSpacing: 2.5, color: 'rgba(255,255,255,.55)' }}>POWER</div>
        </div>
        <BrandLockup variant="header" size={11} mark={16} />
        <div style={{ display: 'flex', gap: 3 }}><div style={{ width: 22, height: 3, borderRadius: 2, background: 'rgba(0,0,0,.45)' }} /><div style={{ width: 22, height: 3, borderRadius: 2, background: 'rgba(0,0,0,.45)' }} /></div>
      </div>
      <div aria-hidden style={abs({ left: 28, top: 60, width: 410, height: 864, borderRadius: 26, background: '#05070F', boxShadow: 'inset 0 0 0 4px #1A1F33,inset 0 6px 14px rgba(0,0,0,.9),0 1px 0 rgba(255,255,255,.18)', pointerEvents: 'none' })} />
    </>
  );
}

/** In front of the body, below the screen: speaker grille, the coin knob, the price sticker, the side buttons. */
export function CabinetFront() {
  return (
    <>
      <div aria-hidden style={abs({ left: 38, right: 38, bottom: 22, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'space-between', pointerEvents: 'none' })}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(8,5px)', gap: 5 }}>{Array.from({ length: 16 }, (_, i) => <div key={i} style={{ height: 5, borderRadius: '50%', background: 'rgba(0,0,0,.6)', boxShadow: 'inset 0 1px 1px #000' }} />)}</div>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'radial-gradient(circle at 40% 32%,#F4F6FB,#B4BACB 55%,#7C8399)', border: '3px solid #5B6275', boxShadow: '0 4px 8px rgba(0,0,0,.5)', position: 'relative' }}><div style={abs({ left: '50%', top: 6, bottom: 6, width: 6, marginLeft: -3, borderRadius: 3, background: 'linear-gradient(90deg,#4A5063,#8F97B0 50%,#4A5063)' })} /></div>
        <div style={{ width: 52, height: 20, borderRadius: 5, transform: 'rotate(-6deg)', background: color.yellow, boxShadow: '0 2px 4px rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: font.black, fontSize: 8, letterSpacing: 1, color: '#1F2D4D' }}>$1 · PULL</div>
      </div>
      <div aria-hidden style={abs({ right: -6, top: 180, width: 8, height: 70, borderRadius: '0 5px 5px 0', background: `linear-gradient(90deg,${SHELL[1]},${SHELL[2]})`, boxShadow: 'inset -1px 0 2px rgba(0,0,0,.5)' })} />
      <div aria-hidden style={abs({ left: -6, top: 200, width: 8, height: 44, borderRadius: '5px 0 0 5px', background: `linear-gradient(270deg,${SHELL[1]},${SHELL[2]})`, boxShadow: 'inset 1px 0 2px rgba(0,0,0,.5)' })} />
    </>
  );
}

// Soft-launch landing (Ben, 1 Oct 2026; #398, Option A). No free-pull promo and no dupes wording. The dots stay;
// the W1.1 leads ("Real cards.", "Real vault.", "A machine, not a shopping trip.") do not.
export const VALUE_PROPS: readonly { dot: string; text: string }[] = [
  { dot: color.mint, text: '$1 pulls of real cards into albums built to complete \u2014 not just hunt the expensive hit.' },
  { dot: '#5BB8FF', text: 'Finish an album \u2192 Claim pack: free Jupiter Degen pack credit (open on Jupiter).' },
  { dot: color.yellow, text: 'Paid pulls stamp the seasonal raffle; keep your streak for extra tickets.' },
];

export function Copy({ where }: { where: 'below' | 'right' }) {
  const right = where === 'right';
  const words = (
    <>
      <div>
        <BrandLockup variant="header" mark={22} />
        <h1 style={{ fontFamily: font.black, fontWeight: 'normal', fontSize: 'clamp(22px,1.9vw,30px)', lineHeight: 1.2, margin: '8px 0 0', letterSpacing: -0.3, color: color.text, textWrap: 'pretty' }}>{SITE_DESCRIPTION}</h1>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontFamily: font.semibold, fontSize: 14.5, color: color.text2, lineHeight: 1.5 }}>
        {VALUE_PROPS.map((p) => (
          <div key={p.text} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
            <span style={{ flex: 'none', width: 8, height: 8, borderRadius: '50%', background: p.dot, marginTop: 7 }} />
            <span>{p.text}</span>
          </div>
        ))}
      </div>
    </>
  );
  // Under the cabinet (laptop) the copy has 250 px of height. The canvas stacks it there as on the desktop, and its own QR card
  // falls out of the bottom of that box (it scrolls): a QR nobody can see cannot be scanned. So on this tier the words and the
  // card sit side by side, which fits (W1.4).
  if (!right) {
    return (
      <div data-testid="shell-copy" style={{ maxWidth: 900, width: '100%', display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 32, gridColumn: 1, gridRow: 2, textAlign: 'left', alignSelf: 'center', minHeight: 0, maxHeight: '100%', overflow: 'auto' }}>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>{words}</div>
        <div style={{ flex: 'none', width: 340 }}><PhoneCard /></div>
      </div>
    );
  }
  return (
    <div data-testid="shell-copy" style={{ maxWidth: 400, width: '100%', display: 'flex', flexDirection: 'column', gap: 22, gridColumn: 3, gridRow: 1, textAlign: 'left', alignSelf: 'center', minHeight: 0, maxHeight: '100%' }}>
      {words}
      <PhoneCard />
    </div>
  );
}

/** What the keyboard does (W1.2), on the tiers that have one to hand (desktop, laptop). It stands out until the first key is
 *  used and recedes after. Decorative: the keys work without it, and a screen reader gets the controls themselves. */
export function KeyHints() {
  const used = useKeyUsed();
  const kbd: React.CSSProperties = { font: 'inherit', fontSize: 10, padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(255,255,255,.22)', background: 'rgba(255,255,255,.06)', color: '#C7D4F2' };
  const item: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
  return (
    <div aria-hidden data-testid="shell-keys" className="ga-anim" style={abs({ left: 0, right: 0, bottom: FOOTER_H, display: 'flex', justifyContent: 'center', gap: 18, pointerEvents: 'none', fontFamily: font.bold, fontSize: 11, color: color.text3, opacity: used ? 0.35 : 0.8, transition: 'opacity .5s' })}>
      <span style={item}><kbd style={kbd}>space</kbd> crank</span>
      <span style={item}><kbd style={kbd}>←</kbd><kbd style={kbd}>→</kbd> pages</span>
      <span style={item}><kbd style={kbd}>esc</kbd> close</span>
    </div>
  );
}

/** Terms and Privacy open the interim drafts (#354). Shipping and Contact are off this strip for soft launch.
 *  Odds is not in this strip (#332). */
export const FOOTER_ITEMS = [
  { name: 'Terms', href: TERMS_URL },
  { name: 'Privacy', href: PRIVACY_URL },
] as const;

/** The strip along the bottom (W1.5, #127). The Odds link is gone for v0 (#332): there is no sleeve to open. */
export function Footer() {
  const item: React.CSSProperties = { font: 'inherit', color: color.text2, background: 'none', border: 0, padding: 0, margin: 0, textDecoration: 'none' };
  return (
    <div data-testid="shell-footer" style={abs({ left: 0, right: 0, bottom: 0, height: FOOTER_H, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, padding: '0 24px', boxSizing: 'border-box', fontFamily: font.bold, fontSize: 12, color: color.text3, background: 'linear-gradient(180deg,transparent,rgba(3,4,10,.8))', pointerEvents: 'none' })}>
      <div style={{ display: 'flex', gap: 16, flexShrink: 0, whiteSpace: 'nowrap', alignItems: 'center', pointerEvents: 'auto' }}>
        {FOOTER_ITEMS.map((entry) => <a key={entry.name} href={entry.href} target="_blank" rel="noopener noreferrer" style={item}>{entry.name}</a>)}
      </div>
      <div style={{ minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>Collectibles marketplace, not a casino. © 2026 {PRODUCT_NAME}</div>
    </div>
  );
}
