// `/card/:cardId` (`?tier=` for a rare on the shelf): the card detail sheet as a route over the binder (W2.1, #128). Back
// closes it and lands on `/binder/:albumId` (AC-3). The sheet's <Modal> stays inside for `esc`. It shows only while the app
// beneath it does (useSheetGate). Web only in practice: on a phone the sheet is the Albums page's own state.
import React, { useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import { holdingKey, type Tier } from '@/api/contract';
import { CardDetailSheet } from '@/components/albums/CardDetailSheet';
import { cardHref } from '@/navigation/sheetRoutes';
import { useSheetGate } from '@/navigation/useSheetGate';
import { PAGE, useSession } from '@/state/session';
import { DocTitle } from '@/web/DocHead';
import { titled } from '@/navigation/appPaths';

const TIERS: Tier[] = ['common', 'reverse', 'holo', 'ultra', 'graded'];

export default function CardRoute() {
  const { cardId, tier } = useLocalSearchParams<{ cardId: string; tier?: string }>();
  const { albums, holdings, odds, ready, page, setPage, albumOpen, openAlbum } = useSession();
  const rarity = TIERS.find((t) => t === tier); // an unknown tier reads as a common (AC-4: an unknown query never breaks a boot)
  const common = !rarity || rarity === 'common';
  const line = holdings[holdingKey({ cardId, rarity })] ?? null;
  const home = albums.find((a) => a.cards.some((c) => c.id === cardId)) ?? null; // the binder this card belongs in
  const album = common ? home : null; // the sheet's slot line is for a common; a rare on the shelf has none
  const { shown, leave } = useSheetGate(cardHref(cardId, rarity));
  // The sheet is over its binder: whatever page the app was on (a cold load, a rebuilt page, a deferred open), the binder
  // that holds this card is open beneath it, so Back lands there (AC-3).
  useEffect(() => {
    if (!shown || !line || !home) return;
    if (page !== PAGE.albums) setPage(PAGE.albums);
    if (albumOpen !== home.id) openAlbum(home.id);
  }, [shown, line, home, page, setPage, albumOpen, openAlbum]);
  // A card the collector does not hold (a stale link, a typo): nothing to show once the holdings are in, so the sheet goes.
  useEffect(() => { if (shown && ready && !line) leave(); }, [shown, ready, line, leave]);
  if (!shown) return null;
  const name = line?.card?.name ?? home?.cards.find((c) => c.id === cardId)?.name; // the tab names the card (W2.2)
  return <>{name ? <DocTitle title={titled(name)} /> : null}<CardDetailSheet holding={line} album={album} holdings={holdings} odds={odds} onClose={leave} /></>;
}
