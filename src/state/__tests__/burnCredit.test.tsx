// A burn on a real server answers without `balance` (#294, mainnet-dev). The credit is the response's extras and freePulls.
// Reading `/me` afterwards can put a stale free-pull count back, including over a prepare that already subtracted it, and a
// pull still face-down must not restore the extras the burn just spent when that pull opens. A holdings read that fails is
// not a lost burn: the answer already arrived, and there is no card to seal.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { Balance, Outcome } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { readPendingPulls } from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}

test('a burn with no balance keeps the response counts, and a parked reveal cannot put the spent extras back', async () => {
  mock!.dev.reset();
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 30);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const s = () => probe.session!;
  await act(async () => { await s().devDeposit?.(10); });
  let outcomes: Outcome[] = [];
  await act(async () => {
    const p = await s().preparePull({ count: 10, targeted: false });
    const txSignature = p.transfer ? await s().signTransfer(p) : undefined;
    outcomes = (await s().commitPull({ pullId: p.pullId, txSignature })).outcomes;
  });
  expect(s().extras).toBe(0); // the ×10 is still face-down: its nine extras wait with it
  expect(mock!.dev.state().extras).toBe(9);

  const realBurn = api.burn.bind(api);
  const burn = jest.spyOn(api, 'burn').mockImplementationOnce(async (req) => {
    const { balance: _dropped, ...rest } = await realBurn(req);
    return rest;
  });
  const staleMe = { ...(await api.me()), freePulls: 99 };
  const me = jest.spyOn(api, 'me').mockResolvedValue(staleMe);
  let releaseBalance: (b: Balance) => void = () => {};
  const balance = jest.spyOn(api, 'balance').mockImplementationOnce(() => new Promise((resolve) => { releaseBalance = resolve; }));
  try {
    await act(async () => { await s().burn('burn-while-parked'); });
    expect(s().extras).toBe(4);
    expect(s().freePulls).toBe(1);
    await act(async () => { await s().preparePull({ count: 1, targeted: false }); });
    expect(s().freePulls).toBe(0); // prepare took the credit off the counter
    await act(async () => { releaseBalance({ usdc: 1, usdt: 0, pulls: 99 }); });
    expect(s().freePulls).toBe(0); // the wallet re-read is not /me, so it cannot put 99 back
    expect(me).not.toHaveBeenCalled();
    expect(balance).toHaveBeenCalled();
    await act(async () => { s().revealed(outcomes); });
    expect(s().extras).toBe(4); // opening the face-down pull does not restore the nine
    expect(s().freePulls).toBe(0);
    expect(readPendingPulls()).toEqual([]);
  } finally {
    burn.mockRestore();
    me.mockRestore();
    balance.mockRestore();
  }
}, 20_000);

test('a holdings failure after a burn answer still applies the credit and drops the pending burn', async () => {
  mock!.dev.reset();
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 10);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider><Probe /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const s = () => probe.session!;
  await act(async () => {
    await s().devDeposit?.(10);
    const p = await s().preparePull({ count: 10, targeted: false });
    const txSignature = p.transfer ? await s().signTransfer(p) : undefined;
    s().revealed((await s().commitPull({ pullId: p.pullId, txSignature })).outcomes);
  });
  await waitFor(() => expect(s().extras).toBe(9));
  const holdings = jest.spyOn(api, 'holdings').mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'inventory unread' }));
  try {
    await act(async () => { await s().burn('burn-holdings-unread'); });
    expect(s().extras).toBe(4);
    expect(s().freePulls).toBe(1);
    expect(readPendingPulls()).toEqual([]);
    expect(probe.ritual!.ritual.phase).toBe('idle');
  } finally {
    holdings.mockRestore();
  }
}, 20_000);
