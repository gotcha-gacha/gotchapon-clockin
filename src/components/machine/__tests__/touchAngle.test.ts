// The crank's angle under the web cabinet's scale (W1.1, #123). gesture-handler's web build reports a touch in glass pixels,
// measured from the view's box on the glass; the crank's centre is in the app's points. This is the arithmetic that was wrong:
// a pointer going once round the knob AS DRAWN must sweep one full turn, whatever the cabinet's scale.
import { expect, test } from '@jest/globals';
import { touchAngle } from '../Crank';

const SOCKET = 88; // Crank.tsx's socket, in points
/** Total angle swept by a pointer circling the socket's centre on the glass, at a cabinet scale. */
function sweep(scale: number, k: number): number {
  const centre = (SOCKET / 2) * scale, r = SOCKET * 0.36 * scale; // on the glass the socket is `scale` times smaller
  let total = 0, last = touchAngle(centre + r, centre, k);
  for (let i = 1; i <= 360; i++) {
    const t = (i / 360) * 2 * Math.PI;
    const a = touchAngle(centre + r * Math.cos(t), centre + r * Math.sin(t), k);
    let d = a - last; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
    total += d; last = a;
  }
  return total;
}

test('on a phone (scale 1, k 1) one circle is one turn', () => {
  expect(sweep(1, 1)).toBeCloseTo(2 * Math.PI, 6);
});

test('inside the cabinet one circle is still one turn, at the scales the shell really uses, down to the .32 floor', () => {
  for (const scale of [0.776, 0.596, 0.446, 0.32]) expect([scale, +sweep(scale, 1 / scale).toFixed(6)]).toEqual([scale, +(2 * Math.PI).toFixed(6)]);
});

test('and without the conversion it is not: at 0.446 the circle never goes round the centre the crank believes in (the bug, pinned)', () => {
  expect(Math.abs(sweep(0.446, 1))).toBeLessThan(0.01); // nets to nothing: the knob wobbles and no pull starts
});
