// Album-complete takeover (#392): the cover stage shows the card that filled the album. Claiming
// credits a closed Jupiter Degen pack. There is no open, rip, or save-for-later.
import { expect, jest, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { CardRef, CompletionGift } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
import { AlbumCompleteTakeover } from '@/components/albums/AlbumCompleteTakeover';

const album = ALBUMS[0];
const gift: CompletionGift = { status: 'confirmed', packType: 'degen_100', count: 1, giftId: 'g1', signature: 'sig', receiver: 'DEMO-WALLET-DO-NOT-SEND', openUrl: 'https://jup.ag/gacha' };
const tinkatink: CardRef = { id: 'sv4-83', name: 'Tinkatink', set: 'SV4', number: '83', imgSmall: 'https://img/tink.png', imgLarge: 'https://img/tink-lg.png' };

test('the cover stage shows the finishing card; claiming credits a closed Degen pack', async () => {
  const onClaim = jest.fn<() => Promise<CompletionGift | null>>(async () => gift);
  const onDone = jest.fn();
  await render(<AlbumCompleteTakeover album={album} finisher={tinkatink} onClaim={onClaim} onDone={onDone} />);
  expect(screen.getByText('COMPLETE')).toBeTruthy();
  expect(screen.getByText(`${album.title} · 25/25`)).toBeTruthy();
  expect(screen.getByText(/free Degen pack pull is ready/)).toBeTruthy();
  expect(screen.queryByText(/holo|Slide out|Ship it home|example partner|redeem on Jupiter/i)).toBeNull();
  const hero = screen.getByLabelText('Tinkatink');
  expect(hero.props.source).toEqual({ uri: tinkatink.imgLarge });
  expect(hero.props.source.uri).not.toBe(album.coverUrl);
  expect(screen.queryByLabelText('Claim it later')).toBeNull();
  expect(screen.queryByLabelText('Save for later')).toBeNull();
  expect(screen.queryByLabelText('Open pack')).toBeNull();
  const cta = screen.getByLabelText('Claim pack');
  await act(async () => { cta.props.onClick({}); cta.props.onClick({}); });
  expect(onClaim).toHaveBeenCalledTimes(1);
  expect(await screen.findByText('Degen pack credited')).toBeTruthy();
  expect(screen.getByText('You have a free Degen pack pull with Jupiter. Open it on Jupiter gacha.')).toBeTruthy();
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  await fireEvent.press(screen.getByLabelText('Open on Jupiter'));
  expect(open.mock.calls.map((call) => call[0])).toEqual(['https://jup.ag/gacha']);
  open.mockRestore();
  expect(screen.getByLabelText('Closed Jupiter Degen pack')).toBeTruthy();
  expect(screen.getByTestId('closed-pack-art').props.source).toBeTruthy();
  expect(screen.queryByText('JUPITER')).toBeNull();
  expect(screen.queryByText('DEGEN')).toBeNull();
  expect(screen.queryByText('PACK')).toBeNull();
  expect(screen.queryByText('Tinkatink')).toBeNull();
  expect(screen.queryByLabelText('Shiny One')).toBeNull();
  expect(screen.queryByText(/example partner|Credit reserved|Pack opened|Opening pack|redeem on Jupiter/i)).toBeNull();
  expect(screen.queryByTestId('opened-pack-art')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Done'));
  expect(onDone).toHaveBeenCalledTimes(1);
});

test('a pack waiting on a restock is queued, not lost; a claim already made says so', async () => {
  const queued = jest.fn<() => Promise<CompletionGift | null>>(async () => { throw new ApiError({ code: 'RESTOCKING', message: 'queued' }); });
  const { unmount } = await render(<AlbumCompleteTakeover album={album} onClaim={queued} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText(/Your Degen pack pull is queued/)).toBeTruthy();
  await unmount();
  await render(<AlbumCompleteTakeover album={album} onClaim={jest.fn<() => Promise<CompletionGift | null>>(async () => null)} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText(/already claimed/)).toBeTruthy();
  await unmount();
  await render(<AlbumCompleteTakeover album={album} onClaim={jest.fn<() => Promise<CompletionGift | null>>(async () => { throw new ApiError({ code: 'UNKNOWN', message: 'no', hint: 'already-claimed' }); })} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText(/already claimed/)).toBeTruthy();
});

test('Open on Jupiter uses the locked page when the gift url is not jup.ag, and a soft failure stays on the cover', async () => {
  const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
  const onClaim = jest.fn<() => Promise<CompletionGift | null>>(async () => ({ ...gift, openUrl: 'https://evil.example/phish' }));
  const { unmount } = await render(<AlbumCompleteTakeover album={album} onClaim={onClaim} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  await fireEvent.press(await screen.findByLabelText('Open on Jupiter'));
  expect(open.mock.calls.map((call) => call[0])).toEqual(['https://jup.ag/gacha']);
  open.mockRestore();
  await unmount();
  await render(<AlbumCompleteTakeover album={album} onClaim={jest.fn<() => Promise<CompletionGift | null>>(async () => { throw new ApiError({ code: 'UNKNOWN', message: 'down' }); })} onDone={jest.fn()} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  expect(await screen.findByText('Your Degen pack is temporarily unavailable. Try again.')).toBeTruthy();
});

test('the closed-pack hero is the official Jupiter DEGEN art, and the peeled rip is not mounted', () => {
  const src = fs.readFileSync(path.join(__dirname, '../PartnerPackArt.tsx'), 'utf8');
  expect(src).toContain("require('../../../assets/partners/jupiter-pokemon-degen-pack.webp')");
  expect(src).not.toContain('jupiter-pokemon-degen-pack-opened');
  expect(src).not.toMatch(/OpeningPack|PackVoucher/);
  expect(fs.existsSync(path.join(__dirname, '../../../../assets/partners/jupiter-pokemon-degen-pack.webp'))).toBe(true);
});

test('nothing to celebrate, nothing shown', async () => {
  await render(<AlbumCompleteTakeover album={null} onClaim={jest.fn<() => Promise<CompletionGift | null>>(async () => null)} onDone={jest.fn()} />);
  expect(screen.queryByTestId('album-complete')).toBeNull();
});

test('a claim that fails says the pull is safe; back closes it, but never while the claim is in flight', async () => {
  let fail: (e: Error) => void = () => {};
  const onClaim = jest.fn<() => Promise<CompletionGift | null>>(() => new Promise<CompletionGift | null>((_, reject) => { fail = reject; }));
  const onDone = jest.fn();
  await render(<AlbumCompleteTakeover album={album} onClaim={onClaim} onDone={onDone} />);
  await fireEvent.press(screen.getByLabelText('Claim pack'));
  await fireEvent(screen.getByTestId('album-complete'), 'requestClose');
  expect(onDone).not.toHaveBeenCalled();
  await act(async () => { fail(new ApiError({ code: 'NETWORK', message: 'down' })); });
  expect(await screen.findByText('No connection — your Degen pack pull is safe. Try again from this album.')).toBeTruthy();
  expect(screen.queryByText(/capsule|payment|Deposit|claim it later|example partner/i)).toBeNull();
  await fireEvent(screen.getByTestId('album-complete'), 'requestClose');
  expect(onDone).toHaveBeenCalledTimes(1);
});
