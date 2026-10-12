// One active tab (W0.2b, #136), at the home route: a tab that is not the active one renders no machine at all, so it can start
// no pull; taking over hands it what the other tab kept. Native never leaves "active" (state/activeTab.ts); the role is driven
// here as the web file would drive it.
import { afterEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import Home from '@/screens/Home';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { SessionProvider, useSession } from '@/state/session';
import { useActiveTab, type TabRole } from '@/state/activeTab';
import { keepPending, writePendingPulls, type PendingPull } from '@/state/pendingPulls';
import { signInFromFirstScreen } from '@/test/signIn';

jest.mock('@/state/activeTab', () => ({ useActiveTab: jest.fn() }));
const takeOver = jest.fn();
const role = (r: TabRole) => jest.mocked(useActiveTab).mockReturnValue({ role: r, takeOver });

const live: { session: ReturnType<typeof useSession> | null; stage: string } = { session: null, stage: 'idle' };
function Probe() { const session = useSession(); const auth = useAuth(); React.useEffect(() => { live.session = session; live.stage = auth.stage; }); return null; }
const app = () => <SafeAreaProvider><AuthProvider><SessionProvider><Probe /><Home /></SessionProvider></AuthProvider></SafeAreaProvider>;
async function signedIn(r: TabRole) {
  mock!.dev.reset(); writePendingPulls([]); takeOver.mockClear(); role(r);
  const ui = await render(app());
  await signInFromFirstScreen();
  return ui;
}
afterEach(() => { jest.restoreAllMocks(); });

test('a tab that is not the active one shows the card and no machine: nothing in it can prepare a pull', async () => {
  const prepare = jest.spyOn(api, 'preparePull');
  await signedIn('other');
  expect(await screen.findByText('Gotchapon is open in another tab', {}, { timeout: 6000 })).toBeTruthy();
  expect(screen.queryByText('TOP UP · $1 A TURN')).toBeNull();
  expect(screen.queryByLabelText('Pull page, current')).toBeNull();
  expect(screen.queryByText(/turn the crank/i)).toBeNull();
  await fireEvent.press(screen.getByText('Use it here'));
  expect(takeOver).toHaveBeenCalledTimes(1);
  expect(prepare).not.toHaveBeenCalled();
}, 15000);

test('while it is still asking whether another tab is active, it shows nothing to crank either', async () => {
  await signedIn('deciding');
  await waitFor(() => expect(live.stage).toBe('onboarding'), { timeout: 6000 }); // past sign-in: from here the app would be on screen
  expect(screen.queryByText('Pull your first card')).toBeNull(); // the first screen is behind us (#211)
  expect(screen.queryByText('TOP UP · $1 A TURN')).toBeNull();
  expect(screen.queryByText('Real trading cards')).toBeNull();
  expect(screen.queryByText('Gotchapon is open in another tab')).toBeNull();
}, 15000);

test('taking over: the machine appears, and a pull the other tab sealed is now this tab\'s to open', async () => {
  const ui = await signedIn('other');
  await screen.findByText('Gotchapon is open in another tab', {}, { timeout: 6000 });
  const sealedElsewhere: PendingPull = { kind: 'pull', userId: 'me', prepared: { pullId: 'pull_other_tab', costUsd: 1, useFreePulls: 0, expiresAt: '2026-09-18T00:00:00Z' }, txSignature: 'mock:pull_other_tab' };
  keepPending(sealedElsewhere); // the other tab wrote this to the shared store after this one had read it
  expect(live.session!.pendingPulls).toEqual([]);
  role('active');
  await act(async () => { await ui.rerender(app()); });
  await waitFor(() => expect(live.session!.pendingPulls).toEqual([sealedElsewhere]));
  expect(screen.queryByText('Gotchapon is open in another tab')).toBeNull();
  writePendingPulls([]);
}, 20000);
