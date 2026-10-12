/**
 * The first test of the web jest project (W0.4, #122). It imports `@/sensors/motion` with no suffix: under the `jest-expo/web`
 * preset that must resolve to motion.web.ts, the file a browser gets, and it runs against jsdom's real `window` and real events
 * rather than a stand-in. (motionWeb.test.ts, in the native project, covers the permission state machine with a fake window.)
 */
import { afterEach, expect, jest, test } from '@jest/globals';
import * as motion from '@/sensors/motion';

type WebMotion = typeof motion & { resetMotionForTests?: () => void };
const web = motion as WebMotion;
const motionEvent = (props: object) => Object.assign(new Event('devicemotion'), props);
const withDeviceMotion = (value: unknown) => { (window as unknown as { DeviceMotionEvent?: unknown }).DeviceMotionEvent = value; };

afterEach(() => { web.resetMotionForTests!(); withDeviceMotion(undefined); }); // no `?.`: a reset that silently stopped running would leak listeners between tests

test('the web project resolves the seam to motion.web.ts, not to the expo-sensors file', () => {
  expect(typeof web.resetMotionForTests).toBe('function'); // only the web file has it
});

test('a real devicemotion event on the real window reaches a shake listener, and stops reaching it once removed', () => {
  withDeviceMotion(class {});
  const got = jest.fn();
  const sub = motion.watchShake(got);
  window.dispatchEvent(motionEvent({ accelerationIncludingGravity: { x: 0, y: 3, z: 14 }, rotationRate: null }));
  expect(got).toHaveBeenCalledTimes(1);
  expect(got).toHaveBeenCalledWith({ x: 0, y: 3, z: 14 });
  sub.remove();
  window.dispatchEvent(motionEvent({ accelerationIncludingGravity: { x: 0, y: 3, z: 14 }, rotationRate: null }));
  expect(got).toHaveBeenCalledTimes(1);
});

test('jsdom has no DeviceMotionEvent of its own: like a browser without the sensor API, nothing listens and nothing throws', () => {
  const got = jest.fn();
  const sub = motion.watchShake(got);
  expect(() => motion.primeMotion()).not.toThrow();
  window.dispatchEvent(motionEvent({ accelerationIncludingGravity: { x: 0, y: 3, z: 14 } }));
  expect(got).not.toHaveBeenCalled();
  sub.remove();
});
