// Shared by motion.ts and motion.web.ts. In its own file because Metro applies platform extensions to every import: on the web
// `./motion` written inside motion.web.ts would resolve to motion.web.ts itself.
export type MotionSubscription = { remove: () => void };
/** Acceleration including gravity, m/s². */
export type Gravity = { x: number; y: number; z: number };
/** What the foil's tilt filter is fed: rotation rate in rad/s on a device, a pointer position in −1…1 on a desktop. */
export type Tilt = { x: number; y: number };
