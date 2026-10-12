// Foil sheen on the first-screen G (#345). The handoff paints it on an inset layer with an annular mask:
// radial-gradient(circle, transparent 40%, #000 41% 60%, transparent 61%).
// A circle's default size is farthest-corner, so those stops are fractions of the half-diagonal.

export const SHEEN_INSET = 14;
/** Transparent, opaque start, opaque end, transparent. The 1% steps are the feather. */
export const SHEEN_STOPS = [0.4, 0.41, 0.6, 0.61] as const;

export function sheenLayer(hero: number): number {
  return hero - SHEEN_INSET * 2;
}

/** The solid band of the annulus, as a circle stroke in the inset layer's box. */
export function annulus(layer: number): { cx: number; cy: number; r: number; stroke: number } {
  const c = layer / 2;
  const corner = c * Math.SQRT2;
  const inner = SHEEN_STOPS[1] * corner;
  const outer = SHEEN_STOPS[2] * corner;
  return { cx: c, cy: c, r: (inner + outer) / 2, stroke: outer - inner };
}
