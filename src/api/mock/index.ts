// In-app mock of the BUILD_PLAN §2 contract (F0.3). Same interface as the HTTP client, so swapping
// to Dev 2's server is a one-line change in src/api/index.ts. Keeps the product rules the server
// keeps: the outcome is rolled at commit (never at prepare), a finite card is never allocated beyond
// its vault, album P1 stock is infinite (#313), a signature never resolves twice, prepare→commit is
// idempotent on pullId.
import type {
  Album, ApiErrorCode, Availability, Balance, BurnRequest, BurnResponse, CardRef, CompletionClaimRequest,
  CompletionClaimResponse, FundingConfig, GachaApi, Health,
  Holding, Me, MeStreak, Odds, Outcome, PullCommitRequest, PullCommitResponse, PullDrawView, PullPrepareRequest, PullPrepareResponse, Season, Tier,
} from '../contract';
import { ALBUM_SIZE, BURN_COST, INVENTORY_GACHA_ID, PULL_PRICE_USD, TARGETED_PRICE_USD, USDC_BASE, holdingKey } from '../contract';
import { ApiError } from '../errors';
import { SEASON_DRAW_AT, SEASON_ID, SEASON_PRIZES, SEASON_TITLE, ticketsEarnedForPull } from '../../season/catalog';
import { advancePaidStreak, meStreak, visibleStreak, type StreakState } from '../../season/streak';
import { JUPITER_GACHA_OPEN_URL } from '@/config/partnerPack';
import { ALBUMS, FREE_ODDS, INFINITE_ALBUM_COPIES, INITIAL_STOCK, PAID_ODDS, POOLS } from './fixtures';

export type MockOptions = { latencyMs?: number; now?: () => number; seed?: string };
export type MockDev = {
  deposit(usd: number): void;
  /** Finite override for one key. `null` drops it, so an album SKU is infinite again. Pool keys stay finite. */
  setStock(cardId: string, available: number | null): void;
  forceTier(tier: Tier | null): void;
  /** The design's withdraw is a transfer out of the user's own wallet (Privy, F7.4); the mock just debits.
   *  Idempotent on `idem`: a retry of the same intent never debits twice. */
  withdraw(usd: number, idem: string): void;
  reset(): void;
  state(): { balanceUsd: number; freePulls: number; extras: number; held: number };
  /** Test seam only. A new session starts at 0 free pulls (#292); nothing in the app calls this.
   *  The credited pulls use paid odds so a test can force a tier. */
  creditFree(count: number): void;
};
export type MockApi = GachaApi & { dev: MockDev };

type FreeKind = 'paid-odds' | 'commons-only';
type MockGacha = { id: string; albumId?: string; supportsTargeted: boolean };
type Prepared = { req: PullPrepareRequest; gacha: MockGacha; res: PullPrepareResponse; committed?: PullCommitResponse; txSignature?: string; reserved: FreeKind[] };

const fail = (code: ApiErrorCode, message: string, hint?: string) => new ApiError({ code, message, hint });
/** Dev hook only. Published odds are album commons; reveal tests still force a rare on a paid-odds pull.
 *  A commons-only pull (a burn credit) honours a forced tier only when its table lists it. */
const PAID_FORCE_TIERS: readonly Tier[] = ['common', 'reverse', 'holo', 'ultra', 'graded'];
const dayKey = (t: number) => new Date(t + 8 * 3.6e6).toISOString().slice(0, 10); // UTC+8 day boundary

/** The wallet every mock surface shows (#185). It is not an address: the hyphens are outside base58, so nothing can decode
 *  it, and a wallet app handed it refuses rather than sending somewhere. It replaced a plausible-looking 42-character string
 *  that a tester could have pasted into a real wallet — which, since it decodes to 31 bytes rather than a key's 32, would
 *  have been money sent nowhere recoverable if any wallet had taken it. The screens do not show it (`WalletPage` hides the
 *  whole deposit card on a mock build); this is the second line, for any surface that prints a wallet anyway — the account
 *  sheet does. */
export const DEMO_WALLET = 'DEMO-WALLET-DO-NOT-SEND';

