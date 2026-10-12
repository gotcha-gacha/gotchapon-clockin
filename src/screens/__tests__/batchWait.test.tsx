// #358: every pull waits on dome orbit rings and three tray reels. The capsule or pile mounts only after the
// stop hands off to the drop. The commit is held so the wait is observable; the mock otherwise answers in ~120 ms.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ApiError } from '@/api/errors';
import { playSfx } from '@/audio/sfx';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const thuds = () => jest.mocked(playSfx).mock.calls.filter(([name]) => String(name).startsWith('thud')).length;

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}

/** Hold the next commit until `release()`, then pass it on to the real mock. */
function holdNextCommit() {
  const real = api.commitPull.bind(api);
  let pass!: () => void;
  const spy = jest.spyOn(api, 'commitPull').mockImplementationOnce((req) => new Promise((resolve, reject) => {
    pass = () => { real(req).then(resolve, reject); };
  }));
  return { spy, release: () => pass() };
}

async function renderPull() {
  mock!.dev.reset();
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
  await act(async () => { await probe.session!.devDeposit?.(20); });
}

async function crank(multi: 1 | 5 | 10) {
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
}

beforeEach(() => { probe.session = null; probe.ritual = null; jest.mocked(playSfx).mockClear(); });

test('a ×1 wait shows orbit rings and tray reels, then one capsule', async () => {
  await renderPull();
  const held = holdNextCommit();
  try {
    await crank(1);
    await waitFor(() => expect(held.spy).toHaveBeenCalled());
    expect(probe.ritual!.ritual.phase).toBe('rolling');
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    expect(screen.getByTestId('pull-hint')).toHaveTextContent('Rolling your card…');
    expect(screen.queryByTestId('pile-capsule')).toBeNull();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    await act(async () => { held.release(); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
    expect(screen.queryByTestId('roll-reel')).toBeNull();
    expect(screen.queryByTestId('pile-capsule')).toBeNull();
    expect(screen.getByLabelText('Scratch the capsule')).toBeTruthy();
    expect(screen.getByText('YOUR CARD IS UP')).toBeTruthy();
    expect(screen.queryByText('YOUR PILE IS UP')).toBeNull();
    expect(screen.getByTestId('pull-hint')).toHaveTextContent('Rub the capsule.');
  } finally {
    held.spy.mockRestore();
  }
});

test.each([5, 10] as const)('a ×%i wait shows orbit rings and tray reels, then that many capsules in the tap pile', async (multi) => {
  await renderPull();
  const held = holdNextCommit();
  try {
    await crank(multi);
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('rolling'));
    expect(screen.getAllByTestId('roll-reel')).toHaveLength(3);
    expect(screen.getByTestId('roll-churn')).toBeTruthy();
    expect(screen.getByTestId('pull-hint')).toHaveTextContent(`Rolling ${multi} cards…`);
    expect(screen.queryByTestId('pile-capsule')).toBeNull();
    expect(screen.queryByText(`Tap the pile to open all ${multi}`)).toBeNull();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    expect(thuds()).toBe(0); // nothing drops until the roll hands off
    await waitFor(() => expect(held.spy).toHaveBeenCalled());
    await act(async () => { held.release(); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
    expect(screen.queryByTestId('roll-reel')).toBeNull();
    expect(screen.getAllByTestId('pile-capsule')).toHaveLength(multi);
    expect(screen.getByText(`Tap the pile to open all ${multi}`)).toBeTruthy();
    expect(screen.getByText('YOUR PILE IS UP')).toBeTruthy();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    expect(screen.queryByLabelText('Open the capsule')).toBeNull();
    await waitFor(() => expect(thuds()).toBe(multi));
    await fireEvent.press(screen.getByLabelText(`Open all ${multi} capsules`));
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('spread'));
    expect(screen.getByText(`${multi} pulled`)).toBeTruthy();
    expect(screen.getByText('YOUR PILE IS UP')).toBeTruthy();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    // Longer than one landing (560 ms): the tap label must not drop the capsules again.
    await act(async () => { await new Promise((r) => setTimeout(r, 1200)); });
    expect(thuds()).toBe(multi);
  } finally {
    held.spy.mockRestore();
  }
});

test('a sealed ×5 keeps the pile of 5', async () => {
  await renderPull();
  jest.spyOn(api, 'commitPull').mockRejectedValueOnce(new ApiError({ code: 'TX_NOT_FOUND', message: 'refused' }));
  try {
    await crank(5);
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('sealed'));
    expect(screen.getAllByTestId('pile-capsule')).toHaveLength(5);
    expect(screen.queryByText(/Opening/)).toBeNull();
    expect(screen.queryByText(/Tap the pile/)).toBeNull();
    expect(screen.queryByLabelText('Scratch the capsule')).toBeNull();
    expect(screen.queryByLabelText('Open the capsule')).toBeNull();
    expect(screen.queryByText('YOUR CARD IS UP')).toBeNull();
    expect(screen.getByText('Try again')).toBeTruthy();
  } finally {
    jest.mocked(api.commitPull).mockRestore();
  }
});
