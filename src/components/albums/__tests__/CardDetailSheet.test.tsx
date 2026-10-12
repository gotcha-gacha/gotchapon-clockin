// Card detail (F3.3): the spec table says only what the contract backs; a common gets its album row; a slab its serial. The
// price is the tier's value from /odds, and a common opens from its album card when the server omits the optional card.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { State } from 'react-native-gesture-handler';
import { fireGestureHandler, getByGestureTestId } from 'react-native-gesture-handler/jest-utils';
import type { Odds } from '@/api/contract';
import { ALBUMS } from '@/api/mock/fixtures';
import { CardDetailSheet } from '@/components/albums/CardDetailSheet';
import { SEASON_PRIZES } from '@/season/catalog';

const album = ALBUMS[0];
const c = album.cards[2];
const ref = { id: c.id, name: c.name, set: 'SV', number: '12', imgSmall: c.imgSmall, imgLarge: 'https://img/large.png' };
// The common row is 0.07, not the model's 0.05: the sheet must read /odds.
const odds: Odds = {
  paid: { price: 1, evPct: 53, rows: [{ tier: 'common', label: 'Album card', pct: 0.77, valueUsd: 0.07 }] },
  free: { price: 0, evPct: 0, rows: [] },
  refreshedAt: '2026-09-10T02:00:00Z',
  stock: { perAlbum: {}, holosLeft: 0 },
  nextRestock: 'Friday',
};

test('a common: tier value, set and slot, how many you hold, and the album row; no price source and no vault claim', async () => {
  const onClose = jest.fn();
  await render(<CardDetailSheet holding={{ cardId: c.id, qty: 3, rarity: 'common', card: ref }} album={album} holdings={{ [c.id]: { cardId: c.id, qty: 3 } }} odds={odds} onClose={onClose} />);
  expect(screen.getByText(c.name)).toBeTruthy();
  // The cached thumbnail sits under the large art, so the card never opens blank while the large image loads.
  expect(screen.getByTestId('card-art-small').props.source).toEqual({ uri: c.imgSmall });
  expect(screen.getByTestId('card-art-large').props.source).toEqual({ uri: 'https://img/large.png' });
  expect(screen.getByText('COMMON')).toBeTruthy();
  expect(screen.getByText('Tier value')).toBeTruthy();
  expect(screen.getByText('about $0.07 · any album card')).toBeTruthy();
  // No price source or date until a real import exists (#61), and no vault row until the stock is counted (#57): Ben, 11 Oct.
  expect(screen.queryByText(/TCGplayer|Priced from|In the vault|Sleeved|penny sleeve/)).toBeNull();
  expect(screen.getByText(`SV · 12 · slot ${c.slot}/25`)).toBeTruthy();
  expect(screen.getByText('×3')).toBeTruthy();
  expect(screen.getByText(`Slot ${c.slot} of 25 · album 1/25`)).toBeTruthy();
  expect(screen.queryByText(/Near mint|since|Market price/)).toBeNull(); // nothing the contract cannot back
  await fireEvent.press(screen.getByLabelText('Close'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('a graded slab: its tier tag and serial, no album row, and shipping not open yet', async () => {
  await render(<CardDetailSheet holding={{ cardId: 'u1', qty: 1, rarity: 'graded', serials: ['PG95-0042137'], card: { ...ref, id: 'u1', name: 'Slab Card' } }} album={null} holdings={{}} onClose={jest.fn()} />);
  expect(screen.getByText('GRADED SLAB')).toBeTruthy();
  expect(screen.getByText('Graded slab · PG95-0042137')).toBeTruthy();
  expect(screen.queryByText('Tier value')).toBeNull(); // no odds loaded: no price named
  expect(screen.queryByText(/of 25 · album/)).toBeNull();
  expect(screen.getByLabelText('Ship this card').props.accessibilityState?.disabled).toBe(true);
});

test('a common sent without its optional card opens from the album card', async () => {
  await render(<CardDetailSheet holding={{ cardId: c.id, qty: 1 }} album={album} holdings={{ [c.id]: { cardId: c.id, qty: 1 } }} odds={odds} onClose={jest.fn()} />);
  expect(screen.getByTestId('card-detail')).toBeTruthy();
  expect(screen.getByText(c.name)).toBeTruthy();
  expect(screen.getByTestId('card-art-large').props.source).toEqual({ uri: c.imgLarge });
  expect(screen.getByText(`${c.set} · ${c.number} · slot ${c.slot}/25`)).toBeTruthy();
});

test('no holding, no sheet', async () => {
  await render(<CardDetailSheet holding={null} album={null} holdings={{}} onClose={jest.fn()} />);
  expect(screen.queryByTestId('card-detail')).toBeNull();
});

const pullSheet = (translationY: number, velocityY = 0) => {
  fireGestureHandler(getByGestureTestId('slab-sheet-pan'), [
    { state: State.BEGAN, translationY: 0, velocityY: 0 },
    { state: State.ACTIVE, translationY, velocityY },
    { state: State.END, translationY, velocityY },
  ]);
};

test('a season prize overlay shows the enlarged face, title, and set number, and not cert, verify, or close', async () => {
  const onClose = jest.fn();
  const prize = SEASON_PRIZES[0];
  await render(<CardDetailSheet holding={null} album={null} holdings={{}} slab={prize} onClose={onClose} />);
  expect(screen.getByTestId('slab-detail-title').props.children).toBe('Pikachu ex SIR');
  expect(screen.getByTestId('slab-detail-subtitle').props.children).toBe('Surging Sparks · 238');
  expect(JSON.stringify(screen.toJSON())).toContain('https://images.pokemontcg.io/sv8/238_hires.png');
  expect(screen.queryByText('Cert 10000238')).toBeNull();
  expect(screen.queryByText(/Verify on PSA/)).toBeNull();
  expect(screen.queryByLabelText('Verify on PSA')).toBeNull();
  expect(screen.queryByLabelText('Close')).toBeNull();
  expect(screen.queryByText('Close')).toBeNull();
  expect(screen.queryByText(/~\$/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Close card detail'));
  expect(onClose).toHaveBeenCalledTimes(1);
});

test('pulling the season prize overlay down dismisses it; a short drag does not', async () => {
  const onClose = jest.fn();
  await render(<CardDetailSheet holding={null} album={null} holdings={{}} slab={SEASON_PRIZES[2]} onClose={onClose} />);
  expect(screen.getByTestId('slab-detail-title').props.children).toBe('Rayquaza VMAX (alt art)');
  expect(screen.getByTestId('slab-detail-subtitle').props.children).toBe('Evolving Skies · 218');
  pullSheet(24);
  expect(onClose).not.toHaveBeenCalled();
  pullSheet(140);
  await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
});
