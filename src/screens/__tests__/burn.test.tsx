// Burn ready (F4.1, #294) against the in-app mock: five extras turn the Extras card mint. The hand-off spends them
// into one free pull and awards no card. The machine's free count rises when that credit lands. Its own file: it
// narrows mock stock and forces the tier.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { EXTRAS_UNAVAILABLE } from '@/components/albums/ExtrasCard';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { PullPage } from '@/screens/PullPage';
import { readPendingPulls } from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

// The machine's capsule globe runs a Reanimated frame callback, and the mocked frame loop under jest's fake timers fails to
// unregister it ("Cannot set properties of undefined (setting 'startTime')"). The globe is not what this test is about: its
// loop is stubbed, as in reducedMotion.test.tsx, so the burn's own timeline can run on jest's clock. The Pull page's endless
// `withRepeat(…, -1)` motion plays each loop once, for the same reason as in firstScreen.test.tsx: nothing here asserts on it,
// and driving it frame by frame on fake timers took the test past its timeout on a loaded machine (3.0 s → 1.3 s alone).
jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useFrameCallback: jest.fn(() => ({ setActive: () => {}, isActive: false, callbackId: 0 })), withRepeat: (animation: unknown) => animation };
});

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };

/** Ten commons of one card: one new, nine extras. */
function TenOfOneCard() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  const done = useRef(false);
  useEffect(() => {
    if (!session.ready || done.current) return;
    done.current = true;
    void (async () => {
      await session.devDeposit?.(10);
      const p = await session.preparePull({ count: 10, targeted: false });
      const txSignature = p.transfer ? await session.signTransfer(p) : undefined;
      session.revealed((await session.commitPull({ pullId: p.pullId, txSignature })).outcomes);
    })();
  }, [session]);
  return null;
}

test('five extras make the card ready; the hand-off credits one free pull and awards no card', async () => {
  // The hand-off is a real-time timeline (BURN_TIMELINE: 'gather' for 1,150 ms, 'flash' at 2,950 ms). On real timers the
  // 'gather' check below raced it: a runner that stalled past 1,150 ms after the press read 'ignite' (CI, PR #290's run;
  // reproduced with a 1.2 s stall). The whole test runs on jest's clock, so each step is where the test puts it. (Switching
  // clocks mid-test is not an option: Reanimated's frame callbacks registered on one clock fail to unregister on the other.)
  jest.useFakeTimers();
  try {
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 10);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><TenOfOneCard /><AlbumsPage /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  expect(await screen.findByText('Extras · 9')).toBeTruthy();
  expect(screen.getByText('Burn 5 for a free pull — ready')).toBeTruthy();
    await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
    // The hand-off has started and the burn has not been sent, but the card must not still read as a live offer.
    expect(screen.queryByText('Burn 5 for a free pull — ready')).toBeNull();
    expect(screen.getByText('Unavailable until this pull is in your binder')).toBeTruthy();
    // The hand-off plays first (F4.2) and the crank is locked: turning it now must not start a paid pull.
    expect(probe.ritual!.ritual).toMatchObject({ phase: 'burning', burnStep: 'gather', source: 'burn', multi: 1 });
    const balance = mock!.dev.state().balanceUsd;
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    expect(probe.ritual!.ritual.phase).toBe('burning');
    await act(async () => { await jest.advanceTimersByTimeAsync(1_149); });
    expect(probe.ritual!.ritual).toMatchObject({ phase: 'burning', burnStep: 'gather' }); // the step's whole length, not an instant
    await act(async () => { await jest.advanceTimersByTimeAsync(2_950 - 1_149); });
    // The last step sends the burn. The answer is still the mock's 120 ms out, and no capsule is on stage.
    expect(probe.ritual!.ritual).toMatchObject({ phase: 'committing', source: 'burn', burnStep: 'flash' });
    expect(screen.queryByText('Rub the capsule.')).toBeNull();
    expect(screen.queryByText('1 free pull left')).toBeNull();
    expect(mock!.dev.state().balanceUsd).toBe(balance);
    expect(probe.session!.page).toBe(1);
    expect(mock!.dev.state().extras).toBe(9);
    const freeBefore = probe.session!.freePulls;
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
    expect(probe.ritual!.ritual.outcomes).toEqual([]);
    expect(mock!.dev.state().extras).toBe(4); // five spent, and the burn draws no card
    expect(mock!.dev.state().freePulls).toBe(freeBefore + 1);
    expect(probe.session!.freePulls).toBe(freeBefore + 1);
    expect(screen.getByText('1 free pull left')).toBeTruthy();
    expect(screen.getByTestId('pulls-count').props.children).toBe(freeBefore + 1);
    expect(screen.queryByText('Rub the capsule.')).toBeNull();
    expect(probe.session!.extras).toBe(4);
    expect(screen.getByText('Extras · 4')).toBeTruthy();
    expect(screen.queryByText('Extras · 9')).toBeNull();
    expect(screen.queryByText('Burn 5 for a free pull — ready')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
}, 20_000);

/** Enough copies that five can burn and five still remain: the button has to be a live offer again, not stuck unavailable. */
function stockOneCard(copies: number) {
  mock!.dev.reset();
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, copies);
}

