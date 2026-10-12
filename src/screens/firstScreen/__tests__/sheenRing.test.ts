import { expect, test } from '@jest/globals';
import { annulus, SHEEN_INSET, SHEEN_STOPS, sheenLayer } from '@/screens/firstScreen/sheenRing';

test('the sheen is an annulus on a 14px-inset layer, feathered the way the handoff mask is', () => {
  expect(SHEEN_INSET).toBe(14);
  expect(SHEEN_STOPS).toEqual([0.4, 0.41, 0.6, 0.61]);
  const layer = sheenLayer(170);
  expect(layer).toBe(142);
  const band = annulus(layer);
  const corner = (layer / 2) * Math.SQRT2;
  expect(band.r - band.stroke / 2).toBeCloseTo(0.41 * corner, 5);
  expect(band.r + band.stroke / 2).toBeCloseTo(0.6 * corner, 5);
  expect(band.stroke).toBeGreaterThan(0);
  expect(band.r).toBeLessThan(layer / 2);
});
