// An older prepare's answer (review of PR #71, round 2), against the in-app mock: the crank is grabbed, let go and grabbed again,
// and the turn completes while both prepares are out. The server supersedes the first pull when it prepares the second, and the
// first prepare's answer comes back first. Only the second prepare's answer counts: whether the first answers, fails or asks more
// than the machine showed, the turn reaches the capsule with the second pull, and a paid turn signs only the second transfer.
// Its own file: it holds prepares and resets the mock.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { PullPrepareRequest, PullPrepareResponse } from '@/api/contract';
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
/** A fresh server (three credited free pulls, no balance — not a sign-up grant) and the Pull page on it. */
async function freshApp() {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
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
const prepareOnServer = api.preparePull.bind(api);
const commitOnServer = api.commitPull.bind(api);
const lost = () => new ApiError({ code: 'NETWORK', message: 'Request timed out' });
const gate = () => { let open!: () => void; const opened = new Promise<void>((done) => { open = done; }); return { open, opened }; };

/** Holds the next two prepares' answers: the server prepares each pull (`pulls`), and each answer waits until `answer(i)`.
 *  `first` makes the first grab's answer from its pull. Commits pass through `commit`; `restore` puts both methods back. */
function holdTwoPrepares(first: (res: PullPrepareResponse) => PullPrepareResponse) {
  const pulls: PullPrepareResponse[] = [];
  const gates = [gate(), gate()] as const;
  const held = (i: 0 | 1, reply: (res: PullPrepareResponse) => PullPrepareResponse) => async (req: PullPrepareRequest) => {
    const res = await prepareOnServer(req);
    pulls.push(res);
    await gates[i].opened;
    return reply(res);
  };
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(held(0, first)).mockImplementationOnce(held(1, (res) => res));
  const commit = jest.spyOn(api, 'commitPull');
  /** Prepare `i`'s answer comes back, with time for the host to dispatch it. */
  const answer = (i: 0 | 1) => act(async () => { gates[i].open(); await new Promise((done) => setTimeout(done, 50)); });
  return { pulls, answer, commit, restore: () => { prepare.mockRestore(); commit.mockRestore(); } };
}

/** Grab, let go, grab again, and a full turn before either held prepare has answered. */
async function regrab(pulls: PullPrepareResponse[]) {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); }); // grabbed
  await waitFor(() => expect(pulls).toHaveLength(1));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_ABANDONED' }); }); // let go
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); }); // grabbed again
  await waitFor(() => expect(pulls).toHaveLength(2)); // the server has prepared the second pull, superseding the first
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); }); // a full turn before either answer
  expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: true });
}

test.each<[string, (res: PullPrepareResponse) => PullPrepareResponse]>([
  ['answers', (res) => res],
  ['fails', () => { throw lost(); }],
  ['asks more than the machine showed', (res) => ({ ...res, costUsd: res.costUsd + 1 })],
])('a free turn: the first prepare %s while the second is out, which changes nothing, and the second pull reaches the capsule', async (_, first) => {
  await freshApp();
  const { pulls, answer, commit, restore } = holdTwoPrepares(first);
  try {
    await regrab(pulls);
    expect(pulls.map((p) => p.transfer)).toEqual([undefined, undefined]); // free pulls: nothing to sign
    await answer(0);
    expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: true });
    expect(probe.ritual!.ritual.error).toBeUndefined();
    expect(probe.ritual!.ritual.repriced).toBeUndefined();
    expect(commit).not.toHaveBeenCalled();
    await answer(1);
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
    expect(commit.mock.calls).toEqual([[{ pullId: pulls[1]!.pullId }]]);
    expect(readPendingPulls()).toEqual([]);
    // What arming the first grab's pull would have met.
    await expect(commitOnServer({ pullId: pulls[0]!.pullId })).rejects.toMatchObject({ code: 'EXPIRED' });
  } finally {
    restore();
  }
}, 30_000);

test('a paid turn: the first prepare answers while the second is out, and only the second pull\'s transfer is signed', async () => {
  await freshApp();
  await act(async () => { await probe.session!.devDeposit?.(10); });
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); }); // three free pulls and $2
  const { pulls, answer, commit, restore } = holdTwoPrepares((res) => res);
  try {
    await regrab(pulls);
    expect(pulls.map((p) => p.transfer?.amount)).toEqual([2_000_000, 2_000_000]);
    await answer(0);
    expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: true });
    expect(readPendingPulls()).toEqual([]); // a signed pull is kept the moment its signature exists: nothing was signed
    expect(commit).not.toHaveBeenCalled();
    await answer(1);
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
    const second = pulls[1]!.pullId;
    expect(commit.mock.calls).toEqual([[{ pullId: second, txSignature: `mock:${second}` }]]);
    expect(mock!.dev.state().balanceUsd).toBe(8);
    expect(readPendingPulls()).toEqual([]);
  } finally {
    restore();
  }
}, 30_000);
