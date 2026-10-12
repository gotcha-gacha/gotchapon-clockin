import { expect, test } from '@jest/globals';
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TapCapsule } from '@/components/reveal/TapCapsule';

function topColor(): string | undefined {
  const style = screen.getByTestId('capsule-top').props.style as unknown[];
  const hit = style.find((item) => item && typeof item === 'object' && 'backgroundColor' in (item as object)) as { backgroundColor?: string } | undefined;
  return hit?.backgroundColor;
}

test('the capsule shell keeps the colour it mounted with', async () => {
  const view = await render(<TapCapsule tier="common" shellColor="#8FE3C5" interactive={false} onCrack={() => {}} />);
  expect(topColor()).toBe('#8FE3C5');
  await view.rerender(<TapCapsule tier="holo" shellColor="#FFD23F" interactive onCrack={() => {}} />);
  expect(topColor()).toBe('#8FE3C5');
});
