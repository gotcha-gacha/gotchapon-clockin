// #335 / #345: the balance drops when rolling starts, and snow follows a new card or a rare — not an all-duplicate pull.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}

function holdNextCommit() {
  const real = api.commitPull.bind(api);
  let pass!: () => void;
  const spy = jest.spyOn(api, 'commitPull').mockImplementationOnce((req) => new Promise((resolve, reject) => {
    pass = () => { real(req).then(resolve, reject); };
  }));
  return { spy, release: () => pass() };
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
}

async function crank() {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
}

beforeEach(() => { probe.session = null; probe.ritual = null; mock!.dev.reset(); });

test('a paid pull debits the balance when rolling starts, before the commit returns', async () => {
  await renderPull();
  await act(async () => { await probe.session!.devDeposit?.(20); });
  const held = holdNextCommit();
  try {
    await crank();
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('rolling'));
    expect(probe.session!.balanceUsd).toBe(19);
    await act(async () => { held.release(); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
    expect(probe.session!.balanceUsd).toBe(19);
  } finally {
    held.spy.mockRestore();
  }
});

test('a pull of only duplicates bursts no confetti', async () => {
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 2);
  await renderPull();
  await act(async () => { await probe.session!.devDeposit?.(5); });
  await crank();
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  expect(screen.getAllByTestId('confetti-piece')).toHaveLength(26);
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
  await crank();
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  expect(probe.ritual!.ritual.outcomes[0]?.isDupe).toBe(true);
  expect(screen.queryAllByTestId('confetti-piece')).toHaveLength(0);
});
