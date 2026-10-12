// The session tray (F2.9): tally, NEW dots on new commons, rims on rares, nothing before the first pull.
import { expect, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Outcome } from '@/api/contract';
import { SessionTray } from '@/components/machine/SessionTray';

const card = (id: string, name: string) => ({ id, name, set: 'SV', number: '1', imgSmall: `https://img/${id}.png`, imgLarge: `https://img/${id}_hi.png` });
const outcomes: Outcome[] = [
  { cardId: 'h1', rarity: 'holo', isDupe: false, card: card('h1', 'Holo One') },
  { cardId: 'c2', rarity: 'common', isDupe: true, albumId: 'A', card: card('c2', 'Common Two') },
  { cardId: 'c1', rarity: 'common', isDupe: false, albumId: 'A', card: card('c1', 'Common One') },
];

test('tally, NEW on new commons only, and the rare named by tier', async () => {
  await render(<SessionTray recent={outcomes} pulled={3} />);
  expect(screen.getByText('3 pulled · 1 new · 1 rare')).toBeTruthy();
  await fireEvent(screen.getByTestId('session-tray'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 370, height: 0 } } });
  expect(screen.getByLabelText('Common One, new')).toBeTruthy();
  expect(screen.getByLabelText('Common Two')).toBeTruthy();
  expect(screen.getByLabelText('Holo One, Holo rare')).toBeTruthy();
});

test('before the first pull there is no tray', async () => {
  await render(<SessionTray recent={[]} pulled={0} />);
  expect(screen.queryByText('This session')).toBeNull();
});
