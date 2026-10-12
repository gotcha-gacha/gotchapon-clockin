// The spread deals commons face up and rares face down; a rare's front stays invisible until it is
// flipped (design frontVis — the regression behind ee61ac9 showed the art mirrored instead of the back).
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { Outcome } from '@/api/contract';
import { Spread } from '@/components/reveal/Spread';

const card = (id: string, name: string) => ({ id, name, set: 'SV', number: '1', imgSmall: `https://img/${id}.png`, imgLarge: `https://img/${id}_hi.png` });
const outcomes: Outcome[] = [
  { cardId: 'c1', rarity: 'common', isDupe: false, albumId: 'A', card: card('c1', 'Common One') },
  { cardId: 'h1', rarity: 'holo', isDupe: false, card: card('h1', 'Holo One') },
];

function opacityOf(testID: string): number | undefined {
  const style = screen.getByTestId(testID).props.style;
  const flat = (Array.isArray(style) ? style.flat(Infinity) : [style]).filter(Boolean) as Record<string, unknown>[];
  return flat.reduce<number | undefined>((acc, st) => (typeof st.opacity === 'number' ? st.opacity : acc), undefined);
}

test('a common deals face up; a rare hides its front until flipped', async () => {
  const onFlipped = jest.fn(); const onAllFlipped = jest.fn();
  await render(<Spread outcomes={outcomes} width={310} onFlipped={onFlipped} onShake={jest.fn()} onFlash={jest.fn()} onAllFlipped={onAllFlipped} />);
  expect(opacityOf('card-front-0')).toBe(1);
  expect(opacityOf('card-front-1')).toBe(0);
  expect(screen.getByText('1 new · 1 rare — tap to flip')).toBeTruthy();
  expect(onAllFlipped).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByLabelText('Flip card'));
  expect(opacityOf('card-front-1')).toBe(1);
  expect(onFlipped).toHaveBeenCalledTimes(1);
  expect(onFlipped).toHaveBeenCalledWith('holo');
  expect(onAllFlipped).toHaveBeenCalled();
});

test('Flip all flips every remaining rare once', async () => {
  jest.useFakeTimers();
  const onFlipped = jest.fn();
  const two: Outcome[] = [outcomes[1], { ...outcomes[1], cardId: 'h2', card: card('h2', 'Holo Two') }];
  await render(<Spread outcomes={two} width={310} onFlipped={onFlipped} onShake={jest.fn()} onFlash={jest.fn()} onAllFlipped={jest.fn()} />);
  await fireEvent.press(screen.getByText('Flip all'));
  jest.advanceTimersByTime(600);
  expect(onFlipped).toHaveBeenCalledTimes(2);
  jest.useRealTimers();
});
