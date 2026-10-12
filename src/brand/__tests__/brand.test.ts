// The locked name and the 3a drawings (#336). The SVGs are what the app icons are rasterized from.
import { expect, test } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { PRODUCT_NAME, PUBLIC_DOMAIN } from '../name';
import { HERO_STROKE, MARK_ARC, MARK_STROKE, markDetail } from '../markDetail';

const brand = (name: string) => fs.readFileSync(path.join(__dirname, '../../../assets/brand', name), 'utf8');

test('the working name is Gotchapon, with no registered-mark claim', () => {
  expect(PRODUCT_NAME).toBe('Gotchapon');
  expect(PRODUCT_NAME).not.toMatch(/[®™]/);
  expect(PUBLIC_DOMAIN).toBe('gotchapon.fun');
});

test('the hero G stays an open ring with its crank', () => {
  expect(MARK_ARC).toBe('M78.6 37.8 A29 29 0 1 0 89 60');
  expect(MARK_ARC).not.toMatch(/Z/);
  expect(HERO_STROKE).toMatchObject({ outline: 23, fill: 16, crank: 9, knob: 7, hub: 11 });
});

test('mark detail follows the size rules: full, then drop highlight and seam tick, then thicken', () => {
  expect(markDetail(120)).toBe('full');
  expect(markDetail(61)).toBe('full');
  expect(markDetail(60)).toBe('compact');
  expect(markDetail(33)).toBe('compact');
  expect(markDetail(32)).toBe('tiny');
  expect(markDetail(16)).toBe('tiny');
  expect(MARK_STROKE.full).toMatchObject({ outline: 21, fill: 15 });
  expect(MARK_STROKE.tiny).toMatchObject({ outline: 26, fill: 18 });
});

test('the committed svgs are the 3a mark, including the small-size omissions', () => {
  const full = brand('mark-3a.svg');
  const small = brand('mark-3a-60.svg');
  const tiny = brand('mark-3a-32.svg');
  const light = brand('mark-3a-light.svg');
  for (const svg of [full, small, tiny, light]) {
    expect(svg).toContain('M78.6 37.8 A29 29 0 1 0 89 60');
    expect(svg).not.toMatch(/[®™]|style=/);
  }
  expect(full).toContain('stroke-width="21"');
  expect(full).toContain('stroke-width="15"');
  expect(full).toContain('M44 36 A24 24 0 0 1 56 31.5');
  expect(full).toContain('x1="22"');
  expect(small).not.toContain('M44 36');
  expect(small).not.toContain('x1="22"');
  expect(small).toContain('stroke-width="23"');
  expect(small).toContain('stroke-width="16"');
  expect(tiny).not.toContain('#FFD23F');
  expect(tiny).toContain('stroke-width="26"');
  expect(tiny).toContain('stroke-width="18"');
  expect(light).toContain('#1F2D4D');
  expect(light).toContain('#FF5A47');
  expect(light).toContain('#FFFFFF');
});
