// Album SKUs: data/catalog/v0-albums.json, the same 75 rows as data/catalog/gachapon-v0-albums-75.csv (#313).
// POOLS are the design handoff's reverse/holo/ultra lists. They are not the pull pool: a pull draws album
// commons only. The holo list is the finite completion-reward vault, and forceTier still uses these pools
// so a reveal test can land a rare. Image URLs hotlink pokemontcg.io — dev only (ticket X.4).
import raw from '../../../data/design_cards.json';
import catalog from '../../../data/catalog/v0-albums.json';
import type { Album, AlbumCard, Tier } from '../contract';
import { TIER_VALUE_USD } from '../contract';

type RawCard = { id: string; name: string; set: string; number: string; rarity: string; types: string; img_small: string; img_large: string };
type CatalogCard = { id: string; slot: number; name: string; set: string; number: string; rarity: string; imgSmall: string; imgLarge: string };
type CatalogAlbum = { id: string; title: string; sub: string; cards: CatalogCard[] };
const data = raw as unknown as Record<string, RawCard[]>;
const live = catalog as { albums: CatalogAlbum[] };

function toAlbumCard(c: CatalogCard): AlbumCard {
  return { id: c.id, slot: c.slot, name: c.name, set: c.set, number: c.number, rarity: c.rarity, imgSmall: c.imgSmall, imgLarge: c.imgLarge };
}

export type PoolCard = { id: string; name: string; set: string; number: string; imgSmall: string; imgLarge: string };
const toPool = (c: RawCard): PoolCard => ({ id: c.id, name: c.name, set: c.set.toUpperCase(), number: c.number, imgSmall: c.img_small, imgLarge: c.img_large });

export const ALBUMS: Album[] = [
  ...live.albums.map((album) => ({
    id: album.id, title: album.title, sub: album.sub, coverUrl: album.cards[0].imgSmall,
    size: album.cards.length, status: 'live' as const, cards: album.cards.map(toAlbumCard),
  })),
  ...['Ember Grove', 'Cloud Meadow', 'Starlit Burrow', 'Mossy Hollow', 'Coral Court', 'Frost Peaks'].map<Album>((title, i) => ({
    id: `soon-${i + 1}`, title, sub: 'Coming soon', coverUrl: '', size: 25, status: 'soon', cards: [],
  })),
];

/** Not the pull pool. Completion claims draw a holo from here; forceTier can still land a rare for a reveal test. */
export const POOLS: Record<Exclude<Tier, 'common' | 'graded'>, PoolCard[]> = {
  reverse: data.uncommons.map(toPool),
  holo: data.holo_rares.map(toPool),
  ultra: data.ultra_illustration.map(toPool),
};

/** What GET /albums/:id/availability reports for an album SKU that has no finite override. Not a vault count. */
export const INFINITE_ALBUM_COPIES = 1_000_000_000;

/** Published $1 odds. v0 pulls are album commons only (product lock, #316): one row at 100%.
 *  Reverse / holo / ultra / graded are not pull members. Album complete claims a Jupiter gift, not a holo. */
export const PAID_ODDS: { tier: Tier; label: string; pct: number; valueUsd: number }[] = [
  { tier: 'common', label: 'Album card', pct: 1, valueUsd: TIER_VALUE_USD.common },
];

/** Burn credit: album commons only. */
export const FREE_ODDS: { tier: Tier; label: string; pct: number; valueUsd: number }[] = [
  { tier: 'common', label: 'Album card', pct: 1, valueUsd: TIER_VALUE_USD.common },
];

/** Finite pools only. Album P1 has no starting count — see INFINITE_ALBUM_COPIES. */
export const INITIAL_STOCK = { reverse: 40, holo: 12, ultra: 4, graded: 1 } as const;
