// The FE/BE seam — docs/BUILD_PLAN.md §2 (v2) as amended by docs/DESIGN_RECONCILIATION.md §4.
// Money crosses the wire in USDC base units (6 dp); the UI speaks dollars. Every state-changing
// POST carries an idempotency key. Field names match the contract verbatim so Dev 2's server and
// the in-app mock are interchangeable.

export type Tier = 'common' | 'reverse' | 'holo' | 'ultra' | 'graded';
/** Reference value per tier at the $1 price (model Odds sheet): the "about $X" copy and the vault value. */
export const TIER_VALUE_USD: Record<Tier, number> = { common: 0.05, reverse: 0.3, holo: 1.5, ultra: 12, graded: 60 };
export type Asset = 'USDC' | 'USDT';
export type PullCount = 1 | 5 | 10;

export type Me = {
  id: string;
  wallet: string;
  country: string;
  freePulls: number;
  createdAt: string;
};

/** Read from chain, cached ≤ 5 s. `usdc`/`usdt` are base units (6 dp). `pulls = floor((usdc+usdt)/1e6)`. */
export type Balance = { usdc: number; usdt: number; pulls: number };

/** One line per (cardId, rarity): the same card can be held as an ultra print and as a graded slab, and
 *  those are different items with different serials. `card` / `rarity` are contract additions (like
 *  `Outcome.card`): the binder's rares shelf needs the card behind a pool holding that is not an album
 *  slot. Dev 2: fill them from the ledger's card table; a holding without `rarity` is valued as unknown. */
export type Holding = { cardId: string; qty: number; itemIds?: string[]; serials?: string[]; card?: CardRef; rarity?: Tier };
/** Client map key for a holding line. Album commons keep the bare cardId so album lookups stay `holdings[card.id]`. */
export const holdingKey = (h: Pick<Holding, 'cardId' | 'rarity'>): string => (h.rarity && h.rarity !== 'common' ? `${h.cardId}#${h.rarity}` : h.cardId);
/** Index holding lines by `holdingKey`. A depleted line (qty 0) is not held and is dropped. Lines that share a
 *  key (a server omitting `rarity` on two tiers of one card) are merged — qty added, serials joined, rarity
 *  kept only when both agree — never silently overwritten. */
export function indexHoldings(list: Holding[]): Record<string, Holding> {
  const out: Record<string, Holding> = {};
  for (const h of list) {
    if (!(h.qty > 0)) continue;
    const k = holdingKey(h);
    const prev = out[k];
    if (!prev) { out[k] = h; continue; }
    const itemIds = [...(prev.itemIds ?? []), ...(h.itemIds ?? [])];
    const serials = [...(prev.serials ?? []), ...(h.serials ?? [])];
    out[k] = { cardId: prev.cardId, qty: prev.qty + h.qty, itemIds: itemIds.length ? itemIds : undefined,
      serials: serials.length ? serials : undefined, card: prev.card ?? h.card,
      rarity: prev.rarity === h.rarity ? prev.rarity : undefined };
  }
  return out;
}

export type AlbumCard = {
  id: string; // ledger key, e.g. "sv3-76"
  slot: number; // 1..size
  name: string;
  set: string;
  number: string;
  rarity: string;
  imgSmall: string;
  imgLarge: string;
};

export type Album = {
  id: string;
  title: string;
  sub: string;
  coverUrl: string; // the album's cover card, shown as a card
  size: number; // 25
  cards: AlbumCard[];
  status: 'live' | 'soon' | 'restocking';
};

export type Availability = Record<string, number>; // cardId → available copies

export type OddsRow = { tier: Tier; label: string; pct: number; valueUsd: number };
export type OddsTable = { price: number; targetedPrice?: number; evPct: number; rows: OddsRow[] };
export type Odds = {
  paid: OddsTable;
  free: OddsTable; // burn credit: commons only
  refreshedAt: string;
  stock: { perAlbum: Record<string, { live: number; total: number }>; holosLeft: number };
  nextRestock: string;
};

export type Transfer = { to: string; mint: string; amount: number; memo: string; transactionBase64?: string };

/** Every gacha has explicit inventory membership. Memberships may overlap; the
 * same finite stock unit is still allocatable only once across all gachas. */
