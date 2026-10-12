// A fast commit still shows the tier's wait. ×1 adds no rolling floor and uses the short stop.
// ×5 holds 800ms. ×10 adds no rolling floor and keeps the full stop, so it is not ahead of ×1.
// The wait on screen is orbit rings and the three tray reels (#358).
import { beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { AuthProvider } from '@/auth/AuthProvider';
import { DROP_MS, LOCK_MS_X1, STOP_MS_X1 } from '@/ritual/rollTiming';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useFrameCallback: jest.fn(() => ({ setActive: () => {}, isActive: false, callbackId: 0 })), withRepeat: (animation: unknown) => animation };
});
jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}

async function renderPull() {
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /><PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const deposited = probe.session!.devDeposit!(20);
  await waitFor(() => expect(probe.session!.balanceUsd).toBeGreaterThanOrEqual(10));
  await deposited;
}

async function release(multi: 1 | 5 | 10) {
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
}

const advance = async (ms: number) => { await act(async () => { await jest.advanceTimersByTimeAsync(ms); }); };
const phase = () => probe.ritual!.ritual.phase;

beforeEach(() => { probe.session = null; probe.ritual = null; mock!.dev.reset(); jest.useFakeTimers(); });

test('a fast ×1 leaves rolling when the answer is in and finishes the short stop', async () => {
  try {
    await renderPull();
    await release(1);
    expect(phase()).toBe('rolling');
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(160); // inside the mock's commit + holdings (~240ms); nothing else is holding it
    expect(phase()).toBe('rolling');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(200); // total 360: the answer is in, and the 320ms stop is still running
    expect(phase()).toBe('stopping');
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(STOP_MS_X1);
    expect(phase()).toBe('dropping');
    expect(screen.queryByTestId('roll-reel')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('a fast ×5 holds rolling until the 800ms floor', async () => {
  try {
    await renderPull();
    await release(5);
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    await advance(500);
    expect(phase()).toBe('rolling');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(300);
    expect(phase()).toBe('stopping');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  } finally {
    jest.useRealTimers();
  }
});

test('a fast ×10 leaves rolling once the answer is in, and its full stop outlasts ×1', async () => {
  try {
    await renderPull();
    await release(10);
    expect(phase()).toBe('rolling');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    await advance(500);
    expect(phase()).toBe('stopping');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(200); // total 700: ×1 has already handed off (~560ms); ×10's 600ms stop has not
    expect(phase()).toBe('stopping');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
  } finally {
    jest.useRealTimers();
  }
});

test('the stop locks tray reels left to right, then the reveal path continues', async () => {
  try {
    await renderPull();
    await release(1);
    await advance(160);
    expect(phase()).toBe('rolling');
    await advance(200); // the answer opens the short ×1 stop; its lock timers arm as this pass ends
    expect(phase()).toBe('stopping');
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    await advance(LOCK_MS_X1[0]); // the left reel's lock is queued at 0ms when stopping starts
    expect(screen.getAllByTestId('roll-star')).toHaveLength(1);
    await advance(LOCK_MS_X1[1] - LOCK_MS_X1[0]);
    expect(screen.getAllByTestId('roll-star')).toHaveLength(2);
    await advance(LOCK_MS_X1[2] - LOCK_MS_X1[1]);
    expect(screen.getAllByTestId('roll-star')).toHaveLength(3);
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    await advance(STOP_MS_X1 - LOCK_MS_X1[2]);
    expect(phase()).toBe('dropping');
    expect(screen.queryByTestId('roll-reel')).toBeNull();
    expect(screen.queryByTestId('roll-churn')).toBeNull();
    await advance(DROP_MS);
    expect(phase()).toBe('capsule');
  } finally {
    jest.useRealTimers();
  }
});

async function until(want: string) {
  for (let i = 0; i < 80 && phase() !== want; i++) await advance(50);
  expect(phase()).toBe(want);
}

test('a ×10 drop is the pile of 10 from the first paint, then the plural plate', async () => {
  try {
    await renderPull();
    await release(10);
    await until('dropping');
    expect(screen.getAllByTestId('pile-capsule')).toHaveLength(10);
    expect(screen.getByText('DISPENSING…')).toBeTruthy();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    expect(screen.queryByText('YOUR PILE IS UP')).toBeNull();
    expect(screen.queryByText(/Tap the pile/)).toBeNull();
    expect(screen.queryByText(/Opening/)).toBeNull();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    expect(screen.queryByLabelText('Open the capsule')).toBeNull();
    await advance(DROP_MS);
    expect(phase()).toBe('batchcaps');
    expect(screen.getAllByTestId('pile-capsule')).toHaveLength(10);
    expect(screen.getByText('YOUR PILE IS UP')).toBeTruthy();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    expect(screen.getByText('Tap the pile to open all 10')).toBeTruthy();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    expect(screen.queryByLabelText('Open the capsule')).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});

test('a ×1 drop is one capsule, then the singular plate', async () => {
  try {
    await renderPull();
    await release(1);
    await until('dropping');
    expect(screen.queryByTestId('pile-capsule')).toBeNull();
    expect(screen.getByLabelText('Scratch the capsule')).toBeTruthy();
    expect(screen.getByText('DISPENSING…')).toBeTruthy();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    await advance(DROP_MS);
    expect(phase()).toBe('capsule');
    expect(screen.queryByTestId('pile-capsule')).toBeNull();
    expect(screen.getByLabelText('Scratch the capsule')).toBeTruthy();
    expect(screen.getByText('YOUR CARD IS UP')).toBeTruthy();
    expect(screen.queryByText('YOUR PILE IS UP')).toBeNull();
    expect(screen.queryByText(/Tap the pile/)).toBeNull();
  } finally {
    jest.useRealTimers();
  }
});
