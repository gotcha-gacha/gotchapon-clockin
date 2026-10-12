// App state, read through the API (F0.3). Screens never touch `api` directly for reads; they read
// this context and call its actions. Pull-ritual actions (prepare/commit/burn/completion) are thin
// wrappers that apply the server's response to local state — F2.3 drives them from the crank. A pull's cost lands at
// commit; its cards reach holdings only when the ritual reveals them (`revealed`).
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Crypto from 'expo-crypto';
import { api, mock, usingMock, apiConfigured, INVENTORY_GACHA_ID, USDC_BASE, indexHoldings, type Album, type Balance, type Odds, type Outcome, type BurnResponse, type CompletionClaimResponse, type FaucetClaimResponse, type FundingConfig, type Holding, type Me, type PullCommitRequest, type PullCommitResponse, type PullPrepareRequest, type PullPrepareResponse } from '@/api';
import { debitBaseline, pullBalanceTotal } from '@/state/pullBalance';
import { placeholderPartner, safeJupiterOpenUrl, type PartnerPackCredit } from '@/config/partnerPack';
import { newIdempotencyKey } from '@/api/http';
import { sendChecked, type Send } from './withdrawGuard';
import { ApiError, answerLost, commitCannotOpen, toApiError } from '@/api/errors';
import { currentPending, dropPending, keepPending, pendingId, readPendingPulls, type PendingPull } from './pendingPulls';
import { keepDrawReceipt } from './drawReceipts';
import { readSettings, updateSettings } from './settings';
import { setSoundMuted } from '@/audio/sfx';
import { track } from '@/analytics';
import { dollars } from '@/format';
import { closeRoutedOdds, sheetsRouted } from '@/navigation/sheetRoutes';
import { AuthCtx } from '@/auth/context';
import { paymentSignable, pullCommitWireRequest, signPreparedTransfer } from './paymentFlow';
import { expectedUsdcPayment } from '@/config/treasury';
import { SeasonProvider } from '@/state/season';

/** Pager destinations. Odds is a Pull-page sheet, not a page (Ben, 16 Sept). Map this array for dots / the bottom rail. */
export const PAGES = ['Albums', 'Pull', 'Wallet'] as const;
export const PAGE = { albums: 0, pull: 1, wallet: 2 } as const;
export type PageIndex = (typeof PAGE)[keyof typeof PAGE];
/** Where the app lands after sign-in and onboarding, and again after a sign-out: the Binder (#210; design/README.md line 4:
 *  "the binder is the hero surface; the machine is how you fill it", one swipe right). On the web a cold `/` lands here too;
 *  `/pull` still names the machine (useUrlState.web.ts). */
export const LANDING_PAGE: PageIndex = PAGE.albums;

/** What decides whether a quote may be signed: a mock payment signs nothing; a real one must pay what this build pinned. */
const paymentCheck = (prepared: PullPrepareResponse, authority: string | null | undefined) => ({
  prepared,
  useMockPayment: usingMock || (__DEV__ && process.env.EXPO_PUBLIC_DEV_PAYMENTS === '1'),
  expected: expectedUsdcPayment,
  authority,
});

