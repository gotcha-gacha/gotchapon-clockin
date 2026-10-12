// A real server answers a commit without `balance` when it could not read the wallet after settling (#277): the pull stands,
// and the app reads the cost itself instead of trusting a number nobody sent. Against the in-app mock, whose commit is
// made to drop the field. Its own file: it rewrites commits.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import { ApiError } from '@/api/errors';
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

test('a commit with no balance still dispenses, and the machine shows the balance read afterwards', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier('common');
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
  await act(async () => { await probe.session!.devDeposit?.(10); });
  expect(mock!.dev.state().freePulls).toBe(3); // a ×5 uses the three credited free pulls plus $2
  const real = api.commitPull.bind(api);
  const balanceRead = jest.spyOn(api, 'balance');
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => {
    const { balance: _dropped, ...rest } = await real(req);
    return rest;
  });
  const before = mock!.dev.state().balanceUsd;
  const reads = balanceRead.mock.calls.length;
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('batchcaps'));
  expect(mock!.dev.state().balanceUsd).toBe(before - 2);
  await waitFor(() => expect(probe.session!.balanceUsd).toBe(before - 2));
  expect(balanceRead.mock.calls.length).toBeGreaterThan(reads);
}, 30_000);

test('a late re-read never replaces the cost a newer pull has shown since', async () => {
  mock!.dev.forceTier('common');
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
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const turn = async (multi: 1 | 5) => {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
    await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  };
  // Pull A's commit carries no balance, and its re-read hangs until released, answering the balance from before pull B.
  const real = api.commitPull.bind(api);
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => { const { balance: _b, ...rest } = await real(req); return rest; });
  let release: () => void = () => {};
  const stale = { usdc: 1, usdt: 0, pulls: 0 }; // an answer from long before B, easy to tell apart
  jest.spyOn(api, 'balance').mockImplementationOnce(() => new Promise((resolve) => { release = () => resolve(stale); }));
  await turn(1);
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  // Pull B, whose commit carries its balance.
  await turn(1);
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  const afterB = mock!.dev.state().balanceUsd;
  await waitFor(() => expect(probe.session!.balanceUsd).toBe(afterB));
  await act(async () => { release(); });
  await act(async () => { await Promise.resolve(); });
  expect(probe.session!.balanceUsd).toBe(afterB);
}, 30_000);

// #306: a commit that landed with its answer lost re-reads the cost (its free pulls are reserved either way). That read can land
// after a newer pull has shown its cost, and must not replace it: neither the balance nor, from a stale /me, the free pulls.
test('a failed commit\'s re-read never replaces the cost, or the free pulls, a newer pull has shown since', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(2); // A and B are free pulls; the tests above used theirs up
  mock!.dev.forceTier('common');
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
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const s = () => probe.session!;
  // Pull A lands, and its answer is lost. Its re-read hangs, then answers from before pull B: a stale balance and a stale /me.
  const a = await s().preparePull({ count: 1, targeted: false });
  const real = api.commitPull.bind(api);
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => { await real(req); throw new ApiError({ code: 'NETWORK', message: 'answer lost' }); });
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const staleMe = { ...(await api.me()), freePulls: 99 };
  const balanceRead = jest.spyOn(api, 'balance').mockImplementationOnce(async () => { await gate; return { usdc: 1, usdt: 0, pulls: 0 }; });
  jest.spyOn(api, 'me').mockImplementationOnce(async () => { await gate; return staleMe; });
  let aFailed = false;
  // Not inside act: an async act left open while A's read hangs holds back every state update after it, B's included.
  const aDone = s().commitPull({ pullId: a.pullId }).catch(() => { aFailed = true; });
  const held = () => { const st = mock!.dev.state(); return { balanceUsd: st.balanceUsd, freePulls: st.freePulls }; };
  try {
    await waitFor(() => expect(balanceRead).toHaveBeenCalled()); // A's re-read is out
    // Pull B, whose answer carries its cost.
    await act(async () => {
      const b = await s().preparePull({ count: 1, targeted: false });
      s().revealed((await s().commitPull({ pullId: b.pullId })).outcomes);
    });
    await waitFor(() => expect({ balanceUsd: s().balanceUsd, freePulls: s().freePulls }).toEqual(held()));
  } finally {
    release(); // never leave A's read hanging, even when an assertion above fails
    await act(async () => { await aDone; });
  }
  expect(aFailed).toBe(true);
  // A's stale answers ($0.000001, 99 free pulls) arrived after B showed its cost, and are dropped: the machine still shows
  // what the server holds.
  expect({ balanceUsd: s().balanceUsd, freePulls: s().freePulls }).toEqual(held());
}, 30_000);

// #306: opening a pull again (a replay: its first answer was lost) reads the cost fresh, since the replayed answer's may be old.
// That read too must not replace the cost a newer pull has shown since it went out.
test('a replay\'s re-read never replaces the cost, or the free pulls, a newer pull has shown since', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(2);
  mock!.dev.forceTier('common');
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
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const s = () => probe.session!;
  // Pull A lands with its answer lost; its own re-read runs normally.
  const a = await s().preparePull({ count: 1, targeted: false });
  const real = api.commitPull.bind(api);
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => { await real(req); throw new ApiError({ code: 'NETWORK', message: 'answer lost' }); });
  await act(async () => { await s().commitPull({ pullId: a.pullId }).catch(() => {}); });
  // A is opened again: a replay. Its re-read hangs, then answers from before pull B.
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const staleMe = { ...(await api.me()), freePulls: 99 };
  const balanceRead = jest.spyOn(api, 'balance').mockImplementationOnce(async () => { await gate; return { usdc: 1, usdt: 0, pulls: 0 }; });
  jest.spyOn(api, 'me').mockImplementationOnce(async () => { await gate; return staleMe; });
  // Not inside act: an async act left open while the read hangs holds back every state update after it.
  const replayDone = s().commitPull({ pullId: a.pullId }).catch(() => {});
  const held = () => { const st = mock!.dev.state(); return { balanceUsd: st.balanceUsd, freePulls: st.freePulls }; };
  try {
    await waitFor(() => expect(balanceRead).toHaveBeenCalled()); // the replay's re-read is out
    await act(async () => {
      const b = await s().preparePull({ count: 1, targeted: false });
      s().revealed((await s().commitPull({ pullId: b.pullId })).outcomes);
    });
    await waitFor(() => expect({ balanceUsd: s().balanceUsd, freePulls: s().freePulls }).toEqual(held()));
  } finally {
    release();
    await act(async () => { await replayDone; });
  }
  expect({ balanceUsd: s().balanceUsd, freePulls: s().freePulls }).toEqual(held());
}, 30_000);

// PR #311's review: the guards must drop only a read a newer pull has overtaken. With no newer pull, a failed commit's
// re-read applies at once: nothing here presses Later, whose own refresh would hide a read that never applied.
test('a failed commit\'s re-read applies when no newer pull has shown its cost', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  mock!.dev.forceTier('common');
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
  const s = () => probe.session!;
  const before = s().freePulls;
  const a = await s().preparePull({ count: 1, targeted: false });
  const real = api.commitPull.bind(api);
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => { await real(req); throw new ApiError({ code: 'NETWORK', message: 'answer lost' }); });
  await act(async () => { await s().commitPull({ pullId: a.pullId }).catch(() => {}); });
  expect(mock!.dev.state().freePulls).toBe(before - 1);
  expect(s().freePulls).toBe(before - 1); // the re-read applied: the machine never offers the free pull A used
}, 30_000);
