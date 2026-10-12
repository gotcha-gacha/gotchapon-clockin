// Marquee ticker content (F5.5, design tickerLines): published odds, the user's own session, and other collectors' pulls,
// interleaved one of each in turn. At launch (flags.socialTicker 'launch') there is no social feed, so it is published odds
// and the user's own pulls only. Every number comes from the API; nothing is made up for the marquee.
import type { Album, Holding, Odds, Outcome } from '@/api/contract';
import { albumProgress } from '@/components/albums/AlbumsGrid';

export const TICKER_SEP = '   ·   ';

/** One of each list in turn (odds, you, social), joined and ending in a separator so the loop reads on. */
export function tickerText(odds: string[], you: string[], social: string[] = []): string {
  const out: string[] = [];
  for (let i = 0; i < Math.max(odds.length, you.length, social.length); i++) {
    if (odds[i]) out.push(odds[i]);
    if (you[i]) out.push(you[i]);
    if (social[i]) out.push(social[i]);
  }
  return out.join(TICKER_SEP) + TICKER_SEP;
}

/** Paid tier odds from /odds, kept short enough to read while the marquee moves. */
export function oddsFacts(odds: Odds | null): string[] {
  if (!odds) return []; // #332: the sleeve is hidden, so the marquee does not invite a tap for odds
  return odds.paid.rows.map((row) => {
    const chance = row.pct * 100;
    return `${row.label}: ${chance.toFixed(chance < 1 ? 2 : 1)}%`;
  });
}

/** The user's own session: the last two pulls, album progress, and how many cards they hold.
 *  `focusAlbumId` is the chase: progress is that album only, worded as held-of-total, and the caller
 *  passes a marquee list that was cleared when the chase started. */
export function sessionFacts(recent: Outcome[], holdings: Record<string, Holding>, albums: Album[], focusAlbumId?: string): string[] {
  const you: string[] = [];
  if (recent[0]) you.push(`you pulled ${recent[0].card.name}${recent[1] ? ` · before that ${recent[1].card.name}` : ''}`);
  const open = albums.filter((a) => a.status !== 'soon' && (!focusAlbumId || a.id === focusAlbumId));
  const progressed = open
    .map((a) => ({ a, ...albumProgress(a, holdings) }))
    .filter((x) => x.have > 0 && !x.done);
  const near = focusAlbumId ? progressed[0] : progressed.sort((x, y) => y.have - x.have)[0];
  if (near) you.push(focusAlbumId ? `${near.have} of ${near.total} in ${near.a.title}` : `${near.total - near.have} missing in ${near.a.title}`);
  const held = Object.values(holdings).reduce((n, h) => n + h.qty, 0);
  if (held) you.push(`${held} cards held by you`);
  return you;
}
