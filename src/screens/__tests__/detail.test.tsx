// Card detail from the binder (F3.3) against the in-app mock: tap a card you own and its sheet opens on that holding.
// Its own file: it narrows mock stock and forces the tier.
import { expect, test } from '@jest/globals';
import React, { useEffect, useRef } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider } from '@/ritual/useRitual';
import { AlbumsPage } from '@/screens/AlbumsPage';
import { SessionProvider, useSession } from '@/state/session';

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 0 } } });

function PullOneCard() {
  const session = useSession();
  const done = useRef(false);
  useEffect(() => {
    if (!session.ready || done.current) return;
    done.current = true;
    void (async () => { const p = await session.preparePull({ count: 1, targeted: false }); session.revealed((await session.commitPull({ pullId: p.pullId })).outcomes); })();
  }, [session]);
  return null;
}

test('tapping a card you own in the binder opens its detail sheet, and Close shuts it', async () => {
  const album = ALBUMS[0];
  const card = album.cards[0];
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, c.id === card.id ? 5 : 0);
  await render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider>
          <RitualProvider><PullOneCard /><AlbumsPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
  await fireEvent(await screen.findByTestId('albums-grid'), 'layout', layout(370));
  expect(await screen.findByText('1/25')).toBeTruthy(); // the pull landed
  await fireEvent.press(screen.getByText(album.title));
  await fireEvent(await screen.findByTestId('binder-sleeves'), 'layout', layout(300));
  await fireEvent.press((await screen.findAllByLabelText(card.name))[0]);
  const sheet = await screen.findByTestId('card-detail');
  expect(within(sheet).getByText('COMMON')).toBeTruthy();
  expect(within(sheet).getByText(`Slot ${card.slot} of 25 · album 1/25`)).toBeTruthy();
  expect(within(sheet).getByText('×1')).toBeTruthy();
  await fireEvent.press(within(sheet).getByLabelText('Close'));
  expect(screen.queryByTestId('card-detail')).toBeNull();
});
