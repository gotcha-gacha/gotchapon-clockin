import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SessionProvider } from '@/state/session';
import { AuthProvider } from '@/auth/AuthProvider';
import { SoundHost } from '@/audio/SoundHost';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { useAppFonts } from '@/theme/fonts';
import { color } from '@/theme/tokens';
import { usingMock } from '@/api';
import { Shell } from '@/web/Shell';
import { SiteHead } from '@/web/DocHead';
import { installAnalytics } from '@/analytics/posthog';

SplashScreen.preventAutoHideAsync().catch(() => {});

// W2.1 (#128): the app is the anchor. A cold load of a sheet route (`/card/:id`, `/odds`) renders the app beneath it, so
// closing the sheet (Back, esc, ✕) lands on the app and not on an empty stack.
export const unstable_settings = { anchor: '[...path]' };

export default function RootLayout() {
  const [fontsLoaded, fontError] = useAppFonts();
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  // PostHog (#143), when a project key is in the environment; the seam buffers everything that happens before it is in.
  useEffect(() => { installAnalytics(); }, []);

  // A page running the in-app mock says so on its root element, before anyone signs in: the demo pill only exists past
  // sign-in, and the deploy probe (scripts/web-probe.mjs) cannot sign in to a production site to look for it. Web only:
  // there is no document on a phone.
  useEffect(() => {
    if (usingMock && typeof document !== 'undefined') document.documentElement.setAttribute('data-demo', '1');
  }, []);

  // The shell is drawn at once (on the web: the room and a dark cabinet; on a phone it is nothing) and the app mounts inside
  // it when the fonts are in, once: the shell's own tree never changes shape around it.
  return (
    <Shell ready={ready}>
      {/* Outside the fonts gate, so it is in every prerendered page (W2.2): title, description, Open Graph. */}
      <SiteHead />
      {ready ? <App /> : null}
    </Shell>
  );
}

function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: color.room }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SessionProvider>
            <SoundHost>
              <StatusBar style="light" />
              {/* Inside the providers: a screen that throws is replaced by the card, while the session (and the kept pulls it holds) lives on. */}
              <ErrorBoundary>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.room } }}>
                  {/* The sheets Back should close, as routes over the app (W2.1, plan §4.4): transparent, no screen animation of
                      their own (each carries its own <Modal>, which animates and takes `esc`). */}
                  <Stack.Screen name="odds" options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
                  <Stack.Screen name="card/[cardId]" options={{ presentation: 'transparentModal', animation: 'none', contentStyle: { backgroundColor: 'transparent' } }} />
                </Stack>
              </ErrorBoundary>
            </SoundHost>
          </SessionProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
