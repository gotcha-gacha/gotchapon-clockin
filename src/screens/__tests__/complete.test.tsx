// Album complete (F3.5, #392) against the in-app mock: the pull that fills an album opens the takeover once the card is filed
// (never over the reveal). The COMPLETE hero is that card. Claiming credits a Jupiter Degen pack pull and does not
// move the balance or the free-pull count. Nothing starts behind it: a shake reaches the crank through the modal.
// Its own file: it narrows mock stock and forces the tier.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceMotion } from 'expo-sensors';
import { mock } from '@/api';
import { DEMO_WALLET } from '@/api/mock';
import { ALBUMS } from '@/api/mock/fixtures';
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

/** A pull straight through the session, revealed at once, paying with a mock transfer when free pulls run out. */
async function pullOne() {
  const s = probe.session!;
  const p = await s.preparePull({ count: 1, targeted: false });
  const txSignature = p.transfer ? await s.signTransfer(p) : undefined;
  s.revealed((await s.commitPull({ pullId: p.pullId, txSignature })).outcomes);
}

test('filling an album opens the takeover on that card; claiming credits the pack and leaves the pull count alone', async () => {
  const album = ALBUMS[0];
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  album.cards.forEach((c) => mock!.dev.setStock(c.id, 1)); // one copy each: every pull is a new card for this album
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
  await act(async () => { await probe.session!.devDeposit?.(30); for (let i = 0; i < album.size - 1; i++) await pullOne(); });
  // The twenty-fifth card, through the machine.
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  expect(screen.queryByTestId('album-complete')).toBeNull(); // not over the reveal
  const finisher = probe.ritual!.ritual.outcomes[0]!;
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  expect(await screen.findByText('COMPLETE')).toBeTruthy();
  expect(screen.getByText(`${album.title} · 25/25`)).toBeTruthy();
  expect(screen.getByLabelText(finisher.card.name)).toBeTruthy();
  expect(screen.getByLabelText(finisher.card.name).props.source).toEqual({ uri: finisher.card.imgLarge || finisher.card.imgSmall });
  expect(screen.queryByText(/same odds/i)).toBeNull();
  expect(screen.queryByText(/×5 and ×10|x5 and x10/i)).toBeNull();
  expect(screen.getByLabelText('Claim pack')).toBeTruthy();
  expect(screen.queryByLabelText('Claim it later')).toBeNull();
  expect(screen.queryByText(/Slide out the holo|guaranteed holo|same odds/i)).toBeNull();
  // The crank's motion listener is off while the takeover is up, and a shake sample that still arrives starts no pull. The other
  // album is restocked first: with nothing in stock a started pull would fail at prepare and pass for one that never started.
  for (const c of ALBUMS[1].cards) mock!.dev.setStock(c.id, 3);
  const motion = jest.mocked(DeviceMotion.addListener);
  expect(motion).toHaveBeenCalled();
  expect((motion.mock.results[motion.mock.results.length - 1]!.value as { remove: () => void }).remove).toHaveBeenCalled();
  const shake = motion.mock.calls[motion.mock.calls.length - 1]![0];
  const balance = probe.session!.balanceUsd;
  const free = probe.session!.freePulls;
  const pulls = screen.getByTestId('pulls-count').props.children;
  for (let i = 0; i < 40; i++) await act(async () => { shake({ accelerationIncludingGravity: { x: 30, y: 0, z: 0 } } as Parameters<typeof shake>[0]); });
  await act(async () => { await new Promise((done) => setTimeout(done, 300)); });
  expect(probe.ritual!.ritual.phase).toBe('idle');
  expect(probe.session!.balanceUsd).toBe(balance);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText('Degen pack credited')).toBeTruthy();
  expect(screen.getByText('You have a free Degen pack pull with Jupiter. Open it on Jupiter gacha.')).toBeTruthy();
  expect(screen.getByLabelText('Open on Jupiter')).toBeTruthy();
  expect(screen.getByLabelText('Closed Jupiter Degen pack')).toBeTruthy();
  expect(screen.queryByText(/example partner|Open pack|Save for later|Credit reserved|Pack opened/i)).toBeNull();
  expect(Object.values(probe.session!.holdings).some((h) => h.rarity === 'holo')).toBe(false);
  expect(probe.session!.partnerPacks[album.id]).toMatchObject({ kind: 'pack-credit', partner: 'jupiter-degen', wallet: DEMO_WALLET, packType: 'degen_100', openUrl: 'https://jup.ag/gacha' });
  expect(probe.session!.partnerPacks[album.id]?.suppressedCardId).toBeUndefined();
  expect(probe.session!.balanceUsd).toBe(balance);
  expect(probe.session!.freePulls).toBe(free);
  expect(screen.getByTestId('pulls-count').props.children).toBe(pulls);
  await fireEvent.press(screen.getByLabelText('Done'));
  await waitFor(() => expect(screen.queryByTestId('album-complete')).toBeNull());
  expect(probe.ritual!.ritual.phase).toBe('idle');
}, 30_000);
