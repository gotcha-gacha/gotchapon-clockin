// A complete album's binder reopens the album-complete takeover (F3.5, review of PR #66): the same takeover the ritual holds, so
// nothing pulls behind it. A claim whose answer was lost goes out again as the same claim (pre-tester fixes, after week 4), the
// binder stops offering a claim the server answered, and after a relaunch a repeat claim returns that same holo. Against the in-app mock, with the Albums
// and Pull pages mounted side by side as the pager mounts them. Its own file: it narrows mock stock and forces the tier.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DeviceMotion } from 'expo-sensors';
import { api, mock } from '@/api';
import { DEMO_WALLET } from '@/api/mock';
import type { CompletionClaimRequest } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}
const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });
const app = () => (
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider initialPage={PAGE.pull}>
        <RitualProvider><Probe /><AlbumsPage /><PullPage /></RitualProvider>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>
);
const lost = () => new ApiError({ code: 'NETWORK', message: 'Request timed out' });

/** Open an album's binder from the grid. */
async function openBinder(title: string) {
  await act(async () => { probe.session!.setPage(0); });
  await fireEvent(await screen.findByTestId('albums-grid'), 'layout', layout(370));
  await fireEvent.press(screen.getAllByText(title)[0]!);
}

/** A pull straight through the session, revealed at once, paying with a mock transfer when free pulls run out. */
async function pullOne() {
  const s = probe.session!;
  const p = await s.preparePull({ count: 1, targeted: false });
  const txSignature = p.transfer ? await s.signTransfer(p) : undefined;
  s.revealed((await s.commitPull({ pullId: p.pullId, txSignature })).outcomes);
}

test("a complete album's binder reopens the takeover: nothing pulls behind it, a lost answer still claims the same pack, and the credit has no open step", async () => {
  const album = ALBUMS[0];
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  album.cards.forEach((c) => mock!.dev.setStock(c.id, 1)); // one copy each: every pull is a new card for this album
  const { unmount } = await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(30); for (let i = 0; i < album.size; i++) await pullOne(); });
  await openBinder(album.title);
  await fireEvent.press(await screen.findByLabelText(`Claim ${album.title} partner pack`));
  expect(await screen.findByText('COMPLETE')).toBeTruthy();
  expect(probe.ritual!.ritual.takeover).toBe(album.id);

  // Nothing pulls behind it: the crank's motion listener is off, and a shake sample that still arrives starts nothing. The
  // other album is restocked first, so a pull could start at all.
  for (const c of ALBUMS[1].cards) mock!.dev.setStock(c.id, 3);
  const motion = jest.mocked(DeviceMotion.addListener);
  expect((motion.mock.results[motion.mock.results.length - 1]!.value as { remove: () => void }).remove).toHaveBeenCalled();
  const shake = motion.mock.calls[motion.mock.calls.length - 1]![0];
  const balance = mock!.dev.state().balanceUsd;
  for (let i = 0; i < 40; i++) await act(async () => { shake({ accelerationIncludingGravity: { x: 30, y: 0, z: 0 } } as Parameters<typeof shake>[0]); });
  await act(async () => { await new Promise((done) => setTimeout(done, 300)); });
  expect(probe.ritual!.ritual.phase).toBe('idle');
  expect(mock!.dev.state().balanceUsd).toBe(balance);

  // The first claim lands and its answer is lost: claiming again sends the same claim, so the pack unlocks rather than
  // "already claimed".
  const land = api.claimCompletion.bind(api);
  const claim = jest.spyOn(api, 'claimCompletion').mockImplementationOnce(async (req: CompletionClaimRequest) => { await land(req); throw lost(); });
  const usd = probe.session!.balanceUsd;
  const free = probe.session!.freePulls;
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText(/your Degen pack pull is safe/)).toBeTruthy();
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText('Degen pack credited')).toBeTruthy();
  expect(screen.getByText('You have a free Degen pack pull with Jupiter. Open it on Jupiter gacha.')).toBeTruthy();
  expect(screen.queryByText(/already claimed|example partner|Open pack|Credit reserved/i)).toBeNull();
  expect(screen.getByLabelText('Open on Jupiter')).toBeTruthy();
  const [first, again] = claim.mock.calls.map(([req]) => req.idem);
  expect(again).toBe(first);
  claim.mockRestore();
  expect(Object.values(probe.session!.holdings).some((h) => h.rarity === 'holo')).toBe(false);
  expect(probe.session!.partnerPacks[album.id]).toMatchObject({ kind: 'pack-credit', partner: 'jupiter-degen', wallet: DEMO_WALLET, packType: 'degen_100', openUrl: 'https://jup.ag/gacha' });
  expect(probe.session!.partnerPacks[album.id]?.suppressedCardId).toBeUndefined();
  expect(probe.session!.balanceUsd).toBe(usd);
  expect(probe.session!.freePulls).toBe(free);
  await fireEvent.press(screen.getByLabelText('Done'));
  await waitFor(() => expect(screen.queryByTestId('album-complete')).toBeNull());
  expect(probe.ritual!.ritual.takeover).toBeUndefined();
  expect(screen.queryByLabelText(`Claim ${album.title} partner pack`)).toBeNull();
  expect(screen.queryByLabelText(`Open ${album.title} partner pack`)).toBeNull();
  expect(screen.getByText('Free Degen pack pull credited. Open it on Jupiter gacha.')).toBeTruthy();

  // A relaunch has not heard of the claim: claiming again is the same pack credit, not an empty success.
  await unmount();
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await openBinder(album.title);
  await fireEvent.press(await screen.findByLabelText(`Claim ${album.title} partner pack`));
  await fireEvent.press(await screen.findByLabelText('Claim pack'));
  expect(await screen.findByText('Degen pack credited')).toBeTruthy();
  expect(screen.queryByText(/already claimed/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Done'));
  await waitFor(() => expect(screen.queryByTestId('album-complete')).toBeNull());
  expect(screen.queryByLabelText(`Claim ${album.title} partner pack`)).toBeNull();
  expect(screen.getByText('Free Degen pack pull credited. Open it on Jupiter gacha.')).toBeTruthy();
}, 60_000);

