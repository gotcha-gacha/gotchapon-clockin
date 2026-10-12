// Home: one frame, the three-page track (Albums · Pull · Wallet), the header overlay and the persistent swipe rail.
// The odds sleeve is hidden for v0 (#332): paid draws are album cards only, so Pull has no Odds entry and no sleeve.
// A closed country (F5.3) gets the geo-block screen instead, once signed in: the server's GEO_BLOCKED on a read, or /me naming a closed country.
import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { HomePager } from '@/components/HomePager';
import { HeaderOverlay } from '@/components/HeaderOverlay';
import { AccountSheet } from '@/components/AccountSheet';
import { PageDots } from '@/components/PageDots';
import { OtherTabCard } from '@/components/OtherTabCard';
import { LANDING_PAGE, useSession } from '@/state/session';
import { useActiveTab } from '@/state/activeTab';
import { useAuth } from '@/auth/AuthProvider';
import { FirstScreen } from '@/screens/FirstScreen';
import { GeoBlockScreen } from '@/screens/GeoBlockScreen';
import { geoBlocked } from '@/config/geo';
import { Onboarding } from '@/screens/Onboarding';
import { PullHydration, useHydrationFrost } from '@/screens/PullHydration';
import { color, radius } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { errorCopy } from '@/api/errors';
import { useUrlState } from '@/navigation/useUrlState';
import { useHardwareBack } from '@/navigation/useHardwareBack';
import { DocTitle } from '@/web/DocHead';
import { pageTitle } from '@/navigation/appPaths';
import { appGateOf, setAppGate } from '@/navigation/appGate';
import { useInert } from '@/components/webFocus';

