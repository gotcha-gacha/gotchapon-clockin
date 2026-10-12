// A free pull's reservation shows on the counter as soon as prepare accepts it (the machine used to stay one pull ahead until
// commit). Letting go of an armed crank puts that pull back. Against the in-app mock, whose prepare reserves at once.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
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

async function oneFreePull() {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  expect(probe.session).toMatchObject({ freePulls: 1, balanceUsd: 0 });
  expect(screen.getByTestId('pulls-count').props.children).toBe(1);
  expect(screen.getByText('1 free pull left')).toBeTruthy();
}

test('a free ×1 takes its pull off the counter when prepare lands, before the crank finishes', async () => {
  await oneFreePull();
  const commit = jest.spyOn(api, 'commitPull');
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  expect(commit).not.toHaveBeenCalled();
  expect(probe.session!.freePulls).toBe(0);
  expect(screen.getByTestId('pulls-count').props.children).toBe(0);
  expect(screen.queryByText('$1 · 1 pull')).toBeNull();
  expect(screen.queryByText('$1 a pull')).toBeNull();
  expect(screen.getByText('Free pull — turn the crank')).toBeTruthy();
  expect(screen.queryByText(/free pull left/)).toBeNull();
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(probe.session!.freePulls).toBe(0);
  expect(mock!.dev.state().freePulls).toBe(0);
  commit.mockRestore();
}, 30_000);

test('letting go of an armed free pull puts it back on the counter', async () => {
  await oneFreePull();
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  expect(probe.session!.freePulls).toBe(0);
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_ABANDONED' }); });
  expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', prepared: undefined });
  expect(probe.session!.freePulls).toBe(1);
  expect(screen.getByTestId('pulls-count').props.children).toBe(1);
  expect(screen.getByText('1 free pull left')).toBeTruthy();
  // The server still holds the reservation until it expires. The mock gives it back when the next prepare supersedes it.
  expect(mock!.dev.state().freePulls).toBe(0);
}, 30_000);

test('a prepare that answers after the crank was let go does not keep the free pull off the counter', async () => {
  await oneFreePull();
  const prepareOnServer = api.preparePull.bind(api);
  let answer!: () => void;
  const answered = new Promise<void>((done) => { answer = done; });
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req);
    await answered;
    return res;
  });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: false }));
  expect(probe.session!.freePulls).toBe(1);
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_ABANDONED' }); });
  expect(probe.ritual!.ritual.phase).toBe('idle');
  await act(async () => { answer(); });
  await act(async () => { await new Promise((done) => setTimeout(done, 50)); });
  expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', prepared: undefined });
  expect(probe.session!.freePulls).toBe(1);
  expect(screen.getByTestId('pulls-count').props.children).toBe(1);
  prepare.mockRestore();
}, 30_000);
