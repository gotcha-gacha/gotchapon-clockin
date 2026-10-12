// An answer the client cannot read, against the in-app mock: the server applied the free pull and the reply came back as a
// proxy page or a truncated body, so only its status is known. That is a lost answer like NETWORK — the reels keep turning
// and the same commit is retried, which spends nothing more. An UNKNOWN code the client *could* read is an answer, so that
// pull is not kept. Its own file: it loses answers and forces a tier.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { PullCommitRequest } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { readPendingPulls } from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

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
/** What the HTTP client raises when the body is not JSON: the status is known, the answer is not. */
const unreadable = () => new ApiError({ code: 'UNREADABLE', message: 'Unreadable response (HTTP 502)' }, 502);

/** A ×1 crank on a free pull: nothing to sign. */
async function freeCrank() {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  const prepared = probe.ritual!.ritual.prepared!;
  expect(prepared.transfer).toBeUndefined();
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  return prepared.pullId;
}

test('a free pull whose answer is unreadable keeps rolling, and the retry reveals the same pull without spending another', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  mock!.dev.forceTier('common');
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const land = api.commitPull.bind(api);
  const commit = jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req: PullCommitRequest) => { await land(req); throw unreadable(); });
  try {
    const pullId = await freeCrank();
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('rolling'));
    expect(screen.queryByText(/payment/i)).toBeNull();
    const freeLeft = mock!.dev.state().freePulls;
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
    expect(commit.mock.calls.map((c) => c[0])).toEqual([{ pullId }, { pullId }]);
    expect(mock!.dev.state().freePulls).toBe(freeLeft);
    expect(readPendingPulls()).toEqual([]);
  } finally {
    commit.mockRestore();
  }
}, 30_000);

test('an UNKNOWN code the client can read is an answer: that pull is not kept', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const commit = jest.spyOn(api, 'commitPull').mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN', message: 'Something went wrong' }, 500));
  try {
    await freeCrank();
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
    expect(readPendingPulls()).toEqual([]);
    expect(screen.queryByText('Open it')).toBeNull();
    expect(screen.getByText('Try again in a moment. Nothing was charged.')).toBeTruthy();
    expect(screen.queryByText(/A paid pull is never lost/)).toBeNull();
  } finally {
    commit.mockRestore();
  }
}, 30_000);

test('an unreadable prepare says nothing is waiting: the quote never armed', async () => {
  mock!.dev.reset();
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const prepare = jest.spyOn(api, 'preparePull').mockRejectedValueOnce(unreadable());
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNREADABLE' }));
    expect(screen.getByText('Try again in a moment. Nothing was charged.')).toBeTruthy();
    expect(screen.queryByText(/waiting for you/)).toBeNull();
    expect(screen.queryByText(/A paid pull is never lost/)).toBeNull();
    expect(readPendingPulls()).toEqual([]);
  } finally {
    prepare.mockRestore();
  }
}, 30_000);