/** Two ×10 of the stocked card, revealed: 19 extras. The pulls start from an effect so jest's fake clock can run them, the same way `TenOfOneCard` does. */
function NineteenExtras() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  const done = useRef(false);
  useEffect(() => {
    if (!session.ready || done.current) return;
    done.current = true;
    void (async () => {
      await session.devDeposit?.(20);
      for (let i = 0; i < 2; i++) {
        const p = await session.preparePull({ count: 10, targeted: false });
        const txSignature = p.transfer ? await session.signTransfer(p) : undefined;
        session.revealed((await session.commitPull({ pullId: p.pullId, txSignature })).outcomes);
      }
    })();
  }, [session]);
  return null;
}

test('a burn that leaves five or more extras shows the new count and the free pull, and Burn is offered again', async () => {
  jest.useFakeTimers();
  try {
    stockOneCard(20);
    await render(
      <SafeAreaProvider>
        <AuthProvider>
          <SessionProvider initialPage={PAGE.pull}>
            <RitualProvider><NineteenExtras /><AlbumsPage /><PullPage /></RitualProvider>
          </SessionProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText('Extras · 19')).toBeTruthy();
    const freeBefore = probe.session!.freePulls;
    await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
    await act(async () => { await jest.advanceTimersByTimeAsync(2_950); });
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
    expect(probe.session!.extras).toBe(14);
    expect(screen.getByText('Extras · 14')).toBeTruthy();
    expect(screen.queryByText('Extras · 19')).toBeNull();
    expect(probe.session!.freePulls).toBe(freeBefore + 1);
    expect(screen.getByText('1 free pull left')).toBeTruthy();
    expect(screen.getByTestId('pulls-count').props.children).toBe(freeBefore + 1);
    expect(screen.getByText('Burn 5 for a free pull — ready')).toBeTruthy();
    expect(screen.queryByText(EXTRAS_UNAVAILABLE)).toBeNull();
    expect(screen.getByLabelText('Burn 5 extras for a free pull').props.accessibilityState).toMatchObject({ disabled: false });
    expect(readPendingPulls()).toEqual([]);
  } finally {
    jest.useRealTimers();
  }
}, 20_000);

test('a holdings read that fails after the burn lands still shows the credit and leaves Burn available', async () => {
  jest.useFakeTimers();
  const holdings = jest.spyOn(api, 'holdings');
  try {
    stockOneCard(20);
    await render(
      <SafeAreaProvider>
        <AuthProvider>
          <SessionProvider initialPage={PAGE.pull}>
            <RitualProvider><NineteenExtras /><AlbumsPage /><PullPage /></RitualProvider>
          </SessionProvider>
        </AuthProvider>
      </SafeAreaProvider>,
    );
    expect(await screen.findByText('Extras · 19')).toBeTruthy();
    holdings.mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'inventory unread' }));
    const freeBefore = probe.session!.freePulls;
    await fireEvent.press(screen.getByLabelText('Burn 5 extras for a free pull'));
    await act(async () => { await jest.advanceTimersByTimeAsync(2_950); });
    await act(async () => { await jest.advanceTimersByTimeAsync(120); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
    expect(probe.ritual!.ritual.phase).not.toBe('sealed');
    expect(probe.session!.extras).toBe(14);
    expect(screen.getByText('Extras · 14')).toBeTruthy();
    expect(probe.session!.freePulls).toBe(freeBefore + 1);
    expect(screen.getByTestId('pulls-count').props.children).toBe(freeBefore + 1);
    expect(screen.getByText('Burn 5 for a free pull — ready')).toBeTruthy();
    expect(screen.queryByText(EXTRAS_UNAVAILABLE)).toBeNull();
    expect(screen.getByLabelText('Burn 5 extras for a free pull').props.accessibilityState).toMatchObject({ disabled: false });
    expect(readPendingPulls()).toEqual([]);
  } finally {
    holdings.mockRestore();
    jest.useRealTimers();
  }
}, 20_000);