test('a claim goes out again with the same key only while its answer is lost; one the server answered is a new claim next time', async () => {
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const unavailable = () => new ApiError({ code: 'UNKNOWN', message: 'Your Degen pack is temporarily unavailable. Try again.' });
  const claim = jest.spyOn(api, 'claimCompletion').mockRejectedValueOnce(lost()).mockRejectedValueOnce(unavailable()).mockRejectedValueOnce(unavailable());
  for (let i = 0; i < 3; i++) await act(async () => { await expect(probe.session!.claimCompletion(ALBUMS[1].id)).rejects.toBeInstanceOf(ApiError); });
  const keys = claim.mock.calls.map(([req]) => req.idem);
  expect(keys[1]).toBe(keys[0]); // the answer was lost: the same claim
  expect(keys[2]).not.toBe(keys[1]); // the server answered (unavailable): the next claim is a new one
  expect(probe.session!.claimedAlbums.has(ALBUMS[1].id)).toBe(false);
  claim.mockRestore();
}, 30_000);

const awardedGift = {
  outcomes: [],
  gift: { status: 'confirmed' as const, packType: 'degen_100', count: 1, giftId: 'g1', signature: 'sig', receiver: DEMO_WALLET, openUrl: 'https://jup.ag/gacha' },
};

test('a confirmed gift marks the album claimed without reading holdings', async () => {
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const claim = jest.spyOn(api, 'claimCompletion').mockResolvedValue(awardedGift);
  const holdings = jest.spyOn(api, 'holdings');
  const before = holdings.mock.calls.length;
  await act(async () => { await probe.session!.claimCompletion(ALBUMS[1].id); });
  expect(probe.session!.claimedAlbums.has(ALBUMS[1].id)).toBe(true);
  expect(holdings.mock.calls.length).toBe(before);
  expect(probe.session!.partnerPacks[ALBUMS[1].id]).toMatchObject({ wallet: DEMO_WALLET, packType: 'degen_100', openUrl: 'https://jup.ag/gacha', giftId: 'g1' });
  claim.mockRestore();
  holdings.mockRestore();
}, 30_000);

test('an empty claim is not marked claimed', async () => {
  await render(app());
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const claim = jest.spyOn(api, 'claimCompletion').mockResolvedValue({ outcomes: [] });
  await act(async () => { await expect(probe.session!.claimCompletion(ALBUMS[1].id)).rejects.toBeInstanceOf(ApiError); });
  expect(probe.session!.claimedAlbums.has(ALBUMS[1].id)).toBe(false);
  await act(async () => { await expect(probe.session!.claimCompletion(ALBUMS[1].id)).rejects.toBeInstanceOf(ApiError); });
  expect(probe.session!.claimedAlbums.has(ALBUMS[1].id)).toBe(false);
  expect(claim.mock.calls[1]![0].idem).not.toBe(claim.mock.calls[0]![0].idem); // the empty answer was readable: the next claim is a new one
  claim.mockRestore();
}, 30_000);
