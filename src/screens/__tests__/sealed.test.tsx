// A paid pull whose commit fails after the transfer is signed (F2.10, review of PR #66), against the in-app mock: the sealed
// capsule can be left, the pull survives on disk and a relaunch, and Open it commits the same pull and signature into the
// normal reveal. A pull that can never open (it expired) says where the money is and is not kept. Its own file: it fails commits.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ApiError } from '@/api/errors';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { readPendingPulls } from '@/state/pendingPulls';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}
const app = () => (
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider initialPage={PAGE.pull}>
        <RitualProvider><Probe /><PullPage /></RitualProvider>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>
);

/** A ×5 crank with balance enough to pay it, so there is still a transfer to sign. */
async function paidCrankFailing(code: 'TX_NOT_FOUND' | 'EXPIRED') {
  jest.spyOn(api, 'commitPull').mockRejectedValueOnce(new ApiError({ code, message: 'refused' }));
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  expect(probe.ritual!.ritual.prepared?.transfer).toBeDefined();
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('sealed'));
}

test('a sealed paid pull can be left, survives a relaunch, and Open it commits the same pull into the reveal', async () => {
  mock!.dev.forceTier('common');
  const { unmount } = await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  await paidCrankFailing('TX_NOT_FOUND');
  const pullId = probe.ritual!.ritual.prepared!.pullId;
  const txSignature = probe.ritual!.ritual.txSignature!;
  expect(screen.getByText('Try again')).toBeTruthy();
  expect(screen.queryByText(/went through/)).toBeNull();
  expect(readPendingPulls()).toEqual([{ kind: 'pull', userId: expect.any(String), prepared: expect.objectContaining({ pullId }), txSignature }]); // on disk since signing
  await fireEvent.press(screen.getByText('Later'));
  expect(probe.ritual!.ritual.phase).toBe('idle');
  expect(await screen.findByText('A capsule is waiting to open — nothing is lost.')).toBeTruthy();

  await unmount(); // a relaunch reads the pull back from disk
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const commit = jest.spyOn(api, 'commitPull');
  commit.mockClear();
  await fireEvent.press(await screen.findByText('Open it'));
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
  expect(commit.mock.calls).toEqual([[{ pullId, txSignature }]]);
  expect(readPendingPulls()).toEqual([]);
  expect(screen.queryByText('Open it')).toBeNull();
}, 30_000);

test('a pull that can never open (it expired before the payment landed) says where the money is, and is not kept', async () => {
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await paidCrankFailing('EXPIRED');
  expect(screen.getByText('That pull timed out')).toBeTruthy();
  expect(screen.getByText(/comes back to your balance/)).toBeTruthy();
  expect(screen.queryByText('Try again')).toBeNull();
  expect(readPendingPulls()).toEqual([]);
  await fireEvent.press(screen.getByText('Start over'));
  expect(probe.ritual!.ritual.phase).toBe('idle');
  expect(screen.queryByText('Open it')).toBeNull();
}, 30_000);
