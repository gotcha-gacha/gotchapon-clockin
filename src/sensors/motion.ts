// Motion sensors behind one seam (W0.5, #135). Native: expo-sensors, exactly as the crank and the foil used it before. The web
// has its own file (motion.web.ts): expo-sensors' SDK 57 web shims have no `addListener`, so calling them throws on every
// browser and unmounts the app one click past sign-in.
import { DeviceMotion, Gyroscope } from 'expo-sensors';

import type { Gravity, MotionSubscription, Tilt } from './motion.types';

export type { Gravity, MotionSubscription, Tilt } from './motion.types';

/** Shake-to-crank: a sample about every 33 ms. */
export function watchShake(onSample: (g: Gravity) => void): MotionSubscription {
  DeviceMotion.setUpdateInterval(33);
  return DeviceMotion.addListener(({ accelerationIncludingGravity: g }) => { if (g) onSample(g); });
}

/** The foil's tilt: a sample about every 16 ms. */
export function watchTilt(onSample: (t: Tilt) => void): MotionSubscription {
  Gyroscope.setUpdateInterval(16);
  return Gyroscope.addListener(({ x, y }) => onSample({ x, y }));
}

/** Called when a touch goes down on the crank. Native has nothing to ask: the OS gives an app its motion sensors. */
export function primeMotion(): void {}
