// A foil shader that fails to compile must degrade to no foil. Native Skia throws on a compile error
// (CanvasKit returns null), so the throw path is the one the device takes.
import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { View } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';
import { Foil } from '@/components/reveal/Foil';

test('a compile error draws no foil instead of throwing in render, and is not retried every render', async () => {
  const make = jest.spyOn(Skia.RuntimeEffect, 'Make').mockImplementation(() => { throw new Error('Error in sksl: unknown identifier'); });
  const r = await render(<View testID="card"><Foil width={188} height={268} intensity={0.9} /></View>);
  expect(screen.getByTestId('card').children).toHaveLength(0);
  await r.rerender(<View testID="card"><Foil width={188} height={268} intensity={0.9} /></View>);
  expect(screen.getByTestId('card').children).toHaveLength(0);
  expect(make).toHaveBeenCalledTimes(1);
});
