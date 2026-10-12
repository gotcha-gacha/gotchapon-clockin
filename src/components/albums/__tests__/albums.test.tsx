// Binder sleeve geometry and album cover states (review round 3 of #65).
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AlbumsGrid } from '@/components/albums/AlbumsGrid';
import { SLEEVE_BORDER, SLEEVE_GAP, SLEEVE_PAD, sleeveWidth } from '@/components/albums/BinderDetail';
import { ALBUMS } from '@/api/mock/fixtures';

test('five sleeves and four gaps fit the measured row at every phone width, using all the room there is', () => {
  // The binder row is the screen minus the page gutters, the binder's border and its padding (78 pt).
  for (let screenW = 320; screenW <= 480; screenW += 0.5) {
    const row = screenW - 78;
    const w = sleeveWidth(row);
    const inner = row - 2 * (SLEEVE_PAD + SLEEVE_BORDER) - 4 * SLEEVE_GAP;
    expect(5 * w).toBeLessThanOrEqual(inner);
    expect(5 * (w + 1)).toBeGreaterThan(inner);
  }
});

test('a restocking album still opens and says so; an upcoming set stays closed', async () => {
  const onOpen = jest.fn();
  const albums = [{ ...ALBUMS[0], status: 'restocking' as const }, { ...ALBUMS[1], status: 'soon' as const }];
  await render(<AlbumsGrid albums={albums} holdings={{}} onOpen={onOpen} />);
  await fireEvent(screen.getByTestId('albums-grid'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 370, height: 0 } } });
  expect(screen.getByText('Restocking')).toBeTruthy();
  expect(screen.getAllByText('SOON')).toHaveLength(1);
  await fireEvent.press(screen.getByText(ALBUMS[0].title));
  expect(onOpen).toHaveBeenCalledWith(ALBUMS[0].id);
  await fireEvent.press(screen.getByText(ALBUMS[1].title));
  expect(onOpen).toHaveBeenCalledTimes(1);
});
