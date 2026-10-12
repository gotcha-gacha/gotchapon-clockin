import { expect, test } from '@jest/globals';
import { PULL_WAIT, ROLL_FLOOR_X1_MS, ROLL_FLOOR_X10_MS, ROLL_FLOOR_X5_MS, SLOW1_MS, SLOW2_MS, STOP_MS, STOP_MS_X1, rollFloorMs, rollHint, stopPlan } from './rollTiming';

test('the dome wait stays orbit rings, and the hint escalates at 2.6s and 7s', () => {
  expect(PULL_WAIT).toBe('churn');
  expect(rollHint(1, 0, null, false)).toEqual({ text: 'Rolling your card…', actions: false });
  expect(rollHint(5, 0, null, false)).toEqual({ text: 'Rolling 5 cards…', actions: false });
  expect(rollHint(10, SLOW1_MS - 1, null, false).actions).toBe(false);
  expect(rollHint(1, SLOW1_MS, null, false)).toEqual({ text: 'Still rolling — your pull is locked in.', actions: false });
  expect(rollHint(1, SLOW2_MS, null, false)).toEqual({ text: 'Taking longer than usual. Your pull is safe.', actions: true });
  expect(rollHint(5, SLOW2_MS, 'keep', false)).toEqual({ text: 'Nearly there…', actions: false });
  expect(rollHint(5, SLOW2_MS, 'notify', false)).toEqual({ text: "We'll ping you — it lands in your binder either way.", actions: false });
  expect(rollHint(1, SLOW2_MS, 'keep', true)).toEqual({ text: 'Taking longer than usual. Your pull is safe.', actions: true });
  expect(rollHint(1, 0, 'notify', true).actions).toBe(true);
});

test('rolling floors are ×1 none, ×5 a beat, and ×10 adds nothing so it is not ahead of ×1', () => {
  expect(rollFloorMs(1)).toBe(ROLL_FLOOR_X1_MS);
  expect(rollFloorMs(5)).toBe(ROLL_FLOOR_X5_MS);
  expect(rollFloorMs(10)).toBe(ROLL_FLOOR_X10_MS);
  expect(ROLL_FLOOR_X1_MS).toBe(0);
  expect(ROLL_FLOOR_X5_MS).toBe(800);
  expect(ROLL_FLOOR_X10_MS).toBe(0);
  expect(ROLL_FLOOR_X10_MS).toBeGreaterThanOrEqual(ROLL_FLOOR_X1_MS);

  const x1 = stopPlan(1);
  const x5 = stopPlan(5);
  const x10 = stopPlan(10);
  expect(stopPlan(1)).toEqual(x1);
  expect(stopPlan(5)).toEqual(x5);
  expect(stopPlan(10)).toEqual(x10);
  expect(x1.stopMs).toBe(STOP_MS_X1);
  expect(STOP_MS_X1).toBe(320);
  expect(x5.stopMs).toBe(STOP_MS);
  expect(x10.stopMs).toBe(STOP_MS);
  expect(STOP_MS).toBe(600);
  expect(x1.flashMs).toBeLessThanOrEqual(x1.stopMs);
  expect(x5.flashMs).toBeLessThanOrEqual(x5.stopMs);
  expect(x1.lockMs[2]).toBeLessThan(x1.shimmerMs);
  expect(x1.shimmerMs).toBeLessThan(x1.stopMs);
  expect(x10.lockMs[2]).toBeLessThan(x10.stopMs);
  // A fast server: ×10's full stop still lands after ×1's short one. ×5's floor is the long hold.
  expect(rollFloorMs(10) + x10.stopMs).toBeGreaterThan(rollFloorMs(1) + x1.stopMs);
  expect(rollFloorMs(5) + x5.stopMs).toBeGreaterThan(rollFloorMs(1) + x1.stopMs);
});
