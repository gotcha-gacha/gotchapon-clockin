// The sky on a phone (#211): the still poster is always under it, the shader goes over it once the screen has a size, and a
// shader that will not compile leaves the poster showing rather than taking the first screen down.
import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';
import { HeroSky } from '@/screens/firstScreen/HeroSky';
import { makeMutable } from 'react-native-reanimated';
import { resetSkyShaderForTests } from '@/screens/firstScreen/SkiaSky';

/** A pointer that never moves: the lean is slice C's and is measured there. */
const tilt = { x: makeMutable(0), y: makeMutable(0) };

beforeEach(() => resetSkyShaderForTests());

const layout = async (width = 390, height = 844) =>
  fireEvent(screen.getByTestId('hero-sky'), 'layout', { nativeEvent: { layout: { width, height, x: 0, y: 0 } } });

test('reduced motion is the poster and nothing else: no shader compiled at all', async () => {
  const make = jest.spyOn(Skia.RuntimeEffect, 'Make');
  await render(<HeroSky reduced calm={false} tilt={tilt} />);
  await layout();
  expect(screen.getByTestId('still-sky')).toBeTruthy();
  expect(screen.queryByTestId('sky-canvas')).toBeNull();
  expect(make).not.toHaveBeenCalled();
  make.mockRestore();
});

test('a shader that will not compile leaves the poster up, and is not compiled again every render', async () => {
  const make = jest.spyOn(Skia.RuntimeEffect, 'Make').mockImplementation(() => { throw new Error('Error in sksl: unknown identifier'); });
  const r = await render(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  await layout();
  expect(screen.getByTestId('still-sky')).toBeTruthy();
  expect(screen.queryByTestId('sky-canvas')).toBeNull();
  await r.rerender(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  expect(make).toHaveBeenCalledTimes(1);
  make.mockRestore();
});

test('with a shader, the sky is drawn over the poster once the screen has been measured', async () => {
  const make = jest.spyOn(Skia.RuntimeEffect, 'Make').mockReturnValue({ source: () => '', getUniformCount: () => 3, getUniformFloatCount: () => 5, getUniformName: () => 'res', getUniform: () => null, makeShader: () => ({}) } as unknown as ReturnType<typeof Skia.RuntimeEffect.Make>);
  await render(<HeroSky reduced={false} calm={false} tilt={tilt} />);
  expect(screen.queryByTestId('sky-canvas')).toBeNull(); // nothing is drawn before the screen has a size
  await layout();
  expect(screen.getByTestId('sky-canvas')).toBeTruthy();
  expect(screen.getByTestId('still-sky')).toBeTruthy(); // and the poster stays under it
  make.mockRestore();
});
