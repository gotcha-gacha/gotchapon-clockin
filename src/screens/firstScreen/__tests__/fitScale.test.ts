import { expect, test } from '@jest/globals';
import { columnHeight, fitScale } from '@/screens/firstScreen/fitScale';

test('a column that fits the panel, or that has not been measured, stays at 1', () => {
  expect(fitScale(844, 800)).toBe(1);
  expect(fitScale(844, 844)).toBe(1);
  expect(fitScale(844, 845)).toBe(1); // one pixel is rounding, not a scrollbar
  expect(fitScale(0, 400)).toBe(1);
  expect(fitScale(400, 0)).toBe(1);
  expect(fitScale(-1, 400)).toBe(1);
});

test('a column taller than the panel scales down, floored so it cannot round past the clip', () => {
  // 800 / 860 = 0.93023… floors to 0.930, and 0.930 * 860 = 799.8, inside 800
  expect(fitScale(800, 860)).toBe(0.93);
  expect(fitScale(800, 860) * 860).toBeLessThanOrEqual(800);
  expect(fitScale(520, 640)).toBe(Math.floor((520 / 640) * 1000) / 1000);
});

test('the column height is the children, and nothing else', () => {
  expect(columnHeight([{ offsetHeight: 36 }, { offsetHeight: 170 }, { offsetHeight: 280 }])).toBe(486);
  expect(columnHeight([])).toBe(0);
});
