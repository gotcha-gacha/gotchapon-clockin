// The app's frame on a phone (W1.1, #123): the window, unscaled, so a gesture's touch is already in the app's own points.
// And a tripwire: a Pan that reads positions without the frame's factor works on a phone and breaks inside the web cabinet.
import { expect, test } from '@jest/globals';
import React from 'react';
import fs from 'node:fs';
import path from 'node:path';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import { AppFrameProvider, useAppFrame, useGestureScale } from '@/state/appFrame';
import { Shell } from '@/web/Shell';

function Probe() { const f = useAppFrame(); const k = useGestureScale(); return <Text>{`${f.width > 0}:${f.scale}:${k}`}</Text>; }

test('with no shell around it (a phone) the frame is the window, scale 1, and a gesture multiplies by 1', async () => {
  await render(<Shell ready><Probe /></Shell>); // the native Shell is a pass-through
  expect(screen.getByText('true:1:1')).toBeTruthy();
});

test('inside a frame scaled to .5 a gesture multiplies a touch by 2', async () => {
  await render(<AppFrameProvider value={{ width: 390, height: 844, scale: 0.5 }}><Probe /></AppFrameProvider>);
  expect(screen.getByText('true:0.5:2')).toBeTruthy();
});

test('every file that builds a Pan gesture converts its touch with useGestureScale', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const pans = walk(path.resolve(__dirname, '../..')).filter((f) => /\.tsx$/.test(f) && !/__tests__|\.test\./.test(f) && /Gesture\.Pan\(\)/.test(fs.readFileSync(f, 'utf8')));
  expect(pans.length).toBeGreaterThanOrEqual(4); // the walk found them: crank, scratch capsule, odds tab, card tilt
  expect(pans.filter((f) => !/useGestureScale\(\)/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f))).toEqual([]);
});