export type PullPrepareRequest = {
  /** Explicit inventory and odds selection; the API has no global default gacha. */
  gachaId: string;
  /** Required for an album chase and must match the selected gacha's album. A chase draws any card in that album. */
  albumId?: string;
  count: PullCount;
  targeted: boolean;
  asset: Asset;
  idem: string;
  /** 32 random bytes as hex/base64url. The live session supplies this; optional for older clients. */
  clientSeed?: string;
};
export type PullPrepareResponse = {
  pullId: string;
  costUsd: number;
  useFreePulls: number;
  transfer?: Transfer; // absent when free pulls cover it
  expiresAt: string;
  /** A pull drawn by MagicBlock VRF (#406): the one sequence it is drawn under and its frozen pool's hash, given before the
   *  user pays. The app keeps it (state/drawReceipts) so the draw can later be checked against what was promised. */
  draw?: DrawCommitment;
};
export type DrawCommitment = { source: 'magicblock'; sequence: number; poolHash: string };
/** GET /pulls/:id/draw, the part the app reads (#418): which draw decided the pull and, for a MagicBlock one, the cluster and
 *  the fulfilment transaction it can link. The full view (pool, randomness, outcomes) is for the verifier. */
export type PullDrawView = { pullId: string; source: 'magicblock' | 'ecvrf'; cluster?: string | null; fulfilSignature?: string | null };

/** What the reveal needs about a card; album cards also live in /albums, gacha-only cards only here. */
export type CardRef = { id: string; name: string; set: string; number: string; imgSmall: string; imgLarge: string };
export type Outcome = { inventoryItemId?: string; cardId: string; rarity: Tier; serial?: string; isDupe: boolean; albumId?: string; card: CardRef };

export type PullCommitRequest = { pullId: string; txSignature?: string; signedTransactionBase64?: string };
/** Season One raffle 6a. Soft-launch stub: five PSA 10 slabs, no live stock. */
export type SeasonPrize = {
  slot: 'grand' | 'mid';
  cardId: string;
  name: string;
  set: string;
  number: string;
  grade: 'PSA 10';
  cert: string;
  /** Official face for the soft-launch stub. Vault slab photos replace this later. */
  photo: string;
};
/** Paid streak on the raffle (#376, #375). count is 0–4. Hitting 5 grants tickets and stores 0. */
export type SeasonStreak = { count: number; countedToday: boolean };
/** GET /me/streak (#375). `bonusJustEarned` is the day a hit-5 stored 0; the header shows that as 5/5. */
export type MeStreak = SeasonStreak & { bonusJustEarned: boolean; resetsAt: string };
export type Season = {
  id: string;
  title: string;
  drawAt: string;
  prizes: SeasonPrize[];
  myTickets: number;
  streak: SeasonStreak;
};

export type PullCommitResponse = {
  outcomes: Outcome[];
  extras: number;
  freePulls: number;
  /** Raffle tickets this pull added. Paid slots only; a free pull is 0. The streak bonus is not included. */
  ticketsEarned: number;
  /** +2 on the pull that reaches streak day 5, otherwise 0. Once per cycle, not × the day's dollars. */
  streakBonus: 0 | 2;
  /** This binder's tickets after the grant, including a streak bonus. */
  myTickets: number;
  /** Streak after this pull. count is 0–4; a hit-5 is `{ count: 0, countedToday: true }` with streakBonus 2. */
  streak: SeasonStreak;
  albumCompleted?: string;
  /** Absent when the server could not read the wallet's balance after settling the pull (#277: that read is best-effort, so a
   *  balance display never fails a paid pull), and on an idempotent replay. The app then reads the balance itself. */
  balance?: Balance;
};

export type BurnRequest = { idem: string };
/** Five extras credit one free pull. No card is awarded here; the pull is a later crank (#294). */
export type BurnResponse = { extras: number; freePulls: number; balance?: Balance };

export type CompletionClaimRequest = { albumId: string; idem: string };
/** A confirmed house-funded Jupiter gift. `outcomes` stays empty: Claim does not award a holo (#402). */
export type CompletionGift = {
  status: 'confirmed';
  packType: string;
  count: number;
  giftId?: string;
  signature?: string;
  receiver: string;
  openUrl: string;
};
export type CompletionClaimResponse = { outcomes: Outcome[]; gift?: CompletionGift };

export type AccountDeleteResponse = { graceUntil: string };
/** `wallet`: where the account's one grant went (#276). `alreadyClaimed`: this call sent nothing new, because the grant was
 *  already sent, or is promised to another of the account's wallets. Whether it went elsewhere is `wallet` ≠ the wallet asked for. */
