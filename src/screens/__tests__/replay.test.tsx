// A paid commit that lands on the server but whose client never hears back (review of PR #66, round 2), against the in-app mock.
// After Later the machine must show the server's balance and free pulls, so the next crank costs what the hint says; opening
// the kept pull then gets the server's replay of the first response, which must neither roll the balance back nor toast a
// deposit. Its own file: it fails commits and holdings reads.
import { afterEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ApiError } from '@/api/errors';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}
const renderApp = () => render(
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider initialPage={PAGE.pull}>
        <RitualProvider><Probe /><PullPage /></RitualProvider>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>,
);

/** What the client shows, and what the mock server holds. */
afterEach(() => { jest.restoreAllMocks(); });

const shown = () => ({ balanceUsd: probe.session!.balanceUsd, freePulls: probe.session!.freePulls });
const held = () => { const s = mock!.dev.state(); return { balanceUsd: s.balanceUsd, freePulls: s.freePulls }; };

async function crank(multi: 1 | 5, until: 'rolling' | 'capsule') {
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe(until));
}

/** The pull was left mid-roll (the app went away while polling). Pull once more, then open it. */
async function leavePullAgainAndOpen() {
  await waitFor(() => expect(shown()).toEqual(held()));
  expect(screen.queryByText('Free pull — turn the crank')).toBeNull();
  expect(screen.getByText("Turn the crank — that's the $1")).toBeTruthy();
  const before = held().balanceUsd;
  await crank(1, 'capsule');
  expect(probe.ritual!.ritual.prepared).toMatchObject({ costUsd: 1, useFreePulls: 0 }); // what the hint said
  // The waiting banner stays up while this pull runs, so the machine never shifts under a hand on the crank; Open it waits.
  expect(screen.getByText('A capsule is waiting to open — nothing is lost.')).toBeTruthy();
  expect(screen.getByLabelText('Open it').props.accessibilityState?.disabled).toBe(true);
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  expect(held().balanceUsd).toBe(before - 1);
  await waitFor(() => expect(shown()).toEqual(held()));
  // Open it: the server replays the first response, whose balance predates that $1 pull. Its extras read fails once, which must
  // not seal the pull again.
  jest.spyOn(api, 'extras').mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'extras read failed' }));
  const credit = probe.session!.credit;
  await fireEvent.press(await screen.findByText('Open it'));
  await waitFor(() => expect(['capsule', 'batchcaps']).toContain(probe.ritual!.ritual.phase));
  expect(shown()).toEqual(held());
  expect(probe.session!.credit).toBe(credit); // no deposit toast
}

test('a ×5 whose response is lost: the free pulls it used are gone from the machine, and opening it later changes nothing it should not', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier('common');
  const { unmount } = await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  expect(held().freePulls).toBe(3); // credited free pulls: a ×5 uses all three plus $2
  const real = api.commitPull.bind(api);
  let attempts = 0;
  jest.spyOn(api, 'commitPull').mockImplementation(async (req) => {
    attempts += 1;
    if (attempts === 1) { await real(req); throw new ApiError({ code: 'NETWORK', message: 'response lost' }); }
    if (attempts === 2) return new Promise(() => {});
    return real(req);
  });
  await crank(5, 'rolling');
  expect(screen.queryByText(/waiting to open/)).toBeNull(); // the pull in flight is not also in the banner
  await waitFor(() => expect(attempts).toBe(2));
  await unmount();
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await leavePullAgainAndOpen();
}, 30_000);

test('a commit that lands but whose holdings read fails is retried and still dispenses', async () => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await waitFor(() => expect(shown()).toEqual(held()));
  jest.spyOn(api, 'holdings').mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'holdings read failed' }));
  const credit = probe.session!.credit;
  await crank(1, 'capsule');
  expect(shown()).toEqual(held());
  expect(probe.session!.credit).toBe(credit);
}, 30_000);

test('after a relaunch, opening a pull kept from before still reads the cost fresh', async () => {
  const { unmount } = await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await waitFor(() => expect(shown()).toEqual(held()));
  const real = api.commitPull.bind(api);
  let attempts = 0;
  jest.spyOn(api, 'commitPull').mockImplementation(async (req) => {
    attempts += 1;
    if (attempts === 1) { await real(req); throw new ApiError({ code: 'NETWORK', message: 'response lost' }); }
    if (attempts === 2) return new Promise(() => {});
    return real(req);
  });
  await crank(1, 'rolling');
  await waitFor(() => expect(attempts).toBe(2));
  await unmount(); // a relaunch: the kept pull comes back from disk
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await waitFor(() => expect(shown()).toEqual(held()));
  await crank(1, 'capsule'); // the kept pull's first response now predates this $1
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await unmount(); // a relaunch: the kept pull comes back from disk
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await waitFor(() => expect(shown()).toEqual(held()));
  const credit = probe.session!.credit;
  await fireEvent.press(await screen.findByText('Open it'));
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(shown()).toEqual(held());
  expect(probe.session!.credit).toBe(credit); // no deposit toast
}, 30_000);
