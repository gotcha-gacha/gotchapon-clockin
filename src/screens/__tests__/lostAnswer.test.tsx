// A free pull or a burn whose answer is lost (pre-tester fixes, after week 4), against the in-app mock: the server applies it and
// the answer never arrives. As with a paid pull (sealed.test), the capsule stays sealed and the pull is kept on disk, and opening
// it again sends the same pull or the same burn: its cards are revealed and nothing is spent twice. A free pull the server answers
// no to is not kept. Its own file: it loses answers and narrows mock stock.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { BurnRequest, PullCommitRequest } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
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
const lost = () => new ApiError({ code: 'NETWORK', message: 'Request timed out' });

/** A ×1 crank on a free pull: nothing to sign. */
async function freeCrank() {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  const prepared = probe.ritual!.ritual.prepared!;
  expect(prepared.transfer).toBeUndefined();
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  return prepared.pullId;
}

test('a free pull whose answer is lost keeps rolling, and a relaunch opens the same pull without spending another', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  mock!.dev.forceTier('common');
  const { unmount } = await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const land = api.commitPull.bind(api);
  let attempts = 0;
  const commit = jest.spyOn(api, 'commitPull').mockImplementation(async (req: PullCommitRequest) => {
    attempts += 1;
    if (attempts === 1) { await land(req); throw lost(); }
    if (attempts === 2) return new Promise(() => {}); // the poll is in flight when the app goes away
    return land(req);
  });
  const pullId = await freeCrank();
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('rolling'));
  expect(screen.getByText('Rolling your card…')).toBeTruthy();
  expect(screen.queryByText('Try again')).toBeNull();
  expect(screen.queryByText(/payment/i)).toBeNull();
  expect(screen.queryByText('Open it')).toBeNull(); // the pull in flight is not also in the banner
  await waitFor(() => expect(attempts).toBe(2)); // still polling, not sealed
  expect(probe.ritual!.ritual.phase).toBe('rolling');
  expect(readPendingPulls()).toEqual([{ kind: 'pull', userId: expect.any(String), prepared: expect.objectContaining({ pullId }) }]);
  const freeLeft = mock!.dev.state().freePulls;

  await unmount(); // a relaunch reads the pull back from disk
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await fireEvent.press(await screen.findByText('Open it'));
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(commit.mock.calls.map((c) => c[0])).toEqual([{ pullId }, { pullId }, { pullId }]);
  expect(mock!.dev.state().freePulls).toBe(freeLeft);
  expect(readPendingPulls()).toEqual([]);
  expect(screen.queryByText('Open it')).toBeNull();
  commit.mockRestore();
}, 30_000);

test('a free pull the server answers no to returns to idle and is not kept', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const commit = jest.spyOn(api, 'commitPull').mockRejectedValueOnce(new ApiError({ code: 'RESTOCKING', message: 'Every album is restocking' }));
  await freeCrank();
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'RESTOCKING' }));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(readPendingPulls()).toEqual([]);
  expect(screen.queryByText('Open it')).toBeNull();
  commit.mockRestore();
}, 30_000);

test('a free pull is kept even when an older prepare answers after it (the crank grabbed twice within one prepare)', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const prepareOnServer = api.preparePull.bind(api);
  let answerOld!: () => void;
  const oldAnswered = new Promise<void>((done) => { answerOld = done; });
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => { const res = await prepareOnServer(req); await oldAnswered; return res; });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); }); // grabbed: this prepare's answer is slow
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_ABANDONED' }); }); // let go
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); }); // grabbed again: this prepare answers first
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  const { pullId, transfer } = probe.ritual!.ritual.prepared!;
  expect(transfer).toBeUndefined();
  await act(async () => { answerOld(); await new Promise((done) => setTimeout(done, 50)); }); // the first prepare's answer arrives late
  expect(((await prepare.mock.results[0]!.value) as { pullId: string }).pullId).not.toBe(pullId);
  const land = api.commitPull.bind(api);
  const commit = jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req: PullCommitRequest) => { await land(req); throw lost(); });
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(commit.mock.calls.map((c) => c[0])).toEqual([{ pullId }, { pullId }]);
  expect(readPendingPulls()).toEqual([]);
  commit.mockRestore();
  prepare.mockRestore();
}, 30_000);