// Deterministic per-pull randomness keeps development and tests reproducible.
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function createMockApi(opts: MockOptions = {}): MockApi {
  const now = opts.now ?? (() => Date.now());
  const latency = opts.latencyMs ?? 120;
  const seed = opts.seed ?? 'gachapon-dev-seed';

  // ---- ledger state -------------------------------------------------------------------------
  let stock = new Map<string, number>();
  // One line per (cardId, rarity) — see `Holding` in the contract. Commons are keyed by the bare cardId.
  let holdings = new Map<string, { cardId: string; qty: number; serials: string[]; card: CardRef; rarity: Tier }>();
  let withdrawals = new Set<string>();
  let extrasByCard = new Map<string, number>();
  let balanceBase = 0;
  let freeQueue: FreeKind[] = [];
  let paidStreak: StreakState = { count: 0, lastDay: null };
  let completed = new Set<string>();
  let claimedRewards = new Map<string, CompletionClaimResponse>(); // album id → the gift it recorded
  let claims = new Map<string, CompletionClaimResponse>(); // idem → the answer it got
  let burns = new Map<string, BurnResponse>(); // idem → the burn it made
  let prepared = new Map<string, Prepared>();
  let signatures = new Map<string, string>(); // txSignature → pullId
  let forced: Tier | null = null;
  let counter = 0;
  let seasonTickets = 0;

  function reset() {
    stock = new Map();
    // Album SKUs are absent: that is infinite P1. A test's setStock installs a finite override.
    for (const c of POOLS.reverse) stock.set(`pool:reverse:${c.id}`, INITIAL_STOCK.reverse);
    for (const c of POOLS.holo) stock.set(`pool:holo:${c.id}`, INITIAL_STOCK.holo);
    for (const c of POOLS.ultra) stock.set(`pool:ultra:${c.id}`, INITIAL_STOCK.ultra);
    stock.set('pool:graded', INITIAL_STOCK.graded);
    holdings = new Map(); extrasByCard = new Map(); balanceBase = 0; withdrawals = new Set();
    freeQueue = []; // no sign-up grant (#292). Free pulls are burns.
    paidStreak = { count: 0, lastDay: null };
    completed = new Set(); claimedRewards = new Map(); claims = new Map(); burns = new Map(); prepared = new Map(); signatures = new Map();
    forced = null; counter = 0; seasonTickets = 0;
  }
  reset();

  const sleep = () => new Promise<void>((r) => setTimeout(r, latency));
  const extras = () => [...extrasByCard.values()].reduce((a, b) => a + b, 0);
  const heldTotal = () => [...holdings.values()].reduce((a, h) => a + h.qty, 0);
  const balance = (): Balance => ({ usdc: balanceBase, usdt: 0, pulls: Math.floor(balanceBase / USDC_BASE) }); // the mock only ever credits USDC
  const liveAlbums = () => ALBUMS.filter((a) => a.status === 'live');
  const gachas = (): MockGacha[] => [
    { id: INVENTORY_GACHA_ID, supportsTargeted: false },
    ...liveAlbums().map((album) => ({ id: `album:${album.id}`, albumId: album.id, supportsTargeted: true })),
  ];
  const resolveGacha = (req: PullPrepareRequest): MockGacha => {
    if (req.albumId) {
      const album = ALBUMS.find((candidate) => candidate.id === req.albumId);
      if (!album) throw fail('UNKNOWN', 'No such album');
      if (album.status !== 'live') throw fail('RESTOCKING', 'That album is not open yet');
    }
    const gacha = gachas().find((item) => item.id === req.gachaId);
    if (!gacha) throw fail('RESTOCKING', 'That gacha is not available');
    if (req.albumId && gacha.albumId !== req.albumId) throw fail('UNKNOWN', 'That gacha does not belong to the selected album');
    if (req.targeted && !gacha.supportsTargeted) throw fail('UNKNOWN', 'That gacha does not support album pulls');
    return gacha;
  };
  const distinctHeld = (a: Album) => a.cards.filter((c) => (holdings.get(c.id)?.qty ?? 0) > 0).length;
  /** Copies left. An album SKU with no override is infinite. */
  const copiesOf = (cardId: string) => (stock.has(cardId) ? stock.get(cardId)! : Number.POSITIVE_INFINITY);
  /** In-stock cards. A chase does not drop cards the user already holds (#391). */
  const availableIn = (a: Album) => a.cards.filter((c) => copiesOf(c.id) > 0);

  function allocate(key: string) {
    if (!stock.has(key)) {
      if (key.startsWith('pool:')) throw fail('RESTOCKING', 'That card is restocking');
      return; // album P1: nothing to decrement
    }
    const n = stock.get(key) ?? 0;
    if (n <= 0) throw fail('RESTOCKING', 'That card is restocking');
    stock.set(key, n - 1);
  }
  function hold(cardId: string, card: CardRef, rarity: Tier, serial?: string) {
    const k = holdingKey({ cardId, rarity });
    const h = holdings.get(k) ?? { cardId, qty: 0, serials: [], card, rarity };
    h.qty += 1; if (serial) h.serials.push(serial);
    holdings.set(k, h);
  }
  /** Every gacha has explicit membership; stock remains canonical when memberships overlap. */
  function rollOne(p: Prepared, index: number, kind: 'paid' | FreeKind): Outcome {
    const rnd = mulberry32(fnv1a(`${seed}:${dayKey(now())}:${p.res.pullId}:${index}`));
    const allowed: readonly Tier[] = kind === 'commons-only' ? FREE_ODDS.map((row) => row.tier) : PAID_FORCE_TIERS;
    // The live pull pool is the 75 album SKUs. Published odds are that pool at 100%. An unforced roll
    // stays on the album. forceTier is the dev hook reveal tests use to land a rare on a paid-odds pull.
    let tier: Tier = forced && allowed.includes(forced) ? forced : 'common';
    const poolHas = (t: Tier) => (t === 'graded' ? (stock.get('pool:graded') ?? 0) > 0 : t === 'common' ? true : POOLS[t].some((c) => (stock.get(`pool:${t}:${c.id}`) ?? 0) > 0));
    if (!poolHas(tier)) tier = 'common';

    if (tier === 'common') {
      const albumGacha = p.gacha.albumId;
      const candidates = albumGacha
        ? [{ album: liveAlbums().find((a) => a.id === albumGacha)!, cards: [] as Album['cards'] }].map((x) => ({ album: x.album, cards: availableIn(x.album) }))
        : liveAlbums().map((a) => ({ album: a, cards: availableIn(a) })).filter((x) => x.cards.length > 0);
      const pick = candidates.filter((x) => x.cards.length > 0);
      if (!pick.length) throw fail('RESTOCKING', 'That gacha is restocking');
      const { album, cards } = pick[Math.floor(rnd() * pick.length)];
      const card = cards[Math.floor(rnd() * cards.length)];
      allocate(card.id);
      const isDupe = (holdings.get(card.id)?.qty ?? 0) > 0;
      const ref: CardRef = { id: card.id, name: card.name, set: card.set, number: card.number, imgSmall: card.imgSmall, imgLarge: card.imgLarge };
      hold(card.id, ref, 'common');
      if (isDupe) extrasByCard.set(card.id, (extrasByCard.get(card.id) ?? 0) + 1);
      return { cardId: card.id, rarity: 'common', isDupe, albumId: album.id, card: ref };
    }
    if (tier === 'graded') {
      allocate('pool:graded');
      const card = POOLS.ultra[Math.floor(rnd() * POOLS.ultra.length)];
      const serial = `PG95-${String(42137 + counter++).padStart(7, '0')}`;
      hold(card.id, card, 'graded', serial);
      return { cardId: card.id, rarity: 'graded', serial, isDupe: false, card };
    }
    const pool = POOLS[tier].filter((c) => (stock.get(`pool:${tier}:${c.id}`) ?? 0) > 0);
    const card = pool[Math.floor(rnd() * pool.length)];
    allocate(`pool:${tier}:${card.id}`);
    const serial = tier === 'holo' || tier === 'ultra' ? `${tier.toUpperCase()}-${String(1000 + counter++)}` : undefined;
    hold(card.id, card, tier, serial);
    return { cardId: card.id, rarity: tier, serial, isDupe: false, card };
  }

  function costFor(req: PullPrepareRequest) {
    const each = req.targeted ? TARGETED_PRICE_USD : PULL_PRICE_USD;
    return each * req.count;
  }

  /** One DB transaction on the server: nothing is charged or allocated unless every outcome lands. `before` runs inside the same snapshot (the burn's extras → vault transfer). */
  function commit(p: Prepared, before?: () => void): Omit<PullCommitResponse, 'ticketsEarned' | 'streakBonus' | 'myTickets' | 'streak'> {
    const kinds: ('paid' | FreeKind)[] = [];
    for (let i = 0; i < p.req.count; i++) kinds.push(p.reserved[i] ?? 'paid');
    const chargeBase = Math.round(p.res.costUsd * USDC_BASE);
    if (chargeBase > 0 && balanceBase < chargeBase) throw fail('INSUFFICIENT_FUNDS', 'Out of pulls');
    const snap = {
      stock: new Map(stock),
      holdings: new Map([...holdings].map(([k, v]) => [k, { ...v, serials: [...v.serials] }])),
      extras: new Map(extrasByCard),
      completed: new Set(completed),
      counter,
    };
    try {
      before?.();
      const outcomes = kinds.map((k, i) => rollOne(p, i, k));
      balanceBase -= chargeBase; // the transfer, simulated — only once every roll succeeded
      p.reserved = [];
      let albumCompleted: string | undefined;
      for (const a of liveAlbums()) {
        if (!completed.has(a.id) && distinctHeld(a) === ALBUM_SIZE) { completed.add(a.id); albumCompleted = a.id; }
      }
      return { outcomes, extras: extras(), freePulls: freeQueue.length, albumCompleted, balance: balance() };
    } catch (e) {
      stock = snap.stock; holdings = snap.holdings; extrasByCard = snap.extras; completed = snap.completed; counter = snap.counter;
      throw e;
    }
  }

  /** A prepared pull that never committed gives its reserved free pulls back. */
  function releaseReservation(p: Prepared) {
    if (p.reserved.length) { freeQueue.unshift(...p.reserved); p.reserved = []; }
  }
  /** Hand off the crank and the server hears nothing: expired reservations return on the next read. */
  function sweepExpired() {
    for (const p of prepared.values()) if (!p.committed && now() > Date.parse(p.res.expiresAt)) releaseReservation(p);
  }

  const api: MockApi = {
    async me(): Promise<Me> {
      await sleep();
      sweepExpired();
      return { id: 'me', wallet: DEMO_WALLET, country: 'MY', freePulls: freeQueue.length, createdAt: new Date(now()).toISOString() };
    },
    async balance() { await sleep(); sweepExpired(); return balance(); },
    async holdings(): Promise<Holding[]> { await sleep(); return [...holdings.values()].map((h) => ({ cardId: h.cardId, qty: h.qty, serials: h.serials.length ? h.serials : undefined, card: h.card, rarity: h.rarity })); },
    async extras() { await sleep(); return { count: extras() }; },
    async albums() { await sleep(); return ALBUMS; },
    async availability(albumId): Promise<Availability> {
      await sleep();
      const a = ALBUMS.find((x) => x.id === albumId);
      if (!a) throw fail('UNKNOWN', 'No such album');
      return Object.fromEntries(a.cards.map((c) => [c.id, stock.has(c.id) ? stock.get(c.id)! : INFINITE_ALBUM_COPIES]));
    },
    async season(): Promise<Season> {
      await sleep();
      const today = dayKey(now());
      return {
        id: SEASON_ID, title: SEASON_TITLE, drawAt: SEASON_DRAW_AT, prizes: SEASON_PRIZES.map((prize) => ({ ...prize })),
        myTickets: seasonTickets, streak: visibleStreak(paidStreak, today, dayKey(now() - 24 * 3.6e6)),
      };
    },
    async streak(): Promise<MeStreak> {
      await sleep();
      return meStreak(paidStreak, dayKey(now()), dayKey(now() - 24 * 3.6e6), now());
    },
    async odds(gachaId): Promise<Odds> {
      await sleep();
      if (!gachas().some((gacha) => gacha.id === gachaId)) throw fail('RESTOCKING', 'That gacha is not available');
      const ev = (rows: typeof PAID_ODDS) => rows.reduce((s, r) => s + r.pct * r.valueUsd, 0);
      const perAlbum = Object.fromEntries(liveAlbums().map((a) => [a.id, { live: availableIn(a).length, total: a.cards.length }]));
      return {
        paid: { price: PULL_PRICE_USD, targetedPrice: TARGETED_PRICE_USD, evPct: ev(PAID_ODDS), rows: PAID_ODDS },
        free: { price: 0, evPct: ev(FREE_ODDS), rows: FREE_ODDS },
        refreshedAt: new Date(now()).toISOString(),
        stock: { perAlbum, holosLeft: POOLS.holo.reduce((s, c) => s + (stock.get(`pool:holo:${c.id}`) ?? 0), 0) },
        nextRestock: 'Friday 8pm MYT',
      };
    },
    async preparePull(req): Promise<PullPrepareResponse> {
      await sleep();
      const gacha = resolveGacha(req);
      if (gacha.albumId) {
        const album = ALBUMS.find((a) => a.id === gacha.albumId);
        if (!album) throw fail('UNKNOWN', 'No such album');
        if (album.status !== 'live') throw fail('RESTOCKING', 'That album is not open yet');
      }
      const existing = [...prepared.values()].find((p) => p.req.idem === req.idem);
      if (existing) return existing.res;
      // One pull in flight per user: a new prepare supersedes every older one that never committed.
      for (const p of prepared.values()) {
        if (!p.committed) { releaseReservation(p); p.res.expiresAt = new Date(now() - 1).toISOString(); }
      }
      const cost = costFor(req);
      const useFreePulls = req.targeted ? 0 : Math.min(freeQueue.length, req.count);
      const costUsd = req.targeted ? cost : PULL_PRICE_USD * (req.count - useFreePulls);
      if (Math.round(costUsd * USDC_BASE) > balanceBase) throw fail('INSUFFICIENT_FUNDS', 'Out of pulls', 'Deposit USDC to keep going');
      const gachaInStock = gacha.albumId
        ? liveAlbums().some((a) => a.id === gacha.albumId && availableIn(a).length > 0)
        : liveAlbums().some((a) => availableIn(a).length > 0);
      if (!gachaInStock) throw fail('RESTOCKING', 'That gacha is restocking');
      const pullId = `pull_${(++counter).toString(36)}_${fnv1a(req.idem).toString(36)}`;
      const res: PullPrepareResponse = {
        pullId, costUsd, useFreePulls,
        transfer: costUsd > 0 ? { to: 'TREASURYmockAddress11111111111111111111111', mint: req.asset, amount: Math.round(costUsd * USDC_BASE), memo: pullId } : undefined,
        expiresAt: new Date(now() + 60_000).toISOString(),
      };
      prepared.set(pullId, { req, gacha, res, reserved: freeQueue.splice(0, useFreePulls) });
      return res;
    },
    async commitPull(req: PullCommitRequest): Promise<PullCommitResponse> {
      await sleep();
      const p = prepared.get(req.pullId);
      if (!p) throw fail('EXPIRED', 'That pull timed out');
      if (p.committed) return p.committed; // idempotent on pullId, including the raffle grant
      if (now() > Date.parse(p.res.expiresAt)) { releaseReservation(p); throw fail('EXPIRED', 'That pull timed out'); }
      if (p.res.transfer) {
        if (!req.txSignature) throw fail('TX_NOT_FOUND', 'We could not see your payment yet');
        const owner = signatures.get(req.txSignature);
        if (owner && owner !== req.pullId) throw fail('TX_MISMATCH', 'That payment did not match this pull'); // a signature never produces two pulls
        if (!req.txSignature.startsWith('mock:')) throw fail('TX_NOT_FOUND', 'We could not see your payment yet');
        signatures.set(req.txSignature, req.pullId);
        p.txSignature = req.txSignature;
      }
      const earned = ticketsEarnedForPull(p.req.count, p.reserved.length);
      const settled = commit(p);
      const today = dayKey(now());
      const yesterday = dayKey(now() - 24 * 3.6e6);
      const next = earned > 0 ? advancePaidStreak(paidStreak, today, yesterday) : null;
      const streakBonus = next?.bonus === 2 ? 2 : 0;
      if (next) paidStreak = next.state;
      seasonTickets += earned + streakBonus;
      p.committed = {
        ...settled, ticketsEarned: earned, streakBonus, myTickets: seasonTickets,
        streak: visibleStreak(paidStreak, today, yesterday),
      };
      return p.committed;
    },
    async burn(req: BurnRequest): Promise<BurnResponse> {
      await sleep();
      const again = burns.get(req.idem); // idempotent on `idem`: the same burn sent again is answered with that burn, and burns nothing more
      if (again) return again;
      if (extras() < BURN_COST) throw fail('UNKNOWN', `You need ${BURN_COST} extras to burn`);
      // Five extras return to the vault and one commons-only free pull is credited. No card is drawn (#294).
      let left = BURN_COST;
      for (const [cardId, n] of [...extrasByCard.entries()].sort((a, b) => b[1] - a[1])) {
        const h = holdings.get(cardId);
        const take = Math.min(n, left, Math.max(0, (h?.qty ?? 0) - 1)); // never return a copy the user no longer holds
        if (!take) continue;
        extrasByCard.set(cardId, n - take); if (n - take === 0) extrasByCard.delete(cardId);
        // A finite override grows back. An infinite album SKU has no vault to return a copy to.
        if (stock.has(cardId)) stock.set(cardId, (stock.get(cardId) ?? 0) + take);
        h!.qty -= take;
        left -= take; if (!left) break;
      }
      if (left) throw fail('UNKNOWN', `You need ${BURN_COST} extras to burn`);
      freeQueue.push('commons-only');
      const burned: BurnResponse = { extras: extras(), freePulls: freeQueue.length, balance: balance() };
      burns.set(req.idem, burned);
      return burned;
    },
    async claimCompletion(req: CompletionClaimRequest): Promise<CompletionClaimResponse> {
      await sleep();
      const answered = claims.get(req.idem); // idempotent on `idem`: the same claim sent again gets the answer it got the first time
      // An empty body is not an answer. A confirmed gift is.
      if (answered?.gift?.status === 'confirmed') return answered;
      const a = liveAlbums().find((x) => x.id === req.albumId);
      if (!a || distinctHeld(a) < ALBUM_SIZE) throw fail('UNKNOWN', 'That album is not complete');
      const already = claimedRewards.get(a.id);
      if (already?.gift?.status === 'confirmed') { claims.set(req.idem, already); return already; }
      // Demo double only: no live Jupiter call and no house key. One stable gift per album.
      const reward: CompletionClaimResponse = {
        outcomes: [],
        gift: {
          status: 'confirmed', packType: 'degen_100', count: 1, giftId: `mock-gift-${a.id}`,
          signature: `mock-sig-${a.id}`, receiver: DEMO_WALLET, openUrl: JUPITER_GACHA_OPEN_URL,
        },
      };
      claimedRewards.set(a.id, reward);
      claims.set(req.idem, reward);
      return reward;
    },
    async deleteAccount() { await sleep(); return { graceUntil: new Date(now() + 30 * 24 * 3.6e6).toISOString() }; },
    async fundingConfig(): Promise<FundingConfig> { await sleep(); return { methods: ['transfer'], assets: ['USDC'], network: 'solana', minimum: 0, depositAddress: DEMO_WALLET }; },
    async claimFaucet() { throw fail('UNKNOWN', 'The development faucet is unavailable in demo mode'); },
    async buildDeposit() { throw fail('UNKNOWN', 'Connected-wallet deposits are unavailable in demo mode'); },
    async submitDeposit() { throw fail('UNKNOWN', 'Connected-wallet deposits are unavailable in demo mode'); },
    async health(): Promise<Health> { return { ok: true, rpc: 'ok' }; },
    // The mock never draws by MagicBlock: every pull is the server's own proof, so no pull links a draw.
    async pullDraw(pullId: string): Promise<PullDrawView> { return { pullId, source: 'ecvrf' }; },
    dev: {
      deposit: (usd) => { balanceBase += Math.round(usd * USDC_BASE); },
      withdraw: (usd, idem) => {
        if (withdrawals.has(idem)) return; // the same intent again: already sent
        const base = Math.round(usd * USDC_BASE);
        if (base > balanceBase) throw fail('INSUFFICIENT_FUNDS', 'Not enough balance');
        balanceBase -= base; withdrawals.add(idem);
      },
      setStock: (cardId, available) => { if (available === null) stock.delete(cardId); else stock.set(cardId, available); },
      forceTier: (tier) => { forced = tier; },
      reset,
      creditFree: (count) => { for (let i = 0; i < count; i++) freeQueue.push('paid-odds'); },
      state: () => ({ balanceUsd: balanceBase / USDC_BASE, freePulls: freeQueue.length, extras: extras(), held: heldTotal() }),
    },
  };
  return api;
}