export type Session = {
  /** The first load attempt has settled, including a dropped pre-sign-in 401 that leaves the balance at 0. Pull chrome waits on `balanceKnown`. */
  ready: boolean;
  error: ApiError | null;
  me: Me | null;
  /**
   * False until the first successful load has applied `/me` and `/balance` together. `balanceUsd` is 0 until then,
   * and `ready` is already true after a pre-sign-in 401 is dropped, so neither is an empty wallet.
   */
  balanceKnown: boolean;
  balanceUsd: number;
  /** USDC alone: what a USDC withdrawal can actually send (USDT is never converted). */
  usdcUsd: number;
  freePulls: number;
  holdings: Record<string, Holding>;
  extras: number;
  albums: Album[];
  funding: FundingConfig | null;
  /** Mainnet-dev only: one idempotent test-USDC grant, optionally sent to a linked external wallet. */
  claimFaucet: ((wallet?: string) => Promise<FaucetClaimResponse>) | null;
  /** Published odds: an optional read like the wallet's — a failure empties the odds sheet, never gates the app. */
  odds: Odds | null;
  /** Odds sleeve over Pull. Hidden for v0 (#332): `openOdds` does not open it. */
  oddsOpen: boolean;
  openOdds: () => void;
  closeOdds: () => void;
  /** For the `/odds` route (W2.1): the sleeve is on screen / has gone. Not for opening it: that is `openOdds`. */
  oddsShown: () => void;
  oddsHidden: () => void;
  albumOpen: string | null;
  openAlbum: (id: string) => void;
  closeAlbum: () => void;
  newCards: number;
  /** This session's pulls, newest first, at most 24 (F2.9 session tray). */
  recent: Outcome[];
  /** Marquee lines for pulls revealed this session. Cleared when a chase starts or switches album. The tray keeps `recent`. */
  marquee: Outcome[];
  clearMarquee: () => void;
  pullsThisSession: number;
  /** Reveal a pull's cards: the session tray, plus the holdings, extras and NEW badge its commit left waiting. The ritual
   *  host calls it when a capsule cracks or a pile opens. */
  revealed: (outcomes: Outcome[]) => void;
  /** The ritual host registers while it is mounted and gets back its unregister. A pull's cards wait for a reveal only while
   *  the host that committed it is still mounted; once it goes (sign-out, the geo-block screen) they are applied instead, or
   *  wait with a pull the next host is already holding for its own reveal. */
  attachRitual: () => () => void;
  /** The last rise in balance outside a pull — a deposit landing. The Pull page toasts it (F2.9). */
  credit: { usd: number; at: number } | null;
  /** Pulls whose cards have not come back: a sealed capsule the user left, or a relaunch mid-pull. Kept on disk from the moment
   *  the pull is spent (a paid pull's signature, a free pull's commit or a burn going out); the Pull page offers to open them. */
  pendingPulls: PendingPull[];
  /** The store refused the last write of the kept pulls (the web's private mode, a full quota): they live in memory only, and no
   *  copy may say a capsule will still be waiting after a reload. */
  pendingUnsaved: boolean;
  /** This tab has just become the active one (web): take over what another tab kept. */
  reloadKept: () => void;
  page: PageIndex;
  muted: boolean;
  usingMock: boolean;
  pagerLocked: boolean;
  lockPager: (locked: boolean) => void;
  setPage: (p: PageIndex) => void;
  toggleMuted: () => void;
  refresh: () => Promise<void>;
  /** Re-read odds: the odds sheet on open and the Pull page's restocking state. */
  refreshOdds: () => Promise<void>;
  /** Re-read balance and free pulls from the server: after a failed pull, on Later, or when a quote asks more than was shown. */
  refreshCost: () => Promise<void>;
  preparePull: (req: Omit<PullPrepareRequest, 'idem' | 'asset' | 'gachaId'> & { gachaId?: string }) => Promise<PullPrepareResponse>;
  /** Put back the free pulls an accepted prepare took off the counter. The hand left the crank, or the machine refused the
   *  quote. The server keeps the reservation until it expires; the next quote is checked against this restored count. */
  releasePreparedPull: (pullId: string) => void;
  /** Drop that hold without putting the free pulls back. The pull is committing, or the quote was repriced and the cost is
   *  re-read from the server. */
  settlePreparedPull: (pullId: string) => void;
  /** Take a paid pull's price off the pill as the wait starts, and lower the deposit baseline by the same amount.
   *  A pull's later balance must not climb back over that baseline: a chain read that has not seen the transfer
   *  is the pre-spend figure, and applying it would put the spent amount back on the pill. */
  optimisticPullDebit: (usd: number) => void;
  /** Authorize the pull transfer. Mock: returns its mock signature. Real: Privy returns the signed sponsored transaction for the API to broadcast. */
  signTransfer: (prepared: PullPrepareResponse) => Promise<string>;
  /** Whether `signTransfer` would sign this quote: true on the mock, and on a real payment only when the server-built
   *  transaction pays the treasury and mint this build pinned, from this wallet, for this pull (#186). */
  paymentSignable: (prepared: PullPrepareResponse) => boolean;
  commitPull: (req: PullCommitRequest) => Promise<PullCommitResponse>;
  /** Burn five extras into a free pull, sent with `idem`: the same burn sent again is answered with that burn, never a second one. */
  burn: (idem: string) => Promise<BurnResponse>;
  /** Claim a complete album's Jupiter gift (POST /completion-claims). A claim whose answer was lost goes out again with the same key.
   *  Success is a confirmed gift. There is no holo (#402). */
  claimCompletion: (albumId: string) => Promise<CompletionClaimResponse>;
  /** Albums whose claim the server answered while the app was open. No read says so yet, so after a relaunch the first claim finds out again. */
  claimedAlbums: ReadonlySet<string>;
  /** Pack credits recorded this session, keyed by album. Claim writes one from the gift. Nothing is minted. */
  partnerPacks: Readonly<Record<string, PartnerPackCredit>>;
  /** Send `usd` from the user's own wallet to `address` (design: Withdraw), idempotent on `idem`. Null in the
   *  real app until withdrawals are implemented; the mock debits the balance. */
  withdraw: ((usd: number, address: string, idem: string) => Promise<void>) | null;
  /** Mock only: credit the wallet so the ritual can be exercised without a chain. */
  devDeposit: ((usd: number) => Promise<void>) | null;
  /** When the account closes, once its deletion was scheduled this session (POST /account/delete's graceUntil). */
  accountClosing: string | null;
  /** Schedule the account's deletion (30-day grace); resolves to the closing date. */
  scheduleDeletion: () => Promise<string>;
};

const Ctx = createContext<Session | null>(null);

/** A pull's cards waiting for their reveal: what holdings, extras and the NEW badge become once they are shown. */
type Parked = { holdings: Holding[]; extras: number; fresh: number };

/** A count the wire actually sent. `null`, `''` and `false` all coerce to 0, which would look like a spent pile or no free pull. */
const finiteCount = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** `initialPage`: where the track starts, the landing page unless said otherwise (#210). A test that renders the Pull page
 *  bare, with no track to swipe, says `PAGE.pull`: the page's gates (`canCrank`'s `active`, the odds tab) read it. */
