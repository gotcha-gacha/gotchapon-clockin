// #186 at the ritual: a paid quote whose transaction does not pay what the build pinned is refused at prepare, before the
// machine arms, so nothing is signed and nothing is charged. The in-app mock signs nothing (so the session's check always
// passes on it); the check itself is src/state/paymentFlow.ts's, measured against real server bytes in
// src/state/__tests__/paymentFlow.test.ts and server/test/clientPaymentGuard.test.ts. Here it is forced, to prove the
// ritual asks it and obeys the answer.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import type { PullPrepareResponse } from '@/api/contract';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { readPendingPulls } from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const verdict = { signable: true, asked: [] as PullPrepareResponse[] };
jest.mock('@/state/paymentFlow', () => {
  const actual = jest.requireActual<typeof import('@/state/paymentFlow')>('@/state/paymentFlow');
  return {
    ...actual,
    paymentSignable: (input: { prepared: PullPrepareResponse }) => { verdict.asked.push(input.prepared); return verdict.signable; },
  };
});

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

async function start(signable: boolean) {
  verdict.signable = signable;
  verdict.asked = [];
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier('common');
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); }); // three free pulls and $2: a transfer
}

test('a quote the payment check refuses signs nothing and charges nothing, even when the hand let go first', async () => {
  await start(false);
  const balance = mock!.dev.state().balanceUsd;
  const kept = readPendingPulls().length;
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
  expect(verdict.asked).toHaveLength(1);
  expect(verdict.asked[0].transfer).toBeDefined();
  expect(readPendingPulls().length).toBe(kept); // nothing signed: a signature is kept on disk before it goes out
  expect(mock!.dev.state().balanceUsd).toBe(balance);
}, 30_000);

test('the control: a quote the check passes arms and pulls', async () => {
  await start(true);
  const balance = mock!.dev.state().balanceUsd;
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
  expect(verdict.asked).toHaveLength(1);
  expect(mock!.dev.state().balanceUsd).toBe(balance - 2);
}, 30_000);

test('a free pull has no transfer, so it never asks', async () => {
  await start(false);
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 1 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  expect(verdict.asked).toHaveLength(0);
}, 30_000);
