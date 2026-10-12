/** Which 3a drawing a pixel size uses. Above 60 the full mark (highlight, left seam tick).
 *  At ≤60 those two drop. At ≤32 the strokes thicken (outline 26, fill 18). */
export type MarkDetail = 'full' | 'compact' | 'tiny';

export function markDetail(size: number): MarkDetail {
  if (size <= 32) return 'tiny';
  if (size <= 60) return 'compact';
  return 'full';
}

/** Arc shared by every 3a drawing (viewBox 120). Open on the upper right: do not close it. */
export const MARK_ARC = 'M78.6 37.8 A29 29 0 1 0 89 60';

/** Highlight on the hero and the full icon. Dropped at ≤60px. */
export const MARK_HIGHLIGHT = 'M44 36 A24 24 0 0 1 56 31.5';

/**
 * Hero G (#345), viewBox 120, no tile. Outline 23 / fill 16 is the ≤60 stroke,
 * kept at 170px so the open ring stays heavy. The crank and the centre button stay.
 */
export const HERO_STROKE = {
  outline: 23,
  fill: 16,
  crank: 9,
  knob: 7,
  knobStroke: 3,
  hub: 11,
  hubStroke: 5,
  highlight: 3.5,
} as const;

export const MARK_STROKE = {
  full: { outline: 21, fill: 15, crank: 8, button: 10.5, buttonStroke: 4.5 },
  compact: { outline: 23, fill: 16, crank: 9, button: 11, buttonStroke: 5 },
  tiny: { outline: 26, fill: 18, crank: 11, button: 13, buttonStroke: 6 },
} as const;
