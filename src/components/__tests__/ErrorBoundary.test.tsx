// The root error boundary (W0.2d, #138): a screen that throws is replaced by a card with a way back, not a blank page, and what
// lives above it (the session, and the kept pulls it holds) is untouched.
import { afterEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { readPendingPulls, writePendingPulls, type PendingPull } from '@/state/pendingPulls';

const fuse = { blown: true };
function Screen() { if (fuse.blown) throw new Error('the capsule could not be drawn'); return <Text>COLLECT HAPPINESS</Text>; }
afterEach(() => { jest.restoreAllMocks(); fuse.blown = true; writePendingPulls([]); });

test('a screen that throws shows the card, and Try again draws the screen afresh', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  await render(<ErrorBoundary><Screen /></ErrorBoundary>);
  expect(screen.getByTestId('error-boundary')).toBeTruthy();
  expect(screen.getByText('Something went wrong')).toBeTruthy();
  expect(screen.queryByText('COLLECT HAPPINESS')).toBeNull();
  fuse.blown = false;
  await fireEvent.press(screen.getByText('Try again'));
  expect(screen.getByText('COLLECT HAPPINESS')).toBeTruthy();
  expect(screen.queryByTestId('error-boundary')).toBeNull();
});

test('the card promises nothing it cannot keep, and a sealed pull is still on disk after the screen has died', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  const sealed: PendingPull = { kind: 'pull', userId: 'me', prepared: { pullId: 'pull_1', costUsd: 1, useFreePulls: 0, expiresAt: '2026-09-18T00:00:00Z' }, txSignature: 'mock:pull_1' };
  writePendingPulls([sealed]);
  await render(<ErrorBoundary><Screen /></ErrorBoundary>);
  expect(screen.getByText(/Nothing you paid for is lost: a capsule that has not opened is waiting for you\./)).toBeTruthy();
  expect(readPendingPulls()).toEqual([sealed]);
});

test('no error, no card', async () => {
  fuse.blown = false;
  await render(<ErrorBoundary><Screen /></ErrorBoundary>);
  expect(screen.getByText('COLLECT HAPPINESS')).toBeTruthy();
  expect(screen.queryByTestId('error-boundary')).toBeNull();
});