export type FaucetClaimResponse = { asset: 'USDC'; amount: number; signature: string; alreadyClaimed: boolean; wallet?: string };
export type FaucetClaimRequest = { wallet?: string };
export type DepositBuildRequest = { sourceWallet: string; amount: number; idem: string };
export type DepositBuildResponse = {
  depositId: string;
  asset: 'USDC';
  amount: number;
  destination: string;
  transactionBase64: string;
  expiresAt: string;
  status: 'prepared' | 'signed' | 'committed';
  signature?: string;
};
export type DepositSubmitRequest = { depositId: string; signedTransactionBase64?: string; idem: string };
export type DepositSubmitResponse = { depositId: string; asset: 'USDC'; amount: number; destination: string; signature: string };
export type FundingConfig = { methods: ['transfer']; assets: Asset[]; network: 'solana'; minimum: 0; depositAddress: string;
  /** `wallet`: where the account's one grant was sent, once it has been (#304). */
  faucet?: { asset: 'USDC'; amount: number; claimed: boolean; wallet?: string } };
/** Liveness only (#277): the ledger check is the admin's `/admin/ledger`, so `/health` makes no ledger claim. */
export type Health = { ok: boolean; rpc: 'ok' | 'degraded' | 'down' };

export type ApiErrorCode =
  | 'INSUFFICIENT_FUNDS'
  | 'RESTOCKING'
  | 'TX_NOT_FOUND'
  | 'TX_MISMATCH'
  | 'EXPIRED'
  | 'GEO_BLOCKED'
  | 'UNAUTHENTICATED'
  | 'NETWORK'
  /** Client-side, like NETWORK: the request went out and the answer came back unreadable, so whether it landed is unknown. */
  | 'UNREADABLE'
  | 'UNKNOWN';

export type ApiErrorBody = { code: ApiErrorCode; message: string; hint?: string };

/** One method per endpoint. Screens never call fetch; they call this through the AppProvider. */
export interface GachaApi {
  me(): Promise<Me>;
  balance(): Promise<Balance>;
  holdings(): Promise<Holding[]>;
  extras(): Promise<{ count: number }>;
  albums(): Promise<Album[]>;
  availability(albumId: string): Promise<Availability>;
  odds(gachaId: string): Promise<Odds>;
  season(): Promise<Season>;
  streak(): Promise<MeStreak>;
  preparePull(req: PullPrepareRequest): Promise<PullPrepareResponse>;
  commitPull(req: PullCommitRequest): Promise<PullCommitResponse>;
  pullDraw(pullId: string): Promise<PullDrawView>;
  burn(req: BurnRequest): Promise<BurnResponse>;
  claimCompletion(req: CompletionClaimRequest): Promise<CompletionClaimResponse>;
  deleteAccount(): Promise<AccountDeleteResponse>;
  fundingConfig(): Promise<FundingConfig>;
  claimFaucet(req?: FaucetClaimRequest): Promise<FaucetClaimResponse>;
  buildDeposit(req: DepositBuildRequest): Promise<DepositBuildResponse>;
  submitDeposit(req: DepositSubmitRequest): Promise<DepositSubmitResponse>;
  health(): Promise<Health>;
}

export const USDC_BASE = 1_000_000;
export const INVENTORY_GACHA_ID = 'all-cards';
export const PULL_PRICE_USD = 1;
export const TARGETED_PRICE_USD = 1.5;
/** What a pull costs from the balance: a chase is N × the album rate and never spends free pulls; a $1 pull spends free
 *  pulls first. The machine's price line and the ritual's check of the server's quote both use it. */
export function pullCostUsd(count: PullCount, targeted: boolean, freePulls: number): number {
  if (targeted) return TARGETED_PRICE_USD * count;
  return PULL_PRICE_USD * (count - Math.min(count, freePulls));
}
/** Pulls the dial shows, and, while chasing, the tray plate. A chase is $1.50 and ignores free pulls.
 *  A $1 pull adds free pulls on the dial; the plate names those on their own line. */
export function pullsAvailable(balanceUsd: number, freePulls: number, targeted: boolean): number {
  if (targeted) return Math.floor(Math.round(balanceUsd * 100) / Math.round(TARGETED_PRICE_USD * 100));
  return Math.floor(balanceUsd) + freePulls;
}
export const BURN_COST = 5;
export const ALBUM_SIZE = 25;
