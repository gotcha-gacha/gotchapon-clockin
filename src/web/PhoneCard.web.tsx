// "Get it on your phone" (W1.4, #126): a QR of the page the visitor is on, so the phone opens exactly this, query and all
// (`?ref` means nothing until the referral system ships, post-launch, but it rides along today). The store rows say "soon":
// the web may go live before the stores do (plan §7.15), and there is nothing to install yet, so the card says "open", not
// "install". The pack's "3 free pulls waiting" is gone (#385). The scan line is Option A (#398): play on your phone,
// stores soon. No free-pull promo. Web only: nothing but Shell.web.tsx imports it.
import React, { useEffect, useState } from 'react';
import QRCode from 'react-native-qrcode-svg';
import { useGlobalSearchParams, usePathname } from 'expo-router';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { useNotFoundShown } from '@/navigation/notFoundShown';
import { captureOAuthHandoff } from '@/auth/oauthHandoff';
import { hrefWithoutOAuthParams } from '@/auth/oauthParams';

const read = () => {
  if (typeof window === 'undefined') return '';
  // Idempotent once a handoff is stashed, so the URL put back for Privy is not stripped out from under the SDK.
  // The value itself is still filtered: a one-frame flash of the code never becomes a QR.
  captureOAuthHandoff();
  return hrefWithoutOAuthParams(window.location.href);
};

/** The address in the address bar, kept in step with it (#169). The router re-renders on a change of its own state, and writes
 *  the address afterwards: its linking queues every history write in a promise series, so a `setParams` / `push` lands a
 *  microtask or more after the render, and a closing sheet's `back()` waits on `history.go`, whose popstate comes later still,
 *  with any write queued meanwhile landing in a microtask right after that popstate (PR #179's review: Account → Odds
 *  disclosure from Wallet, then ✕, writes `/wallet` then `/pull` after the popstate). Read during the render, the QR trailed
 *  the bar by one change on every page, sheet and binder (measured on main, 19 Sept: `/` while the bar said `/odds`). So: re-read
 *  one macrotask after each router change, and on popstate both at once and one macrotask later. That holds whenever a `back()`
 *  settles on its popstate, which every run in Chromium and WebKit did, even at 80× CPU throttling. A popstate later than the
 *  router's own 100 ms wait is not covered: the QR lags until the popstate comes (seen only with the popstate forced late, PR
 *  #179's second review; the router itself then rebuilds the app, before this change too). On the not-found page (which says
 *  so, notFoundShown.ts) the phone gets the machine. */
export function useCurrentUrl(): string {
  const pathname = usePathname();
  const params = useGlobalSearchParams();
  const notFound = useNotFoundShown();
  const [href, setHref] = useState(read);
  useEffect(() => {
    const t = setTimeout(() => setHref(read()), 0);
    return () => clearTimeout(t);
  }, [pathname, params]);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const onPop = () => { setHref(read()); clearTimeout(t); t = setTimeout(() => setHref(read()), 0); };
    window.addEventListener('popstate', onPop);
    return () => { window.removeEventListener('popstate', onPop); clearTimeout(t); };
  }, []);
  if (!href) return '';
  return notFound ? `${new URL(href).origin}/` : href;
}

/** The canvas's 84 px light box. A camera needs a quiet zone of 4 modules around the code (ISO 18004), and a module is widest
 *  in the smallest code (21 across): 12 px round a 60 px code is 4.2 of them there, and more in every larger code. At the
 *  first cut's 72 + 6 it was 2.4 for a short address (PR #159's review measured it): fine for a decoder fed clean pixels, not
 *  promised for a camera. */
export const QR = { box: 84, size: 60, pad: 12 } as const;

export function PhoneCard() {
  const url = useCurrentUrl();
  const row: React.CSSProperties = { padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,.2)', fontFamily: font.extrabold, fontSize: 11, color: color.text2 };
  return (
    <div data-testid="phone-card" style={{ display: 'flex', gap: 14, alignItems: 'center', padding: 14, borderRadius: 18, background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.12)', justifyContent: 'flex-start' }}>
      <div role="img" aria-label={`QR code: this page's address, ${url}`} style={{ width: QR.box, height: QR.box, flex: 'none', borderRadius: 10, background: '#F4F6FB', padding: QR.pad, boxSizing: 'border-box' }}>
        {url ? <QRCode value={url} size={QR.size} backgroundColor="#F4F6FB" color="#1F2D4D" /> : null}
      </div>
      <div style={{ minWidth: 0, textAlign: 'left' }}>
        <div style={{ fontFamily: font.black, fontSize: 15, color: color.text }}>Get it on your phone</div>
        <div style={{ fontFamily: font.semibold, fontSize: 12.5, color: color.text2, margin: '3px 0 8px' }}>Scan to play on your phone. · App Store & Google Play · soon</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <div style={row} aria-disabled>App Store · soon</div>
          <div style={row} aria-disabled>Google Play · soon</div>
        </div>
      </div>
    </div>
  );
}
