import { expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { PageDots, RESULT_GAP, railHeight } from '@/components/PageDots';
import { useSession } from '@/state/session';

jest.mock('@/state/session', () => ({
  PAGES: ['Albums', 'Pull', 'Wallet'],
  PAGE: { albums: 0, pull: 1, wallet: 2 },
  useSession: jest.fn(),
}));

const session = jest.mocked(useSession);

test('the labeled rail navigates, marks the current page and shows the Albums badge', async () => {
  const setPage = jest.fn();
  session.mockReturnValue({ page: 1, setPage, newCards: 2, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
  await render(<PageDots />);

  expect(screen.getByLabelText('Pull page, current').props.accessibilityState.selected).toBe(true);
  expect(screen.getByLabelText('Wallet page')).toBeTruthy();
  expect(screen.queryByLabelText('Odds page')).toBeNull();
  expect(screen.getByTestId('albums-new-badge')).toBeTruthy();
  expect(screen.queryByTestId('pull-waiting-badge')).toBeNull();
  await fireEvent.press(screen.getByLabelText('Albums page'));
  expect(setPage).toHaveBeenCalledWith(0);
});

test('the swipe line sits above the tabs', async () => {
  session.mockReturnValue({ page: 2, setPage: jest.fn(), newCards: 0, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
  await render(<PageDots />);

  // The arrow carries its text-presentation selector: a bare ↔ is an emoji box in iOS Safari.
  expect(screen.getByText('SWIPE TO EXPLORE\u00a0 \u2194\uFE0E')).toBeTruthy();
  expect(screen.getByLabelText('Wallet page, current')).toBeTruthy();
});

test('the rail is the labeled tab row plus the safe area, taller than the old dots the result sheet was aimed at', () => {
  // `bottom: 70` cleared page dots. A notched phone (inset 34) stacks that inset on a tab row, so a
  // sheet that stays at 70 is covered. The gap is what keeps the card off the rail's top edge.
  // 86 = pad 5 + swipe line 14 + tab 58 + under 8 + hairline 1. The web rail drops the 14 (PageDots.web.test.tsx).
  expect(railHeight(0)).toBe(86);
  expect(railHeight(0)).toBeGreaterThan(70);
  expect(railHeight(34)).toBe(railHeight(0) + 34);
  // On a notched phone the sheet has to clear the old 70 AND the inset, or the rail covers it.
  expect(railHeight(34) + RESULT_GAP).toBeGreaterThan(70 + 34);
});

test('a kept capsule marks the Pull tab from the Binder, where the waiting banner is not drawn', async () => {
  session.mockReturnValue({ page: 0, setPage: jest.fn(), newCards: 0, pagerLocked: false, pendingPulls: [{}] } as unknown as ReturnType<typeof useSession>);
  await render(<PageDots />);

  expect(screen.getByTestId('pull-waiting-badge')).toBeTruthy();
  expect(screen.getByLabelText('Pull page, capsule waiting')).toBeTruthy();
  expect(screen.queryByTestId('albums-new-badge')).toBeNull();
  expect(screen.getByLabelText('Albums page, current')).toBeTruthy();
});

test('the page icons are hidden from assistive tech; the tab label is the name', async () => {
  session.mockReturnValue({ page: 1, setPage: jest.fn(), newCards: 0, pagerLocked: false } as unknown as ReturnType<typeof useSession>);
  await render(<PageDots />);

  // Same shape as the sign-in marks: the picture is in the tree, and out of the accessibility tree.
  expect(screen.queryAllByTestId('page-icon')).toHaveLength(0);
  expect(screen.getAllByTestId('page-icon', { includeHiddenElements: true })).toHaveLength(3);
  expect(screen.getByLabelText('Pull page, current')).toBeTruthy();
});

test('the rail cannot leave the ritual while the pager is locked', async () => {
  const setPage = jest.fn();
  session.mockReturnValue({ page: 1, setPage, newCards: 0, pagerLocked: true } as unknown as ReturnType<typeof useSession>);
  await render(<PageDots />);

  const albums = screen.getByLabelText('Albums page');
  expect(albums.props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(albums);
  expect(setPage).not.toHaveBeenCalled();
});
