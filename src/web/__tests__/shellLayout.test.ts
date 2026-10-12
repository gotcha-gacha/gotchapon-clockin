// The shell's arithmetic (W1.1, #123; the fit rule is #325). Desktop and tablet match the canvas. A laptop no longer
// reserves 250px for the copy before measuring, and nothing floors the scale above what the window can hold.
import { expect, test } from '@jest/globals';
import { cabinetScale, shellLayout, tierOf, viewportBox } from '../shellLayout';

test('the four tiers break at 768, 1024 and 1280', () => {
  expect([0, 390, 767].map(tierOf)).toEqual(['mobile', 'mobile', 'mobile']);
  expect([768, 820, 1023].map(tierOf)).toEqual(['tablet', 'tablet', 'tablet']);
  expect([1024, 1100, 1279].map(tierOf)).toEqual(['laptop', 'laptop', 'laptop']);
  expect([1280, 1440, 2560].map(tierOf)).toEqual(['desktop', 'desktop', 'desktop']);
});

test('the cabinet scale fits the window, and matches the canvas where the canvas already fitted', () => {
  // desktop 1440×900: height (900 − 40 − 84) / 1000 = .776; width min(720, 620) / 466 > 1
  expect(cabinetScale(1440, 900)).toBe(0.776);
  // laptop 1100×800: the copy no longer takes 250 first, so the machine gets (800 − 30 − 74) / 1000 = .696
  // (the canvas's .446 left a ~160px-wide screen). Width (1100 − 80) / 466 > 1.
  expect(cabinetScale(1100, 800)).toBe(0.696);
  // tablet 820×1180: (1180 − 24 − 68) / 1000 > 1, (820 − 80) / 466 > 1: drawn at full size, never larger
  expect(cabinetScale(820, 1180)).toBe(1);
  // The width term never binds where a cabinet exists: the narrowest cabinet window is 768 wide, (768 − 80) / 466 = 1.48, and
  // a desktop's min(vw / 2, 620) / 466 is at least 1.33. It is kept because it is the canvas's formula; a mutant
  // that drops it survives, and is equivalent. Height is what decides: a short desktop window:
  expect(cabinetScale(1280, 720)).toBe(0.596);
  expect(cabinetScale(3000, 3000)).toBe(1);
});

test('a short window scales the whole cabinet down instead of flooring at .32 and clipping the crank', () => {
  // laptop chrome is 30 + 74. (400 − 104) / 1000 = .296, which used to be forced up to .32 and then cropped.
  expect(cabinetScale(1024, 400)).toBe(0.296);
  expect(cabinetScale(1024, 600)).toBe(0.496);
  expect(cabinetScale(1280, 400)).toBe(0.276); // desktop chrome 40 + 84
});

test('the fitted stage, plus its padding, is never taller than the window', () => {
  const chrome = (tier: string) => (tier === 'desktop' ? 124 : tier === 'laptop' ? 104 : 92);
  for (const [w, h] of [[768, 500], [820, 1180], [1024, 400], [1024, 768], [1100, 800], [1100, 1400], [1280, 400], [1280, 720], [1440, 900]] as const) {
    const L = shellLayout(w, h);
    const extra = L.copy === 'below' ? L.gap : 0;
    expect(L.stageH + chrome(L.tier) + extra).toBeLessThanOrEqual(h);
  }
});

test('what each tier shows: copy right / below / none, footer from 768 up, dust everywhere but the tablet', () => {
  const at = (w: number, h: number) => { const l = shellLayout(w, h); return [l.tier, l.copy, l.footer, l.dust, l.roomOpacity]; };
  expect(at(1440, 900)).toEqual(['desktop', 'right', true, true, 0.6]);
  expect(at(1100, 800)).toEqual(['laptop', 'none', true, true, 0.6]); // no room under a fitted cabinet: the copy waits
  expect(at(1100, 1400)).toEqual(['laptop', 'below', true, true, 0.6]); // scale is already 1, and a band remains
  expect(at(820, 1180)).toEqual(['tablet', 'none', true, false, 0.35]);
  expect(at(390, 844)).toEqual(['mobile', 'none', false, false, 0.6]);
  const d = shellLayout(1440, 900);
  expect([d.stageW, d.stageH]).toEqual([Math.round(466 * 0.776), 776]); // the stage is the cabinet's size on the glass
});

test('the shell fills the visual viewport when the browser chrome has shrunk it', () => {
  expect(viewportBox({ innerWidth: 390, innerHeight: 844 })).toEqual({ w: 390, h: 844, top: 0, left: 0 });
  const vv = { width: 390, height: 640, offsetTop: 52, offsetLeft: 0 };
  expect(viewportBox({ innerWidth: 390, innerHeight: 844, visualViewport: vv })).toEqual({ w: 390, h: 640, top: 52, left: 0 });
  expect(viewportBox({ innerWidth: 390, innerHeight: 844, visualViewport: null })).toEqual({ w: 390, h: 844, top: 0, left: 0 });
});