export function SessionProvider({ children, initialPage = LANDING_PAGE }: { children: React.ReactNode; initialPage?: PageIndex }) {
  const auth = useContext(AuthCtx);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  // 0 until the first successful /balance. Displays must wait for `balanceKnown`: this 0 is not an empty wallet.
  const [balanceUsd, setBalanceUsd] = useState(0);
  const [balanceKnown, setBalanceKnown] = useState(false);
  const [usdcUsd, setUsdcUsd] = useState(0);
  const [holdings, setHoldings] = useState<Record<string, Holding>>({});
  const [extras, setExtras] = useState(0);
  const [albums, setAlbums] = useState<Album[]>([]);
  const [funding, setFunding] = useState<FundingConfig | null>(null);
  const [odds, setOdds] = useState<Odds | null>(null);
  const [recent, setRecent] = useState<Outcome[]>([]);
  const [marquee, setMarquee] = useState<Outcome[]>([]);
  const [pullsThisSession, setPullsThisSession] = useState(0);
  const [credit, setCredit] = useState<{ usd: number; at: number } | null>(null);
  const lastTotal = useRef<number | null>(null);
  const lastUsdc = useRef<number | null>(null);
  const pullBalanceAt = useRef(0);
  // Pulls whose cards have not come back (F2.10): written the moment a pull is spent (a paid pull's transfer signed, a free pull's
  // commit or a burn going out), dropped once its cards come back or the server refuses it for good (a paid pull: commitCannotOpen;
  // a free pull or a burn: any answer, see answerLost). On disk, so leaving a sealed capsule, a crash or a relaunch never loses the
  // handle the client retries with. Shown only to the user who spent it.
  // Keeping and dropping merge into the store by id (pendingPulls): on the web the store is shared by every tab, and this list is
  // only what this one last saw. `keptUnsaved`: the store refused the last write (the web's private mode, a full quota), so a
  // kept pull lives in memory only and the sealed screen must not promise it will wait.
  const [kept, setKept] = useState<PendingPull[]>(readPendingPulls);
  const [keptUnsaved, setKeptUnsaved] = useState(false);
  const showKept = useCallback((r: { list: PendingPull[]; saved: boolean }) => { setKept(r.list); setKeptUnsaved(!r.saved); }, []);
  const keepPull = useCallback((p: PendingPull) => showKept(keepPending(p)), [showKept]);
  const dropPull = useCallback((id: string) => showKept(dropPending(id)), [showKept]);
  // A commit or burn this client sent before (Try again, Open it, or one kept from an earlier launch) can come back as the server's
  // replay of the first response, whose balance, free pulls and extras date from then: for those they are read fresh.
  const [keptAtLaunch] = useState(() => new Set(kept.map(pendingId)));
  /** This tab has just become the one that runs the machine (web: activeTab): what another tab sealed is now this one's to open. */
  const reloadKept = useCallback(() => {
    const r = currentPending();
    r.list.forEach((p) => keptAtLaunch.add(pendingId(p))); // sent by another tab: an answer to it is a replay, as after a relaunch
    showKept(r);
  }, [showKept, keptAtLaunch]);
  const sent = useRef(new Set<string>());
  // Free pulls prepared this launch, by pull id: one has no transfer to sign, so it is kept the moment its commit goes out. By id,
  // not the last one prepared: two prepares (the crank grabbed twice) can answer out of order.
  const freePrepared = useRef(new Map<string, PullPrepareResponse>());
  // Free pulls prepare took off the counter. `full` is the quote's useFreePulls and never shrinks (a strict-mode updater
  // re-run must see it). `giveBack` is what a release adds, set once the subtraction has been applied. `drop` is a quote the
  // machine refused or let go of. `settled` is a pull that is committing or whose cost is being re-read: the subtraction
  // stays, and a release must not put the pulls back.
  const freeHolds = useRef(new Map<string, { full: number; giveBack: number; applied: boolean; drop: boolean; settled: boolean }>());
  const [newCards, setNewCards] = useState(0);
  const [page, setPageState] = useState<PageIndex>(initialPage);
  /** The album whose binder is open on the Albums page (W2.1: it is part of the page's URL, `/binder/:albumId`). */
  const [albumOpen, setAlbumOpen] = useState<string | null>(null);
  const openAlbum = useCallback((id: string) => setAlbumOpen(id), []);
  const closeAlbum = useCallback(() => setAlbumOpen(null), []);
  const [oddsOpen, setOddsOpen] = useState(false);
  const oddsOpenRef = useRef(false);
  // Sound on or off (the ♪ toggle, F6.2) outlives a launch; the sound engine follows it.
  const [muted, setMuted] = useState(() => readSettings().muted);
  const [accountClosing, setAccountClosing] = useState<string | null>(null);
  // Completion claims (F3.5): an album's claim keeps its key unless the server refuses or queues it, so a claim sent again after a
  // lost answer is the same claim; and the albums whose claim the server answered, which the binder stops offering.
  const claimKeys = useRef(new Map<string, string>());
  const [claimedAlbums, setClaimedAlbums] = useState<ReadonlySet<string>>(() => new Set());
  const [partnerPacks, setPartnerPacks] = useState<Readonly<Record<string, PartnerPackCredit>>>({});
  useEffect(() => { setSoundMuted(muted); }, [muted]);
  const [pagerLocked, setPagerLocked] = useState(false);
  const pageRef = useRef<PageIndex>(initialPage);

  // What a pull contains reaches the app only when the ritual reveals it (`revealed`): a commit returns while the capsule is
  // still sealed, and the marquee, the chase globe, the page-dot badge and the Albums page all count cards. Balance lands at
  // commit. Free pulls land when prepare reserves them (`holdFreePulls`). Holdings, and the extras a paid pull just added, wait
  // with the capsule so none shows early. A burn spends its extras and credits its free pull as soon as it lands, and awards no card.
  const unrevealed = useRef<Parked | null>(null);
  // The ritual host mounted now, a fresh token per mount: a pull's cards park only for the host that sent its request.
  const ritualHost = useRef<object | null>(null);
  // Pulls whose new cards the NEW badge has counted, or will count once they are revealed. The same pull's cards can come back
  // twice (a late first commit, and the one Open it sent again), and the badge counts them once.
  const newCounted = useRef(new Set<string>());
  const applyHoldings = useCallback((list: Holding[]) => {
    if (unrevealed.current) unrevealed.current = { ...unrevealed.current, holdings: list };
    else setHoldings(indexHoldings(list));
  }, []);
  const applyExtras = useCallback((count: number) => {
    if (unrevealed.current) unrevealed.current = { ...unrevealed.current, extras: count };
    else setExtras(count);
  }, []);
  /** A burn's extras are spent the moment it lands, even while a pull's cards are still face-down. The count shows now, and
   *  that pull's reveal must not put the pre-burn count back. Paid pulls keep parking through `applyExtras`. */
  const publishExtras = useCallback((count: number) => {
    if (!finiteCount(count)) return;
    const n = Math.max(0, Math.trunc(count));
    if (unrevealed.current) unrevealed.current = { ...unrevealed.current, extras: n };
    setExtras(n);
  }, []);
  /** The burn response's free-pull count, absolute. A `/me` read must not replace it: that body can be stale, and it can land
   *  after prepare has already taken the credit off the counter. */
  const publishFreePulls = useCallback((count: number) => {
    if (!finiteCount(count)) return;
    const n = Math.max(0, Math.trunc(count));
    setMe((m) => (m ? { ...m, freePulls: n } : m));
  }, []);
  /** Show a pull's parked cards: holdings, extras and the NEW badge. */
  const applyParked = useCallback((u: Parked) => {
    setHoldings(indexHoldings(u.holdings));
    setExtras(u.extras);
    if (u.fresh && pageRef.current !== PAGE.albums) setNewCards((n) => n + u.fresh);
  }, []);
  const flushParked = useCallback(() => {
    const u = unrevealed.current;
    unrevealed.current = null;
    if (u) applyParked(u);
  }, [applyParked]);
  // Bumped each time a pull response shows its own cost, so a late one can tell whether a newer pull has shown its cost since it
  // went out. A balance read (the deposit poll, a load) does not count: it can predate the late pull's own commit.
  const costSeq = useRef(0);
  /** `fromPull`: the balance came with a pull (its response, or a re-read after one), so a rise is never a deposit. */
  const applyBalance = useCallback((b: Balance, fromPull = false) => {
    const total = b.usdc + b.usdt;
    if (fromPull) pullBalanceAt.current = Date.now();
    if (fromPull) {
      const kept = pullBalanceTotal(lastTotal.current, total);
      if (kept === null) return;
    } else if (lastTotal.current !== null && total > lastTotal.current) {
      // A rise outside a pull is money arriving (a deposit): the Pull page's top-up toast reads it (F2.9).
      setCredit({ usd: (total - lastTotal.current) / USDC_BASE, at: Date.now() });
    }
    lastTotal.current = total;
    lastUsdc.current = b.usdc;
    setBalanceUsd(total / USDC_BASE); setUsdcUsd(b.usdc / USDC_BASE);
  }, []);

  // Load = pure fetch; apply = state. Kept apart so the initial effect only touches state
  // asynchronously (react-hooks/set-state-in-effect) and `refresh` can reuse both.
  const load = useCallback(async () => {
    // Both batches start at once; optional reads (wallet and odds) never gate the app: if they fail that card is empty, not the machine.
    const coreP = Promise.all([api.me(), api.balance(), api.holdings(), api.extras(), api.albums()]);
    const optionalP = Promise.allSettled([api.fundingConfig(), api.odds(INVENTORY_GACHA_ID)]);
    const core = await coreP;
    const [f, od] = await optionalP;
    return { core, funding: f.status === 'fulfilled' ? f.value : null, odds: od.status === 'fulfilled' ? od.value : null };
  }, []);
  const started = useRef(false);
  // Privy installs its access-token getter in an effect, and this provider is that effect's child, so the first load
  // reads the getter before it exists and fails signed-out (mockAuth installs its dev token at import for the same
  // ordering). Wallet and email sign-in never reload the page, so that 401 used to stay on the Albums card ("Signed
  // out") with the header still at its initial $0. A load remembers whether sign-in had landed when it STARTED: a 401
  // from before that is dropped, and the load that starts as the app opens replaces it.
  const loadGen = useRef(0);
  const loadedOk = useRef(false);
  const signedIn = auth?.stage === 'done' || auth?.stage === 'onboarding';
  const signedInRef = useRef(signedIn);
  // Before the load effects below, so a refresh they start sees this commit's stage. Not written during render.
  useEffect(() => { signedInRef.current = signedIn; }, [signedIn]);
  const applyLoaded = useCallback((r: Awaited<ReturnType<typeof load>> | ApiError, startedSignedIn: boolean) => {
    if (r instanceof Error) {
      if (r.code === 'UNAUTHENTICATED' && !startedSignedIn) { setReady(true); return; }
      setError(r);
    }
    else {
      const [m, b, h, x, a] = r.core;
      setMe(m); applyBalance(b); applyHoldings(h); applyExtras(x.count); setAlbums(a); setFunding(r.funding); setOdds(r.odds);
      setBalanceKnown(true);
      setError(null);
      loadedOk.current = true;
      if (!started.current) { started.current = true; track('session_start', { usingMock }); }
    }
    setReady(true);
  }, [applyBalance, applyHoldings, applyExtras]);
  const refresh = useCallback(async () => {
    const gen = ++loadGen.current;
    const startedSignedIn = signedInRef.current;
    // Yield before touching state: Retry and the sign-in effect both call this from a render effect.
    const result = apiConfigured
      ? await load().catch((e: unknown) => toApiError(e))
      : await Promise.resolve(new ApiError({ code: 'NETWORK', message: 'This build has no API configured' }));
    if (gen !== loadGen.current) return;
    applyLoaded(result, startedSignedIn);
  }, [load, applyLoaded]);

  useEffect(() => {
    if (!apiConfigured) {
      const gen = ++loadGen.current;
      const startedSignedIn = signedInRef.current;
      const t = setTimeout(() => {
        if (gen === loadGen.current) applyLoaded(new ApiError({ code: 'NETWORK', message: 'This build has no API configured' }), startedSignedIn);
      }, 0);
      return () => { loadGen.current += 1; clearTimeout(t); };
    }
    void refresh();
    return () => { loadGen.current += 1; };
  }, [applyLoaded, refresh]);

  // Entering the app (wallet SIWS included) after a load that never succeeded. A session that already loaded — the
  // mock, a cold start whose token was ready — is left as it is. Onboarding and done are both the app; busy is not.
  const wasSignedIn = useRef(signedIn);
  useEffect(() => {
    const entered = signedIn && !wasSignedIn.current;
    wasSignedIn.current = signedIn;
    if (!entered || loadedOk.current) return;
    void refresh();
  }, [signedIn, refresh]);

  // "Listening for deposits": on the Wallet page, where a deposit is sent, and the Pull page, where it is spent, re-read the
  // balance every 15 s so a deposit shows up and toasts. `/balance` may be cached for up to 5 s, so a read that lands just after a
  // pull could still hold the pre-pull balance and look like a deposit: reads landing within 10 s of a pull's balance are dropped.
  useEffect(() => {
    if ((page !== PAGE.pull && page !== PAGE.wallet) || !apiConfigured) return;
    const t = setInterval(() => {
      api.balance().then((b) => { if (Date.now() - pullBalanceAt.current >= 10_000) applyBalance(b); }, () => {});
    }, 15_000);
    return () => clearInterval(t);
  }, [page, applyBalance]);

  const refreshOdds = useCallback(async () => {
    const od = await api.odds(INVENTORY_GACHA_ID).catch(() => null);
    if (od) setOdds(od);
  }, []);

  /** The sleeve is on screen (from `openOdds` here, or from the `/odds` route on the web, W2.1). */
  const oddsShown = useCallback(() => {
    if (!oddsOpenRef.current) {
      track('odds_viewed', {});
      void refreshOdds();
    }
    oddsOpenRef.current = true;
    setOddsOpen(true);
  }, [refreshOdds]);
  const oddsHidden = useCallback(() => {
    oddsOpenRef.current = false;
    setOddsOpen(false);
  }, []);
  // On the web the sleeve is a route (W2.1, #128): opening it is a push, closing it is Back, and the route itself says when it
  // is shown (oddsShown / oddsHidden). Everywhere else it is this state.
  const openOdds = useCallback(() => {
    // v0 hides the sleeve (#332). Callers (and a cold /odds) must not open it.
  }, []);
  const closeOdds = useCallback(() => {
    if (sheetsRouted()) { closeRoutedOdds(); return; } // the route's own, guarded close: one Back however many ask
    oddsHidden();
  }, [oddsHidden]);

  const setPage = useCallback((p: PageIndex) => {
    if (p === pageRef.current) return; // the pager echoes a programmatic move back through onPageSelected
    pageRef.current = p;
    setPageState(p);
    if (oddsOpenRef.current) closeOdds();
    if (p === PAGE.albums) setNewCards(0);
    if (p === PAGE.wallet) track('deposit_address_viewed', {});
  }, [closeOdds]);

  /** Re-read what pulling costs (balance, free pulls) from the server rather than a pull response. Best effort: offline, the
   *  screen keeps what it had. */
  const readCost = useCallback(async (current: () => boolean) => {
    const [b, m] = await Promise.allSettled([api.balance(), api.me()]);
    if (!current()) return;
    if (b.status === 'fulfilled') applyBalance(b.value, true);
    if (m.status === 'fulfilled') setMe(m.value);
  }, [applyBalance]);
  const rereadCost = useCallback(() => readCost(() => true), [readCost]);
  /** Wallet only. A burn credits its free pull from the response (`publishFreePulls`); reading `/me` here would replace that
   *  count, or undo a prepare that subtracted it while this read was still out. */
  const readBalance = useCallback(async (current: () => boolean) => {
    const b = await api.balance().catch(() => null);
    if (!current() || !b) return;
    applyBalance(b, true);
  }, [applyBalance]);

  /** Take `useFreePulls` off the counter as soon as prepare reserves them. A release or a settle issued in the same turn
   *  (the quote was refused, or the hand had already finished the turn) still wins: the subtraction sees their flag. */
  const holdFreePulls = useCallback((res: PullPrepareResponse) => {
    const raw = res.useFreePulls;
    const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : 0;
    if (!res.pullId || n <= 0 || freeHolds.current.has(res.pullId)) return;
    freeHolds.current.set(res.pullId, { full: n, giveBack: 0, applied: false, drop: false, settled: false });
    const pullId = res.pullId;
    setMe((m) => {
      const h = freeHolds.current.get(pullId);
      if (!m || !h || h.drop) return m;
      const applied = Math.min(h.full, m.freePulls);
      h.giveBack = applied;
      h.applied = true;
      if (applied <= 0 || h.settled) freeHolds.current.delete(pullId);
      if (applied <= 0) return m;
      return { ...m, freePulls: m.freePulls - applied };
    });
  }, []);
  const releasePreparedPull = useCallback((pullId: string) => {
    const h = freeHolds.current.get(pullId);
    if (!h) return;
    h.drop = true;
    setMe((m) => {
      const held = freeHolds.current.get(pullId);
      if (!m || !held) return m;
      freeHolds.current.delete(pullId);
      // The subtraction has not run yet: it will see `drop` and skip, so there is nothing to add.
      if (!held.applied || held.giveBack <= 0) return m;
      return { ...m, freePulls: m.freePulls + held.giveBack };
    });
  }, []);
  const settlePreparedPull = useCallback((pullId: string) => {
    const h = freeHolds.current.get(pullId);
    if (!h) return;
    h.settled = true;
    h.drop = false;
    if (h.applied) freeHolds.current.delete(pullId);
  }, []);
  const optimisticPullDebit = useCallback((usd: number) => {
    if (!(usd > 0) || !Number.isFinite(usd)) return;
    pullBalanceAt.current = Date.now();
    const next = debitBaseline(lastTotal.current, usd);
    if (next !== null) {
      lastTotal.current = next;
      setBalanceUsd(next / USDC_BASE);
    } else setBalanceUsd((b) => Math.max(0, Math.round((b - usd) * 100) / 100));
    if (lastUsdc.current !== null) {
      lastUsdc.current = Math.max(0, lastUsdc.current - Math.round(usd * USDC_BASE));
      setUsdcUsd(lastUsdc.current / USDC_BASE);
    }
  }, []);

  /** Send a pull-shaped request and apply what its response tells us: its cost now, its cards once they are revealed. A `replay`
   *  may carry an old balance, free pulls and extras, so those are read fresh instead. A late response (one that comes back to a
   *  different ritual host, which can have pulled since) shows its own cost unless a newer pull has shown one, then reads fresh
   *  too. The cards park only for the host mounted when the request went out; once it has gone they wait with any pull the new
   *  host is holding, or show at once. */
  const applyPullResponse = useCallback(async <R extends PullCommitResponse>(send: () => Promise<R>, replay: boolean, pullIdOf: (res: R) => string): Promise<R> => {
    const sender = ritualHost.current;
    const seq = costSeq.current;
    const res = await send();
    const showCost = () => {
      costSeq.current += 1;
      const shownAt = costSeq.current;
      if (res.balance) applyBalance(res.balance, true);
      // The server could not read the wallet after settling (#277): read it here, unless a newer pull shows its cost first.
      else void readCost(() => costSeq.current === shownAt);
      setMe((m) => (m ? { ...m, freePulls: res.freePulls } : m));
    };
    let extrasNow = res.extras;
    if (replay || ritualHost.current !== sender) {
      // A late response's own cost stands, and stays if the re-read fails, unless a newer pull has shown its cost since it went out.
      if (!replay && costSeq.current === seq) showCost();
      // A failed extras read must not seal the pull again: the response's count waits with it, and the next load corrects it.
      // The cost read applies only if no newer pull shows its cost first (#306): it can land after one that did.
      const at = costSeq.current;
      const [, x] = await Promise.all([readCost(() => costSeq.current === at), api.extras().catch(() => null)]);
      extrasNow = x?.count ?? res.extras;
    } else {
      showCost();
    }
    // A paid pull's extras wait with the capsule (#319): showing them here would put the new copies on Albums while the pile is face-down.
    const list = await api.holdings();
    const pullId = pullIdOf(res);
    const fresh = newCounted.current.has(pullId) ? 0 : res.outcomes.filter((o) => !o.isDupe).length;
    newCounted.current.add(pullId);
    const parked: Parked = { holdings: list, extras: extrasNow, fresh };
    const u = unrevealed.current;
    if (sender && ritualHost.current === sender) unrevealed.current = parked;
    else if (u) unrevealed.current = { ...parked, fresh: u.fresh + fresh }; // the new host already holds a pull's cards: these wait with them
    else applyParked(parked); // the host that would reveal them has gone
    return res;
  }, [applyBalance, readCost, applyParked]);

  // Cards reach the app as they are revealed (design: crack → card, pile → spread), never at commit: the tray sits in view
  // under the capsule, and holdings, extras and the NEW badge feed counts on every page (see `unrevealed`).
  const revealed = useCallback((outcomes: Outcome[]) => {
    const filed = (prev: Outcome[]) => outcomes.concat(prev).slice(0, 24);
    setRecent(filed);
    setMarquee(filed);
    setPullsThisSession((n) => n + outcomes.length);
    flushParked();
  }, [flushParked]);
  const clearMarquee = useCallback(() => setMarquee([]), []);

  const attachRitual = useCallback(() => {
    const host = {};
    ritualHost.current = host;
    return () => {
      if (ritualHost.current !== host) return;
      ritualHost.current = null;
      flushParked(); // nothing is left to reveal them
    };
  }, [flushParked]);

  const devDeposit = useMemo(() => {
    const m = mock;
    if (!m) return null;
    return async (usd: number) => { m.dev.deposit(usd); applyBalance(await api.balance()); };
  }, [applyBalance]);
  const claimFaucetAction = useCallback(async (wallet?: string) => {
    const claimed = await api.claimFaucet(wallet ? { wallet } : undefined);
    applyBalance(await api.balance());
    // One grant per account (#276), whichever wallet it went to: the account is claimed now, for every sign-in method.
    setFunding((current) => current?.faucet
      ? { ...current, faucet: { ...current.faucet, claimed: true, ...(claimed.wallet ? { wallet: claimed.wallet } : {}) } }
      : current);
    return claimed;
  }, [applyBalance]);
  const claimFaucet = !funding?.faucet || usingMock || funding.faucet.claimed ? null : claimFaucetAction;
  const withdraw = useMemo(() => {
    const m = mock;
    // This is the seam money leaves through, so the destination is checked here and not only in the sheet (#187), by
    // `sendChecked` rather than by a line inside the sender it wraps. An unguarded send returned from the `!m` branch
    // below passes tsc, lint and every test (measured in PR #195's
    // round 2); what is pinned is only this call site, by `withdraw.test.tsx`. Returning `null` off the mock is what
    // hides the Withdraw link until then. (The pull path's equivalent is `paymentSignable`, #186.)
    if (!m) return null;
    // The demo path moves nothing, so it has no use for the destination `sendChecked` just checked. A future real
    // withdrawal sender must keep the line below it: `(usd, address, idem) => sendChecked(sendWithPrivy, …)`.
    const demoSend: Send = async (usd, _address, idem) => {
      m.dev.withdraw(usd, idem);
      track('withdraw', { usd });
      applyBalance(await api.balance());
    };
    return (usd: number, address: string, idem: string) => sendChecked(demoSend, usd, address, idem);
  }, [applyBalance]);

  const value = useMemo<Session>(() => ({
    ready, error, me, balanceKnown, balanceUsd, usdcUsd, holdings, extras, albums, funding, claimFaucet, odds, oddsOpen, openOdds, closeOdds, oddsShown, oddsHidden, albumOpen, openAlbum, closeAlbum, newCards, recent, marquee, clearMarquee, pullsThisSession, credit, revealed, attachRitual, page, muted, usingMock, pagerLocked, accountClosing, claimedAlbums, partnerPacks,
    lockPager: setPagerLocked,
    freePulls: me?.freePulls ?? 0,
    pendingPulls: me ? kept.filter((p) => p.userId === me.id) : [],
    pendingUnsaved: keptUnsaved,
    reloadKept,
    setPage,
    toggleMuted: () => { setMuted(updateSettings({ muted: !muted }).muted); },
    refresh,
    refreshOdds,
    refreshCost: rereadCost,
    preparePull: async (req) => {
      const clientSeed = `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replaceAll('-', '');
      const gachaId = req.gachaId ?? (req.albumId ? `album:${req.albumId}` : INVENTORY_GACHA_ID);
      const res = await api.preparePull({ ...req, gachaId, asset: 'USDC', idem: newIdempotencyKey(), clientSeed });
      keepDrawReceipt(res); // before anything is signed: the commitment the draw is checked against later (#406)
      if (!res.transfer) freePrepared.current.set(res.pullId, res);
      holdFreePulls(res);
      return res;
    },
    signTransfer: async (prepared) => {
      const txSignature = await signPreparedTransfer({ ...paymentCheck(prepared, auth?.wallet), signer: auth?.signSolanaTransaction });
      keepPull({ kind: 'pull', userId: me?.id ?? '', prepared, txSignature });
      return txSignature;
    },
    paymentSignable: (prepared) => paymentSignable(paymentCheck(prepared, auth?.wallet)),
    releasePreparedPull,
    settlePreparedPull,
    optimisticPullDebit,
    commitPull: async (req) => {
      const replay = sent.current.has(req.pullId) || keptAtLaunch.has(req.pullId);
      sent.current.add(req.pullId);
      settlePreparedPull(req.pullId); // committing spends the reservation; the response, or the re-read below, owns the count
      const free = freePrepared.current.get(req.pullId);
      if (!req.txSignature && free) keepPull({ kind: 'pull', userId: me?.id ?? '', prepared: free }); // spent as it goes out
      try {
        const wireRequest = pullCommitWireRequest(req, !usingMock);
        const r = await applyPullResponse(() => api.commitPull(wireRequest), replay, () => req.pullId);
        dropPull(req.pullId); // only once the cards are in: a failure after the commit leaves the pull to open again (commit is idempotent)
        return r;
      } catch (e) {
        const code = toApiError(e).code;
        // A paid pull waits until it opens or can never open; a free pull only while its answer is lost, as any answer means it did not land.
        if (req.txSignature ? commitCannotOpen(code) : !answerLost(code)) dropPull(req.pullId);
        // The commit may have landed with its response lost, and its free pulls are reserved either way: re-read the cost so
        // the machine never offers a free pull the server has already used. Unless a newer pull shows its cost first (#306).
        const at = costSeq.current;
        await readCost(() => costSeq.current === at);
        throw e;
      }
    },
    burn: async (idem) => {
      const replay = sent.current.has(idem) || keptAtLaunch.has(idem);
      if (!replay) track('burn', { extrasBefore: extras });
      sent.current.add(idem);
      keepPull({ kind: 'burn', userId: me?.id ?? '', idem }); // spent as it goes out, like a free pull
      // A replay's stored freePulls is the count at the first burn. Read the live one, the way a pull replay does.
      const readLanded = async () => {
        const at = costSeq.current;
        const [list, x] = await Promise.all([
          api.holdings().catch(() => null),
          api.extras().catch(() => null),
          readCost(() => costSeq.current === at),
        ]);
        if (list) applyHoldings(list);
        if (x) publishExtras(x.count);
      };
      try {
        const r = await api.burn({ idem });
        // A replay's stored counts date from the first burn. A body that did not actually carry counts is the same: read them.
        // A holdings read after a real answer must not seal the burn — the credit already landed, and there is no card to open.
        if (replay || !finiteCount(r?.extras) || !finiteCount(r?.freePulls)) await readLanded();
        else {
          costSeq.current += 1;
          const shownAt = costSeq.current;
          publishExtras(r.extras);
          publishFreePulls(r.freePulls);
          if (r.balance) applyBalance(r.balance, true);
          else void readBalance(() => costSeq.current === shownAt);
          const list = await api.holdings().catch(() => null);
          if (list) applyHoldings(list);
        }
        dropPull(idem);
        return r;
      } catch (e) {
        if (!answerLost(toApiError(e).code)) dropPull(idem);
        else await readLanded(); // the credit may have landed with the answer lost
        throw e;
      }
    },
    claimCompletion: async (albumId) => {
      const idem = claimKeys.current.get(albumId) ?? newIdempotencyKey();
      claimKeys.current.set(albumId, idem);
      const r = await api.claimCompletion({ albumId, idem }).catch((e: unknown) => {
        if (!answerLost(toApiError(e).code)) claimKeys.current.delete(albumId); // answered (unavailable, refused): the next claim is a new one
        throw e;
      });
      // A confirmed gift is the claim. An empty body is not (#402). Leave the album unclaimed; the next try is a new claim.
      const gift = r.gift;
      if (gift?.status !== 'confirmed') {
        claimKeys.current.delete(albumId);
        throw new ApiError({ code: 'UNKNOWN', message: 'Your Degen pack is temporarily unavailable. Try again.' });
      }
      setClaimedAlbums((done) => new Set(done).add(albumId));
      // The credit is the pack record. It does not move the balance or the free-pull count: those are this
      // machine's pulls, and a silent change there reads as money appearing (#392).
      setPartnerPacks((packs) => ({
        ...packs,
        [albumId]: {
          kind: 'pack-credit',
          partner: placeholderPartner,
          albumId,
          wallet: gift.receiver || me?.wallet || '',
          packType: gift.packType,
          count: gift.count,
          openUrl: safeJupiterOpenUrl(gift.openUrl),
          giftId: gift.giftId,
          signature: gift.signature,
        },
      }));
      track('reward_claimed', { albumId, packType: gift.packType });
      return r;
    },
    withdraw,
    devDeposit,
    scheduleDeletion: async () => { const r = await api.deleteAccount(); setAccountClosing(r.graceUntil); return r.graceUntil; },
  }), [ready, error, me, balanceKnown, balanceUsd, usdcUsd, holdings, extras, albums, funding, claimFaucet, odds, oddsOpen, openOdds, closeOdds, oddsShown, oddsHidden, albumOpen, openAlbum, closeAlbum, newCards, recent, marquee, pullsThisSession, credit, page, muted, pagerLocked, setPage, refresh, refreshOdds, applyPullResponse, revealed, clearMarquee, attachRitual, accountClosing, devDeposit, withdraw, kept, keptUnsaved, reloadKept, keepPull, dropPull, applyHoldings, applyBalance, keptAtLaunch, readCost, rereadCost, readBalance, publishExtras, publishFreePulls, claimedAlbums, partnerPacks, auth, holdFreePulls, releasePreparedPull, settlePreparedPull, optimisticPullDebit]);

  return <Ctx.Provider value={value}><SeasonProvider>{children}</SeasonProvider></Ctx.Provider>;
}

export function useSession(): Session {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession outside SessionProvider');
  return v;
}

/** "$8 · 8 pulls" / "$8.50 · 8 pulls" — the header balance pill copy from the design. */
export function balanceText(usd: number): string {
  const pulls = Math.floor(usd);
  return `${dollars(usd)} · ${pulls} ${pulls === 1 ? 'pull' : 'pulls'}`;
}
