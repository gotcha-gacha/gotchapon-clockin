// A pull whose prepare fails (pre-tester fixes, after week 4), against the in-app mock: the machine reads its price again, so a
// free pull the server has already used stops showing; and shake-to-crank starts a new pull after one that went nowhere. The
// motion sensor is driven by hand (the simulator has none). Its own file: it spends free pulls behind the app's back and fails a
// prepare.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceMotion } from 'expo-sensors';
import { api, mock } from '@/api';
import { ALBUMS } from '@/api/mock/fixtures';
import { ApiError } from '@/api/errors';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage, slowPrepareHint } from '@/screens/PullPage';
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
/** Motion samples of |a| = `g` into the crank's live listener: four at 30 make a full turn. */
async function shake(samples: number, g = 30) {
  const motion = jest.mocked(DeviceMotion.addListener);
  const listener = motion.mock.calls[motion.mock.calls.length - 1]![0];
  for (let i = 0; i < samples; i++) await act(async () => { listener({ accelerationIncludingGravity: { x: g, y: 0, z: 0 } } as Parameters<typeof listener>[0]); });
}
/** The phone rests past the crank's 2.5 s. */
const still = () => act(async () => { await new Promise((done) => setTimeout(done, 2600)); });

test('a prepare refused because the free pulls were already used reads the price again: the machine stops offering one', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  expect(probe.session).toMatchObject({ freePulls: 3, balanceUsd: 0 });
  // Three free pulls are spent behind this screen's back (another device): the server has none left, the screen shows three.
  for (let i = 0; i < 3; i++) {
    const p = await api.preparePull({
      gachaId: 'all-cards', count: 1, targeted: false, asset: 'USDC', idem: `elsewhere-${i}`,
    });
    await api.commitPull({ pullId: p.pullId });
  }
  expect(probe.session!.freePulls).toBe(3);
  expect(screen.getByText(/3 free pulls left/)).toBeTruthy();
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'INSUFFICIENT_FUNDS' }));
  await waitFor(() => expect(probe.session!.freePulls).toBe(0));
  expect(screen.queryByText(/free pulls? left/)).toBeNull();
}, 30_000);

test('shaking starts a new pull after one whose prepare failed, once the shaking has stopped', async () => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const prepare = jest.spyOn(api, 'preparePull').mockRejectedValueOnce(new ApiError({ code: 'NETWORK', message: 'offline' }));
  // A full turn of shaking on a prepare that fails: the pull goes nowhere and the machine stays on, listening.
  await shake(6);
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'NETWORK' }));
  expect(prepare).toHaveBeenCalledTimes(1);
  await still(); // the shaking stops
  await shake(6);
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(prepare).toHaveBeenCalledTimes(2);
  prepare.mockRestore();
}, 30_000);

test('a full shake turn waiting on a slow prepare is not abandoned when the phone is picked up before the answer', async () => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const prepareOnServer = api.preparePull.bind(api);
  let answer!: () => void;
  const answered = new Promise<void>((done) => { answer = done; });
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => { const res = await prepareOnServer(req); await answered; return res; });
  await shake(6); // a full turn while the prepare is still out
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: true }));
  expect(screen.getByText(slowPrepareHint)).toBeTruthy();
  expect(screen.queryByText(/^Turn the crank/)).toBeNull();
  await still();
  await shake(1, 10.5); // picked up: one sample just over the threshold (gravity alone is 9.81), then it rests again
  await still();
  expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: true });
  await act(async () => { answer(); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  prepare.mockRestore();
}, 30_000);

test('while the crank is still turning, a slow prepare keeps the turn-the-crank hint', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const prepareOnServer = api.preparePull.bind(api);
  let answer!: () => void;
  const answered = new Promise<void>((done) => { answer = done; });
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => { const res = await prepareOnServer(req); await answered; return res; });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'preparing', releasePending: false }));
  expect(screen.getByText('Free pull — turn the crank')).toBeTruthy();
  expect(screen.queryByText(slowPrepareHint)).toBeNull();
  await act(async () => { answer(); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  prepare.mockRestore();
}, 30_000);

// A bundle refused for stock says so, naming the size refused and promising no smaller one; a ×1 refused says the pull is
// sold out. Neither claims that pulls "skip" anything, which nothing does.
test.each<[1 | 10, string]>([
  [10, 'Not enough in stock for a ×10 right now. Nothing was charged.'],
  [1, 'That pull is sold out until the next restock. Nothing was charged.'],
])('a ×%i refused for stock', async (multi, copy) => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  jest.spyOn(api, 'preparePull').mockRejectedValueOnce(new ApiError({ code: 'RESTOCKING', message: 'That gacha is restocking' }, 409));
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'RESTOCKING' }));
  expect(await screen.findByText(copy)).toBeTruthy();
  expect(screen.queryByText(/skip it for now/)).toBeNull();
}, 30_000);

// PR #312's review: a stock refusal was about the size it refused. Changing the size clears it, instead of describing a size
// nobody asked for.
test('changing the size after a stock refusal clears it', async () => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  jest.spyOn(api, 'preparePull').mockRejectedValueOnce(new ApiError({ code: 'RESTOCKING', message: 'That gacha is restocking' }, 409));
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 10 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  expect(await screen.findByText('Not enough in stock for a ×10 right now. Nothing was charged.')).toBeTruthy();
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  expect(probe.ritual!.ritual.error).toBeUndefined();
  expect(screen.queryByText(/Not enough in stock/)).toBeNull();
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 1 }); });
  expect(screen.queryByText(/sold out until the next restock/)).toBeNull();
}, 30_000);

// PR #312's review: while every album is sold out, the dome refuses every size and the hint stays blank under it. A ×10
// refused then must not claim anything about a smaller pull.
test('a ×10 refused while every album is sold out adds no line under the dome', async () => {
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(20); }); // funds, so the refusal is the stock one
  for (const album of ALBUMS) for (const card of album.cards) mock!.dev.setStock(card.id, 0);
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 10 }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'RESTOCKING' }));
  await waitFor(() => expect(probe.session!.odds && Object.values(probe.session!.odds.stock.perAlbum).every((a) => a.live === 0)).toBe(true));
  expect(screen.queryByText(/Not enough in stock/)).toBeNull();
  expect(screen.queryByText(/sold out until the next restock/)).toBeNull();
}, 30_000);
