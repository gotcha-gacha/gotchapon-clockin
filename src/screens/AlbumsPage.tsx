// Albums (F3.1) and the binder (F3.2): a grid of covers; tap a live album for its binder. "Pull this
// album" targets the ritual at that album ($1.50 each; the chase starts at ×1) and jumps to the Pull page, whose
// target banner clears it. Under the grid, the Extras card (F2.9); at five extras its button starts the burn hand-off
// (F4.2), which slides to the machine and arms a free pull (F4.1). Tapping an owned card, or a rare on the shelf, opens its detail sheet (F3.3).
// A complete album's binder reopens the ritual's album-complete takeover (F3.5, #392): claim the Degen pack
// credit. The completion ledger's holo is not shown as the prize.
import React, { useEffect, useState } from 'react';
import { AppState, View } from 'react-native';
import { Page, PageTitle } from './Page';
import { SeasonRaffle } from '@/components/season/SeasonRaffle';
import { useSeason } from '@/state/season';
import { holdingKey, type SeasonPrize, type Tier } from '@/api/contract';
import { AlbumsGrid } from '@/components/albums/AlbumsGrid';
import { BinderDetail, type RareRef } from '@/components/albums/BinderDetail';
import { CardDetailSheet } from '@/components/albums/CardDetailSheet';
import { BurnGather } from '@/components/albums/BurnGather';
import { ExtrasCard, extrasIn, type Rect } from '@/components/albums/ExtrasCard';
import { PACK_COPY, suppressedCompletionCards } from '@/config/partnerPack';
import { useRitual } from '@/ritual/useRitual';
import { canStart } from '@/ritual/reducer';
import { PAGE, useSession } from '@/state/session';
import { useTabVisible } from '@/web/phoneWeb';
import { openCardSheet } from '@/navigation/sheetRoutes';
import { useEscapeToClose } from '@/ritual/useKeyboardBridge';

const fixed = { flexGrow: 0, flexShrink: 0 } as const;

/** Load the raffle once the session is up, and again when Albums is the focused page or the app returns to the foreground. */
function useSeasonWhileAlbums() {
  const { ready, page } = useSession();
  const { refresh } = useSeason();
  useEffect(() => {
    if (!ready) return;
    void refresh();
  }, [ready, refresh]);
  useEffect(() => {
    if (!ready || page !== PAGE.albums) return;
    void refresh();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refresh();
    });
    return () => sub.remove();
  }, [ready, page, refresh]);
}

export function AlbumsPage() {
  const { albums, holdings, extras: extrasCount, odds, setPage, partnerPacks, albumOpen, openAlbum, closeAlbum, page, balanceKnown } = useSession();
  const tabVisible = useTabVisible();
  const { season, raffleFocus } = useSeason();
  const [slab, setSlab] = useState<SeasonPrize | null>(null);
  useSeasonWhileAlbums();
  const { ritual, dispatch } = useRitual();
  useEscapeToClose(albumOpen !== null, closeAlbum); // album detail is inline state, not a Modal: RNW's Escape does not reach it (web only)
  const [burnFrom, setBurnFrom] = useState<Rect | null>(null);
  const [detail, setDetail] = useState<{ cardId: string; rarity?: Tier } | null>(null);
  const album = albumOpen ? albums.find((a) => a.id === albumOpen) ?? null : null;

  if (album) {
    const extras = extrasIn(album.cards, holdings);
    const hidden = suppressedCompletionCards(partnerPacks);
    const rares: RareRef[] = Object.values(holdings).flatMap((h) =>
      h.card && h.rarity && h.rarity !== 'common' && !hidden.has(h.cardId) ? [{ id: h.cardId, name: h.card.name, imgSmall: h.card.imgSmall, rarity: h.rarity }] : [],
    );
    // The detail sheet shows one holding line: a common by its card id, a rare shelf card by id and tier.
    const line = detail ? holdings[holdingKey({ cardId: detail.cardId, rarity: detail.rarity })] ?? null : null;
    const common = !detail?.rarity || detail.rarity === 'common';
    return (
      <Page>
        <BinderDetail
          album={album}
          holdings={holdings}
          extras={extras}
          rares={rares}
          canTarget={canStart(ritual)}
          onBack={closeAlbum}
          onTargetPull={(id) => { dispatch({ type: 'SET_TARGET', albumId: id }); setPage(PAGE.pull); }}
          onOpenCard={(cardId, rarity) => openCardSheet(cardId, rarity, (id, r) => setDetail({ cardId: id, rarity: r }))} // on the web the sheet is a route: Back closes it (W2.1)
          onPartnerPack={(id) => dispatch({ type: 'SHOW_TAKEOVER', albumId: id })}
          partnerPack={partnerPacks[album.id] ?? null}
        />
        <CardDetailSheet holding={line} album={common ? album : null} holdings={holdings} odds={odds} onClose={() => setDetail(null)} />
      </Page>
    );
  }
  const allExtras = extrasIn(albums.flatMap((a) => a.cards), holdings);
  return (
    <Page scrollToken={raffleFocus} overlay={ritual.phase === 'burning' && ritual.burnStep ? <BurnGather step={ritual.burnStep} extras={allExtras} from={burnFrom} /> : null}>
      <View style={fixed}>{season ? <SeasonRaffle season={season} onOpenPrize={setSlab} motion={page === PAGE.albums && balanceKnown && tabVisible} /> : null}</View>
      <View style={fixed}><PageTitle title="Albums" sub={PACK_COPY.albumsSub} /></View>
      <View style={fixed}><AlbumsGrid albums={albums} holdings={holdings} onOpen={openAlbum} /></View>
      <View style={fixed}>
        <ExtrasCard
          count={extrasCount}
          extras={allExtras}
          canBurn={canStart(ritual)}
          dimmed={ritual.phase === 'burning'}
          onMeasured={setBurnFrom}
          onBurn={() => dispatch({ type: 'BURN_STARTED' })}
        />
      </View>
      <CardDetailSheet holding={null} album={null} holdings={holdings} odds={odds} slab={slab} onClose={() => setSlab(null)} />
    </Page>
  );
}
