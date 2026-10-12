import { beforeEach, expect, jest, test } from '@jest/globals';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useReducedMotion } from 'react-native-reanimated';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { SessionProvider } from '@/state/session';
import { SEASON_DRAW_AT, SEASON_PRIZES } from '@/season/catalog';
import type { Season } from '@/api/contract';
import { SeasonRaffle } from '@/components/season/SeasonRaffle';

jest.mock('react-native-reanimated', () => {
  const actual = jest.requireActual<typeof import('react-native-reanimated')>('react-native-reanimated');
  return { __esModule: true, ...actual, useReducedMotion: jest.fn(() => false) };
});

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 80 } } });

const season = (): Season => ({
  id: 'season-one',
  title: 'Season One raffle',
  drawAt: SEASON_DRAW_AT,
  prizes: SEASON_PRIZES.map((prize) => ({ ...prize })),
  myTickets: 4,
  streak: { count: 2, countedToday: false },
});

beforeEach(() => {
  jest.mocked(useReducedMotion).mockReturnValue(false);
});

test('Albums mounts the raffle above the title and a slab opens its prize overlay', async () => {
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><AlbumsPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  expect(await screen.findByTestId('season-raffle')).toBeTruthy();
  expect(screen.getByText('YOUR TICKETS')).toBeTruthy();
  expect(screen.queryByText('5 SLABS · ~$2,860')).toBeNull();
  expect(screen.queryByText(/~\$/)).toBeNull();
  expect(screen.getByText('1 ticket per $1 paid pull')).toBeTruthy();
  expect(screen.getByText("Prizes are PSA 10 slabs, bought before the draw. One prize per ticket, grand prize first. Free pulls don't earn tickets.")).toBeTruthy();
  expect(screen.getByText('5-day streak')).toBeTruthy();
  expect(screen.getByText('A paid pull starts it.')).toBeTruthy();
  expect(screen.getByText('A paid pull each day. Miss a day and it starts over. At 5, +2 raffle tickets, then it starts over.')).toBeTruthy();
  expect(screen.getAllByTestId('streak-dot-off')).toHaveLength(5);
  expect(screen.queryAllByTestId('streak-dot-on')).toHaveLength(0);
  expect(screen.getByText('DAYS')).toBeTruthy();
  expect(screen.queryByText(/gold ring|gold capsule/i)).toBeNull();
  const tree = JSON.stringify(screen.toJSON());
  expect(tree.indexOf('Season One raffle')).toBeLessThan(tree.indexOf('Albums'));
  await fireEvent(screen.getByTestId('season-mid-grid'), 'layout', layout(168));
  expect(screen.getAllByText('GEM MT').length).toBeGreaterThanOrEqual(5);
  expect(screen.getAllByText('10').length).toBeGreaterThanOrEqual(5);
  expect(screen.getByText('2024 POKEMON SSP EN')).toBeTruthy();
  expect(screen.getByText('238/191 · CERT 10000238')).toBeTruthy();
  expect(screen.getAllByTestId('season-barcode')).toHaveLength(1);
  expect(screen.queryByText('PSA')).toBeNull();
  expect(screen.getAllByTestId('season-sheen')).toHaveLength(1);
  expect(screen.queryByText(/~\$\d/)).toBeNull();
  expect(screen.getByText('GRAND PRIZE')).toBeTruthy();
  const faces = JSON.stringify(screen.toJSON());
  expect(faces).toContain('https://images.pokemontcg.io/sv8/238_hires.png');
  expect(faces).toContain('https://images.pokemontcg.io/sv3/223_hires.png');
  expect(faces).toContain('https://images.pokemontcg.io/swsh7/218_hires.png');
  expect(faces).toContain('https://images.pokemontcg.io/sv8/239_hires.png');
  expect(faces).toContain('https://images.pokemontcg.io/swsh11/180_hires.png');
  expect(faces).not.toContain('cdn.gotchapon.fun');
  await fireEvent.press(screen.getByLabelText('Pikachu ex SIR, grand prize'));
  expect(await screen.findByTestId('slab-detail-title')).toBeTruthy();
  expect(screen.getByTestId('slab-detail-title').props.children).toBe('Pikachu ex SIR');
  expect(screen.getByTestId('slab-detail-subtitle').props.children).toBe('Surging Sparks · 238');
  expect(screen.queryByText('Cert 10000238')).toBeNull();
  expect(screen.queryByText('Verify on PSA ↗')).toBeNull();
  expect(screen.queryByLabelText('Verify on PSA')).toBeNull();
  expect(screen.queryByLabelText('Close')).toBeNull();
  expect(screen.queryByText('Close')).toBeNull();
  expect(screen.queryByText(/Sept 2026/)).toBeNull();
  expect(screen.queryByText(/~\$/)).toBeNull();
  await fireEvent.press(screen.getByLabelText('Close card detail'));
  expect(screen.queryByTestId('slab-detail-title')).toBeNull();
});

test('a raffle that is not the page on screen drops the sheen and the conic', async () => {
  await render(<SeasonRaffle season={season()} onOpenPrize={jest.fn()} motion={false} />);
  expect(screen.queryByTestId('season-sheen')).toBeNull();
  expect(screen.queryByTestId('season-conic')).toBeNull();
});

test('reduced motion drops the sheen and the conic', async () => {
  jest.mocked(useReducedMotion).mockReturnValue(true);
  await render(<SeasonRaffle season={season()} onOpenPrize={jest.fn()} />);
  expect(screen.queryByTestId('season-sheen')).toBeNull();
  expect(screen.queryByTestId('season-conic')).toBeNull();
  expect(screen.getByTestId('season-ticket-count').props.children).toBe(4);
});

test('a streak of 2 shows two dots and the keep-it line', async () => {
  await render(<SeasonRaffle season={season()} nowMs={Date.parse(SEASON_DRAW_AT) - 86_400_000} onOpenPrize={jest.fn()} />);
  expect(screen.getByText('Day 2 of 5. A paid pull today keeps it.')).toBeTruthy();
  expect(screen.getAllByTestId('streak-dot-on')).toHaveLength(2);
  expect(screen.getAllByTestId('streak-dot-off')).toHaveLength(3);
});

test('a streak that just paid out shows 0 of 5 and says it starts over tomorrow', async () => {
  const paidOut = { ...season(), streak: { count: 0, countedToday: true } };
  await render(<SeasonRaffle season={paidOut} nowMs={Date.parse(SEASON_DRAW_AT) - 86_400_000} onOpenPrize={jest.fn()} />);
  expect(screen.getByText('Counted today. It starts over on the next paid day.')).toBeTruthy();
  expect(screen.getAllByTestId('streak-dot-off')).toHaveLength(5);
  expect(screen.queryAllByTestId('streak-dot-on')).toHaveLength(0);
});

test('a clock at drawAt says Drawing…', async () => {
  await render(<SeasonRaffle season={season()} nowMs={Date.parse(SEASON_DRAW_AT)} onOpenPrize={jest.fn()} />);
  expect(screen.getByText('Drawing…')).toBeTruthy();
  expect(screen.queryByText('SEC')).toBeNull();
});