export default function Home() {
  const { error, ready, refresh, me, reloadKept, closeAlbum, page, setPage, albumOpen, albums, balanceKnown } = useSession();
  const auth = useAuth();
  const [accountOpen, setAccountOpen] = useState(false);
  useUrlState(); // the web: the address follows the page and the open binder, and is read once at boot (W2.1)
  // One active tab (web; native is always the active one and never changes role): a tab that becomes active takes over what
  // another tab kept, and a tab that is not active renders no machine at all, so it can start no pull.
  const tab = useActiveTab();
  const wasRole = useRef(tab.role);
  useEffect(() => {
    if (tab.role === 'active' && wasRole.current !== 'active') reloadKept();
    wasRole.current = tab.role;
  }, [tab.role, reloadKept]);
  // What this screen draws, published for the sheet routes that sit over it (appGate.ts): a sheet shows only while the app
  // does. The same four checks as the returns below, in the same order.
  const blocked = ready && geoBlocked(me?.country, error?.code);
  const gate = appGateOf({ authStage: auth.stage, tabRole: tab.role, blocked });
  useEffect(() => { setAppGate(gate); }, [gate]);
  useEffect(() => () => setAppGate('wait'), []);
  // The open binder lives in the session now (W2.1, so the address can see it), and the session outlives a sign-out: close
  // it then, as unmounting the Albums page used to (PR #165's review), and put the track back on the landing page, so the
  // next sign-in lands on the Binder wherever this one signed out (#210).
  //
  // **A sign-out is LEAVING a signed-in stage, not "the stage is idle".** A sign-in that fails lands on idle too (`signIn`
  // never parks the user on the busy card), and resetting there threw away an address nobody had signed in to yet: the web
  // reads the address at boot, which is not gated on auth, so a cold `/wallet` whose first attempt failed came back — after
  // a successful retry — on `/binder`, with `booted` latched and nothing left to restore it (found in review).
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (wasSignedIn.current && auth.stage === 'idle') { closeAlbum(); setPage(LANDING_PAGE); }
    wasSignedIn.current = auth.stage === 'done' || auth.stage === 'onboarding';
  }, [auth.stage, closeAlbum, setPage]);
  // The onboarding sheet is drawn over the app, not in a Modal: the app under it must not take keys or focus (W1.6).
  const underOnboarding = useInert(auth.stage === 'onboarding');
  // The hydration frost covers this tree. Keys must not reach the crank, the rail or the header until the balance is real.
  // The blur is on this same view: it contains the header, the pages and the rail, so the rail cannot paint sharp
  // over a veil. The dim itself is the sibling PullHydration, which stays out of the blur.
  const underHydration = useInert(!balanceKnown);
  useHydrationFrost(!balanceKnown, underHydration);
  // Android's Back steps out of a binder, then back to Pull, then leaves (useHardwareBack.ts). Only while the pages are what is
  // drawn, past onboarding (`show`: the checks the returns below make). A sheet is a Modal and takes its own Back.
  useHardwareBack({ enabled: auth.ready && gate === 'show', page, albumOpen, closeAlbum, setPage });
  // A cold start with a Privy session still restoring shows nothing rather than the first screen, which would otherwise
  // flash and be replaced a moment later by the binder. Bounded by the provider's own 8 s cap, and always true on the mock.
  if (!auth.ready) return <View style={s.frame} />;
  if (auth.stage === 'idle' || auth.stage === 'busy') return <FirstScreen />;
  if (tab.role === 'other') return <OtherTabCard onUseHere={tab.takeOver} />;
  if (tab.role === 'deciding') return <View style={s.frame} />;
  if (blocked) return <GeoBlockScreen country={me?.country} />;
  return (
    <View style={s.frame}>
      {/* Header, page, rail: the order they are seen in is the order Tab (and a screen reader) walks them. The header and the
          rail carry their own zIndex, so what is painted over what does not change. */}
      {/* The tab's title (W2.2, web only): the page, or the open binder's album. */}
      <DocTitle title={pageTitle({ signedIn: auth.stage === 'done', page, albumTitle: albumOpen ? albums.find((a) => a.id === albumOpen)?.title : null /* pageTitle uses it on the Albums page only */ })} />
      <View ref={underOnboarding} style={s.app}>
        <View ref={underHydration} style={[s.fill, { pointerEvents: balanceKnown ? 'auto' : 'none' }]}>
          <HeaderOverlay onOpenSettings={() => setAccountOpen(true)} />
          <HomePager />
          <PageDots />
        </View>
        {/* Full app frame: header, daily pill, pages, rail. Onboarding (z 12) and the error card (z 20) stay above it. */}
        <PullHydration hydrating={!balanceKnown} />
      </View>
      {auth.stage === 'onboarding' ? <Onboarding /> : null}
      {accountOpen ? <AccountSheet onClose={() => setAccountOpen(false)} /> : null}
      {ready && error ? (
        <View style={s.errorCard} accessibilityRole="alert">
          <Text style={s.errorTitle}>{errorCopy[error.code].title}</Text>
          <Text style={s.errorBody}>{errorCopy[error.code].body}</Text>
          <Pressable onPress={() => { void refresh(); }} style={s.errorBtn} accessibilityRole="button"><Text style={s.errorBtnText}>Retry</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  frame: { flex: 1, backgroundColor: color.room },
  app: { flex: 1, position: 'relative' },
  // The room color lives on the blurred frame, so the field around the machine frosts with the chrome.
  fill: { flex: 1, backgroundColor: color.room },
  errorCard: { position: 'absolute', left: 16, right: 16, top: '40%', backgroundColor: color.glassBg, borderWidth: 1, borderColor: color.glassBorder, borderRadius: radius.cardLg, padding: 18, alignItems: 'center', gap: 6, zIndex: 20 },
  errorTitle: { fontFamily: font.black, fontSize: 16, color: color.text },
  errorBody: { fontFamily: font.semibold, fontSize: 13, color: color.text2, textAlign: 'center', lineHeight: 18 },
  errorBtn: { marginTop: 8, borderRadius: radius.button, paddingVertical: 10, paddingHorizontal: 22, backgroundColor: color.yellow },
  errorBtnText: { fontFamily: font.extrabold, fontSize: 14, color: color.inkOnYellow },
});