test('a burn whose answer is lost stays sealed; Try again sends the same burn, which credits one free pull and burns five once', async () => {
  // Ten commons of one card: one new, nine extras (as in burn.test). The reset is load-bearing: the two pulls that land
  // above this test draw their commons off pull ids seeded from a real randomUUID, so about 1 run in 17 they leave a
  // copy of this card, or an extra of their own, behind — and the x10 then reads as 10 extras instead of 9. It does
  // not clear the pending-pull store; that stays empty because every test above ends on an empty readPendingPulls().
  mock!.dev.reset();
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 10);
  const { unmount } = await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => {
    const s = probe.session!;
    await s.devDeposit?.(10);
    const p = await s.preparePull({ count: 10, targeted: false });
    const txSignature = p.transfer ? await s.signTransfer(p) : undefined;
    s.revealed((await s.commitPull({ pullId: p.pullId, txSignature })).outcomes);
  });
  await waitFor(() => expect(probe.session!.extras).toBe(9));
  const freeBefore = mock!.dev.state().freePulls;
  const land = api.burn.bind(api);
  const burn = jest.spyOn(api, 'burn')
    .mockImplementationOnce(async (req: BurnRequest) => { await land(req); throw lost(); })
    .mockImplementationOnce(async (req: BurnRequest) => { await land(req); throw lost(); });
  await act(async () => { probe.ritual!.dispatch({ type: 'BURN_STARTED' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('sealed'), { timeout: 8000 });
  const idem = probe.ritual!.ritual.burnIdem!;
  expect(idem).toEqual(expect.any(String));
  expect(mock!.dev.state().extras).toBe(4); // five spent, and the burn draws no card
  expect(mock!.dev.state().freePulls).toBe(freeBefore + 1);
  expect(screen.queryByText(/payment/i)).toBeNull();
  expect(screen.queryByText('Open it')).toBeNull();
  expect(screen.queryByText('Rub the capsule.')).toBeNull();
  expect(screen.getByText(/free pull waits/)).toBeTruthy();
  expect(readPendingPulls()).toEqual([{ kind: 'burn', userId: expect.any(String), idem }]);

  await fireEvent.press(screen.getByText('Try again')); // its answer is lost again
  await waitFor(() => expect(burn).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('sealed'));
  await fireEvent.press(screen.getByText('Later'));
  expect(await screen.findByText('A burn is still settling — nothing is lost.')).toBeTruthy();

  await unmount(); // a relaunch reads the burn back from disk
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await fireEvent.press(await screen.findByLabelText('Try again'));
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
  expect(burn.mock.calls).toEqual([[{ idem }], [{ idem }], [{ idem }]]);
  expect(probe.ritual!.ritual.outcomes).toEqual([]);
  expect(mock!.dev.state().extras).toBe(4); // five were burned once
  expect(mock!.dev.state().freePulls).toBe(freeBefore + 1);
  expect(readPendingPulls()).toEqual([]);
  expect(screen.queryByText('Rub the capsule.')).toBeNull();
  burn.mockRestore();
}, 40_000);

test('a burn the server answers no to returns to idle and is not kept', async () => {
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const burn = jest.spyOn(api, 'burn').mockRejectedValueOnce(new ApiError({ code: 'UNKNOWN', message: 'You need 5 extras to burn' }));
  await act(async () => { probe.ritual!.dispatch({ type: 'BURN_STARTED' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }), { timeout: 8000 });
  expect(burn).toHaveBeenCalledTimes(1);
  expect(readPendingPulls()).toEqual([]);
  expect(screen.queryByText('Open it')).toBeNull();
  expect(screen.queryByText('Rub the capsule.')).toBeNull();
  burn.mockRestore();
}, 30_000);
