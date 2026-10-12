// Soft-launch album-complete prize (#341). One constant names the placeholder partner.
// Swap it later; nothing here is a live Jupiter (or other) mint, purchase, or redeem link.
// The $100 Degen shelf is the locked shape. Do not retune it to a cheaper SKU in this file.

export const placeholderPartner = 'jupiter-degen' as const;

/** Where a gifted pack is opened. Product-locked soft-launch link (#402). */
export const JUPITER_GACHA_OPEN_URL = 'https://jup.ag/gacha';

/** https://jup.ag/… only. A bad server value still opens the locked page. */
export function safeJupiterOpenUrl(raw: string | undefined | null): string {
  if (!raw) return JUPITER_GACHA_OPEN_URL;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return JUPITER_GACHA_OPEN_URL;
    if (url.hostname !== 'jup.ag' && url.hostname !== 'www.jup.ag') return JUPITER_GACHA_OPEN_URL;
    return url.toString();
  } catch {
    return JUPITER_GACHA_OPEN_URL;
  }
}

export type PlaceholderPartner = 'jupiter-degen' | 'jupiter-trainer' | 'generic';

/** Entitlement recorded against the Privy embedded deposit wallet (`Me.wallet`). Not an on-chain mint.
 *  Claim writes it immediately. There is no in-app open. */
export type PartnerPackCredit = {
  kind: 'pack-credit';
  partner: PlaceholderPartner;
  albumId: string;
  wallet: string;
  /**
   * Card id the completion ledger used to materialize. The prize UI hides it.
   * New claims do not set it: the reward is the Jupiter gift, not a holo (#402).
   */
  suppressedCardId?: string;
  packType?: string;
  count?: number;
  openUrl?: string;
  giftId?: string;
  signature?: string;
};

const NAMED: Record<Exclude<PlaceholderPartner, 'generic'>, { mark: string; tier: string; sub: string }> = {
  'jupiter-degen': { mark: 'JUPITER', tier: 'DEGEN', sub: 'Jupiter Degen pack' },
  'jupiter-trainer': { mark: 'JUPITER', tier: 'TRAINER', sub: 'Jupiter Trainer pack' },
};

export function partnerPackFace(partner: PlaceholderPartner = placeholderPartner) {
  if (partner === 'generic') return { mark: 'PARTNER', tier: 'PACK', sub: 'Partner pack' };
  return NAMED[partner];
}

export const PACK_COPY = {
  completeBody: 'Every slot filled. A free Degen pack pull is ready.',
  claim: 'Claim pack',
  claiming: 'Claiming…',
  open: 'Open on Jupiter',
  creditedTitle: 'Degen pack credited',
  creditedBody: 'You have a free Degen pack pull with Jupiter. Open it on Jupiter gacha.',
  done: 'Done',
  binderReady: 'A free Degen pack pull is ready',
  binderCredited: 'Free Degen pack pull credited. Open it on Jupiter gacha.',
  queued: 'Your Degen pack pull is queued. It stays yours until it can be issued.',
  already: 'Your Degen pack pull for this album is already claimed.',
  albumsSub: 'Fill an album for a free Degen pack pull. The album stays yours.',
  onboardTitle: 'Finish an album, unlock a pack',
  onboardBody: 'A completed album unlocks a partner pack — a free Degen pack pull with Jupiter. Open it on Jupiter gacha.',
} as const;

/** Card ids the binder must not present as the completion prize while a pack credit exists. */
export function suppressedCompletionCards(packs: Readonly<Record<string, PartnerPackCredit>>): Set<string> {
  const ids = new Set<string>();
  for (const pack of Object.values(packs)) if (pack.suppressedCardId) ids.add(pack.suppressedCardId);
  return ids;
}
