// Pull (home): machine, ritual, capsule (scratch), reveal, batch spread, result bar, stage effects (with milestone confetti, F3.4), and (F2.9) the
// session tray, the out-of-stock banner and the top-up toast; the album picker (F2.8); and a banner for capsules left sealed.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSequence, withTiming } from 'react-native-reanimated';
import * as Sharing from 'expo-sharing';
import { Page } from './Page';
import { MACHINE_W, Machine, canAfford, type Multi } from '@/components/machine/Machine';
import { oddsFacts, sessionFacts, tickerText } from '@/components/machine/ticker';
import { BatchPile } from '@/components/machine/BatchPile';
import { ScratchCapsule } from '@/components/reveal/ScratchCapsule';
import type { CrankHandle } from '@/components/machine/Crank';
import { canCrank } from '@/ritual/canCrank';
import { useKeyboardBridge } from '@/ritual/useKeyboardBridge';
import { ScrollHere } from '@/components/ScrollHere';
import { loadSkiaWeb, loadSkiaWebWhenIdle } from '@/components/reveal/skiaWeb';
import { CardReveal } from '@/components/reveal/CardReveal';
import { ResultBar } from '@/components/reveal/ResultBar';
import { STREAK_BONUS_CHIP } from '@/components/header/streakCopy';
import { SHARE_CAPTURE, SHARE_W, ShareCard } from '@/components/reveal/ShareCard';
import { CAN_SHARE_CARD, captureRef } from '@/components/reveal/shareCapture';
import { Spread, spreadSummary } from '@/components/reveal/Spread';
import { albumProgress } from '@/components/albums/AlbumsGrid';
import { Burst, Flash, NightStars, NightVignette } from '@/components/reveal/effects';
import { Confetti } from '@/components/reveal/Confetti';
import { CONFETTI_AGAIN_MS, stopPlan } from '@/ritual/rollTiming';
import { snowCount } from '@/ritual/snow';
import { TIER, hexGlow, playPattern } from '@/components/reveal/tiers';
import { useRitual } from '@/ritual/useRitual';
import { canStart } from '@/ritual/reducer';
import { dollars } from '@/format';
import { playSfx } from '@/audio/sfx';
import { ApiError, burnSealedCopy, commitCannotOpen, prepareErrorCopy, sealedCopy } from '@/api/errors';
import { pendingId } from '@/state/pendingPulls';
import { useDrawLink } from '@/state/drawLink';
import { TIER_VALUE_USD, pullCostUsd, type Tier } from '@/api/contract';
import { PAGE, useSession } from '@/state/session';
import { useAuth } from '@/auth/AuthProvider';
import { RESULT_GAP, railHeight } from '@/components/PageDots';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SessionTray } from '@/components/machine/SessionTray';
import { AlbumPicker, albumSwatch, targetCapsules } from '@/components/machine/AlbumPicker';
import { AlbumCompleteTakeover } from '@/components/albums/AlbumCompleteTakeover';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';

const STAGE_W = MACHINE_W; // every absolute overlay (capsule, pile, card, spread) centres on the machine
const MILESTONES = [5, 10, 15, 20];

/** What a share left behind. A share is two halves — make the picture, then hand it to the system sheet — and they fail for
 *  different reasons, so each has its own line. (The retry is the same pill either way; what it is worth re-tapping for is
 *  not.) Only `capture-failed` may blame the picture: past `captureRef` the PNG exists, and telling someone it could not be
 *  made points them at the wrong thing. */
type ShareNote = 'capture-failed' | 'sheet-failed';
const SHARE_NOTE: Record<ShareNote, string> = {
  'capture-failed': "Couldn't make the picture — try again.",
  'sheet-failed': "Sharing didn't go through — try again.",
};

/** After a full turn while prepare is still out: the machine waits for the answer, and nothing has been charged. */
export const slowPrepareHint = 'Waiting for the capsule — nothing has been charged.';

/** How long `captureRef` / `shareAsync` may go unanswered before the pill is handed back (same 30 s as `http.ts`).
 *  Tests may shorten it; restore `ms` afterwards. */
export const shareDeadline = { ms: 30_000 };
const shareTimedOut = () => new Error('Share timed out');
const ignoreShare = () => {};

/** Warm the image cache without ever throwing (RN's jest Image mock returns no promise). */
const prefetch = (uri: string) => { Promise.resolve().then(() => Image.prefetch(uri)).catch(() => {}); };

export function PullPage() {
  const { balanceUsd, balanceKnown, freePulls, setPage, lockPager, pagerLocked, page, albums, holdings, odds, refreshOdds, recent, marquee, pullsThisSession, credit, claimCompletion, pendingPulls, pendingUnsaved, refreshCost, openOdds, oddsOpen } = useSession();
  const auth = useAuth();
  const insets = useSafeAreaInsets();
  const { ritual, dispatch, rollWait, rollKeep, rollNotify } = useRitual();
  const { phase, multi, targeted } = ritual;
  const [settle, setSettle] = useState(0);
  const [burst, setBurst] = useState(0);
  const [flash, setFlash] = useState(0);
  const [allFlipped, setAllFlipped] = useState(false);
  const [seenSoldOut, setSeenSoldOut] = useState<string[]>([]);
  const [toastDoneAt, setToastDoneAt] = useState<number | null>(null);
  // Top-up toast (F2.9): a deposit landing shows for 3.8 s (the design's timing) once the Pull page is in view. A
  // deposit usually lands while the wallet is open; the toast is what greets the user back at the machine.
  const chimed = useRef(0);
  useEffect(() => {
    if (!credit || page !== PAGE.pull) return;
    if (chimed.current !== credit.at) { chimed.current = credit.at; playSfx('chord'); } // once per deposit, however often the page is revisited
    const t = setTimeout(() => setToastDoneAt(credit.at), 3800);
    return () => clearTimeout(t);
  }, [credit, page]);
  const shakeX = useSharedValue(0), shakeY = useSharedValue(0);

  const onCrankStart = useCallback(() => dispatch({ type: 'CRANK_START' }), [dispatch]);
  const onCrankAbandon = useCallback(() => dispatch({ type: 'CRANK_ABANDONED' }), [dispatch]);
  const onRelease = useCallback(() => dispatch({ type: 'RELEASE' }), [dispatch]);
  const onMulti = useCallback((m: Multi) => dispatch({ type: 'SET_MULTI', multi: m }), [dispatch]);
  const onCrack = useCallback(() => { setBurst((b) => b + 1); dispatch({ type: 'CRACKED' }); }, [dispatch]);
  const onShake = useCallback(() => {
    shakeX.set(withSequence(withTiming(-7, { duration: 96 }), withTiming(7, { duration: 96 }), withTiming(-4, { duration: 96 }), withTiming(0, { duration: 192 })));
    shakeY.set(withSequence(withTiming(3, { duration: 96 }), withTiming(-3, { duration: 96 }), withTiming(2, { duration: 96 }), withTiming(0, { duration: 192 })));
  }, [shakeX, shakeY]);
  const onFlash = useCallback(() => setFlash((f) => f + 1), []);
  // Share (F2.11): the off-stage share card is captured as a PNG and handed to the system sheet. One share at a time, and
  // a capture or a sheet that fails says so instead of doing nothing (the capture's view can go with Into binder). The
  // reveal itself is never disturbed either way.
  const shareRef = useRef<View>(null);
  const sharing = useRef(false);
  // A share belongs to the *reveal* it was made on, counted by `pullsThisSession` — never to the card, whose id comes round
  // again (the holo pool is 15 cards), which would strand a card whose sheet never answered. Nothing is reset when the card
  // leaves the stage, so the line outlives Into binder taking the pill away, and the next reveal simply stops matching.
  const [share, setShare] = useState<{ at?: number; state: 'idle' | 'busy' | ShareNote }>({ state: 'idle' });
  const noteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const revealAt = useRef(pullsThisSession);
  useEffect(() => { revealAt.current = pullsThisSession; sharing.current = false; }, [pullsThisSession]);
  // Re-armed on every mount, not just the first: Fast Refresh and StrictMode destroy and re-create this effect over the same refs.
  useEffect(() => { alive.current = true; return () => { alive.current = false; if (noteTimer.current) clearTimeout(noteTimer.current); }; }, []);
  // The web fetches CanvasKit once the machine is up and the browser idle (at most 2 s after this page mounts, which is after
  // sign-in), or when the first turn starts, whichever is first: from there the capsule is only a commit away. Until it has
  // loaded (or if it never does) the capsule opens with a tap and cards have no foil. Native has nothing to load.
  useEffect(() => loadSkiaWebWhenIdle(), []);
  useEffect(() => { if (phase !== 'idle' && phase !== 'coined') void loadSkiaWeb(); }, [phase]);
  const forgetNote = useCallback(() => { if (noteTimer.current) { clearTimeout(noteTimer.current); noteTimer.current = null; } }, []);
  /** Say what went wrong, and clear it 3.8 s later as the deposit toast does — timed from the failure, so one that lands
   *  while nothing is on screen expires instead of waiting to be shown on some later card. Only ever called behind `mine()`,
   *  which is what keeps a timer from being armed past the cleanup that would have cleared it. */
  const sayShare = useCallback((state: ShareNote, at: number) => {
    setShare({ at, state });
    forgetNote();
    noteTimer.current = setTimeout(() => setShare({ state: 'idle' }), 3800);
  }, [forgetNote]);
  const onShare = useCallback(async () => {
    if (sharing.current) return; // a second tap while the sheet comes up would capture twice and present twice
    sharing.current = true;
    const at = pullsThisSession;
    // Everything after an await belongs to the reveal that started it, on this page: a share the user has moved past — or one
    // whose page is gone — opens no sheet, writes no line over the card that replaced it, arms no timer past the cleanup that
    // would have cleared it, and hands back no in-flight guard the new reveal's own effect already cleared. The counter alone
    // cannot see the page go: it lives in the session above the router, so it survives sign-out and the geo-block, while the
    // system sheet is presented by the OS over whatever screen replaced the card.
    const mine = () => alive.current && revealAt.current === at;
    forgetNote(); // a retry inside the last note's 3.8 s: that timer would un-grey this attempt's pill while it is still out
    setShare({ at, state: 'busy' });
    // Which half this share is in, so the one `catch` over both awaits can name it. Local to this call: shares from
    // different reveals overlap (the new reveal's effect hands the in-flight guard back), and each must report its own half.
    let half: 'capture-failed' | 'sheet-failed' = 'capture-failed';
    // One deadline over both halves, like `http.ts`: a capture or a sheet that never answers must fail rather than leave
    // this reveal's pill greyed until the next card. Late rejections from the abandoned half are swallowed so they are not
    // unhandled; a late *success* is ignored because we have already left the race.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(shareTimedOut()), shareDeadline.ms);
    });
    deadline.catch(ignoreShare);
    const within = <T,>(work: Promise<T>) => {
      work.catch(ignoreShare);
      return Promise.race([work, deadline]);
    };
    try {
      const uri = await within(captureRef(shareRef, { format: 'png', quality: 1, width: SHARE_CAPTURE.width, height: SHARE_CAPTURE.height }));
      half = 'sheet-failed'; // the PNG exists from here on: nothing past this line may blame the picture
      // Only another reveal cancels the sheet. The counter does not move at Into binder, so a capture that lands with the
      // machine idle still opens the sheet the user asked for — the answer outlives the pill, as the failure line does.
      if (!mine()) return;
      // Straight to the sheet: no `Sharing.isAvailableAsync()` first, because this app can never get `false` out of it. Its
      // JS returns true without calling native whenever the native module defines no `isAvailableAsync`, and neither
      // platform's does — `node_modules/expo-sharing/ios/SharingModule.swift` and the prebuilt Android AAR (sources
      // identical to its `SharingModule.kt`) declare `shareAsync` plus the share-into functions and nothing else, though the
      // module's own TS type claims one. Its other `false` is for a missing native module, which makes `requireNativeModule`
      // throw at import instead. Version-pinned to expo-sharing 57.0.22 — re-check on upgrade (re-checked at the 57.0.19 → 57.0.21
      // bump, 19 Sept, and the 57.0.21 → 57.0.22 bump, 26 Sept: iOS `SharingModule.swift` and the AAR's `classes.jar`
      // byte-identical, no `isAvailableAsync` in either).
      // Nor is a "cannot share" answer something this gave up: there is no such state on these platforms, which is why the
      // natives declare nothing to report it with. iOS presents `UIActivityViewController` unconditionally; Android starts
      // the chooser and rejects only if something throws. Whatever does go wrong presenting the sheet lands in the catch
      // below as the sheet failing — not because a device said no, but because the presentation did.
      // This is now the only gap between the reveal guard above and the sheet. An await added back here reopens the
      // stale-write window #87 had to guard, and no test would notice: nothing pins the absence of a suspension point.
      await within(Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your pull' }));
      if (mine()) setShare({ at, state: 'idle' });
    } catch {
      if (mine()) sayShare(half, at);
    } finally {
      clearTimeout(timer);
      if (mine()) sharing.current = false;
    }
  }, [pullsThisSession, sayShare, forgetNote]);
  const shareBusy = share.state === 'busy' && share.at === pullsThisSession;
  const shareNote = share.state !== 'idle' && share.state !== 'busy' && share.at === pullsThisSession ? share.state : null;
  const onSettled = useCallback(() => { setSettle(0); playSfx('tick'); dispatch({ type: 'INTO_BINDER' }); }, [dispatch]);
  const onFlipped = useCallback((rarity: Tier) => dispatch({ type: 'FLIPPED', rarity }), [dispatch]);
  const onAllFlipped = useCallback(() => setAllFlipped(true), []);
  const onOpenPile = useCallback(() => { setAllFlipped(false); dispatch({ type: 'OPEN_PILE' }); }, [dispatch]);
  // Card art is requested while the capsule / pile is still on stage, so the reveal never plays over an empty card.
  useEffect(() => {
    if (phase !== 'capsule' && phase !== 'batchcaps') return;
    for (const o of ritual.outcomes) prefetch(phase === 'capsule' ? o.card.imgLarge : o.card.imgSmall);
  }, [phase, ritual.outcomes]);
  // The burn hand-off's last beat (F4.2): as the dome flashes, the stage shakes and the heavy double buzz lands.
  useEffect(() => { if (ritual.burnStep === 'flash') { onShake(); playPattern([40, 30, 80]); playSfx('chord'); } }, [ritual.burnStep, onShake]);
  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shakeX.get() }, { translateY: shakeY.get() }] }));

  // Restocking (F2.10): the dome reads stock from /odds. A RESTOCKING refusal refreshes it, and while every album is
  // sold out the Pull page re-checks once a minute so the machine wakes up after a restock.
  const albumStock = odds ? Object.values(odds.stock.perAlbum) : [];
  const soldOut = albumStock.length > 0 && albumStock.every((a) => a.live === 0);
  const restocking = soldOut && !targeted ? (odds?.nextRestock ?? 'soon') : null;
  useEffect(() => { if (ritual.error === 'RESTOCKING') void refreshOdds(); }, [ritual.error, refreshOdds]);
  useEffect(() => {
    if (!soldOut || page !== PAGE.pull) return;
    const t = setInterval(() => { void refreshOdds(); }, 60_000);
    return () => clearInterval(t);
  }, [soldOut, page, refreshOdds]);

  // Out-of-stock banner (F2.9): one album sold out while others still pull. Every album out is the restocking dome.
  const soldOutAlbum = odds && !soldOut && !targeted ? albums.find((a) => a.status === 'live' && odds.stock.perAlbum[a.id]?.live === 0 && !seenSoldOut.includes(a.id)) ?? null : null;
  const openAlbums = albumStock.filter((a) => a.live > 0).length;

  const canPull = canAfford(multi as Multi, targeted, balanceUsd, freePulls);
  // The keyboard (web only; a no-op on a phone): the same gate the machine's crank answers to, the crank's own turn, and
  // the same two calls a hand makes on a capsule and on a pile (W1.2, #124).
  const crankRef = useRef<CrankHandle>(null);
  useKeyboardBridge({
    enabled: auth.stage === 'done',
    phase,
    canCrank: canCrank({ phase, affordable: canPull, restocking: restocking != null && phase === 'idle', takeover: !!ritual.takeover, active: page === PAGE.pull }),
    page, setPage, pagerLocked, oddsOpen, openOdds,
    autoCrank: () => crankRef.current?.autoCrank() ?? false,
    openCapsule: onCrack,
    openPile: onOpenPile,
  });
  const sealed = phase === 'sealed'
    ? ritual.source === 'burn'
      ? burnSealedCopy(ritual.error, !pendingUnsaved)
      : sealedCopy(ritual.error, ritual.txSignature !== undefined, !pendingUnsaved)
    : null;
  const cannotOpen = phase === 'sealed' && commitCannotOpen(ritual.error);
  // Pulls and burns the session kept (a sealed capsule left for later, or a relaunch mid-pull) wait in a banner until opened. The one
  // in flight is not one of them, and the banner stays up while another pull runs so the machine never shifts under a hand on the
  // crank; Open it waits for an idle machine.
  const waiting = pendingPulls.filter((p) => pendingId(p) !== (ritual.burnIdem ?? ritual.prepared?.pullId));
  const kept = waiting[0];
  const canOpenKept = canStart(ritual);
  // A chase is the album rate times the size. ×1 keeps the singular line; ×5/×10 name the pile's price.
  const chasePrice = dollars(pullCostUsd(multi as Multi, true, 0));
  const chaseCards = multi > 1 ? 'random cards from this album' : 'a random card from this album';
  const hint =
    phase === 'rolling' || phase === 'stopping' || phase === 'dropping' ? rollWait.text
    : phase === 'capsule' ? 'Rub the capsule.'
    : phase === 'committing' || phase === 'card' || phase === 'spread' || phase === 'batchcaps' ? ''
    : sealed ? sealed.title
    : phase === 'burning' ? ''
    : phase === 'coined' ? 'Free pull — turn the crank.'
    : phase === 'armed' && ritual.prepared && !ritual.prepared.transfer ? 'Free pull — turn the crank'
    : phase === 'preparing' && ritual.releasePending ? slowPrepareHint
    : ritual.repriced !== undefined ? `Nothing was charged — that pull costs ${dollars(ritual.repriced)}, not what the machine showed. Turn the crank again.`
    : ritual.error === 'RESTOCKING' && targeted ? 'That album is restocking. Clear the chase to pull from every album.'
    : restocking ? ''
    // A bundle is refused unless every tier it could land on holds a card for each of its pulls (the server checks before
    // any money moves). Below the sold-out dome, which refuses every size. It names only the size that was refused, and
    // promises no smaller one: a tier at zero refuses ×1 too, and /odds cannot tell the client which tier is short.
    : ritual.error === 'RESTOCKING' && ritual.multi > 1 ? `Not enough in stock for a ×${ritual.multi} right now. Nothing was charged.`
    : ritual.error ? prepareErrorCopy(ritual.error)
    : targeted ? (canPull ? `Turn the crank — ${chasePrice}, ${chaseCards}` : freePulls > 0 ? 'Free pulls only work on $1 pulls — clear the target to use them' : 'Deposit to pull this album, or clear the target')
    : freePulls > 0 ? 'Free pull — turn the crank'
    : canPull ? 'Turn the crank — that\'s the $1' : '';
  // No idle "$1 a pull" under the machine (#340): the multipliers and the balance already say it. A chase or a free pull still names itself.
  const caption = targeted ? `${chasePrice} · ${chaseCards}` : freePulls > 0 ? `${freePulls} free pull${freePulls > 1 ? 's' : ''} left` : null;
  const targetAlbum = ritual.albumId ? albums.find((a) => a.id === ritual.albumId) ?? null : null;
  // Marquee (F5.5): published odds and the user's own session, interleaved as the design does. The
  // social feed (flags.socialTicker 'high') has no endpoint yet and stays off. A chase reads `marquee`,
  // which is cleared on enter and on album switch, so a prior album's pull does not stay on the line.
  const ticker = tickerText(oddsFacts(odds), sessionFacts(marquee, holdings, albums, ritual.albumId));
  // ×5/×10: the pile mounts when the roll hands off to the drop (#335) and stays mounted through the
  // drop, a sealed retry, and the tap, so the landing does not play twice (#389). Count from the
  // outcomes once they exist, so a pile never mounts as one capsule and then grows. ×1 keeps one capsule.
  const pileN = ritual.outcomes.length > 1 ? ritual.outcomes.length : multi;
  const multiPull = pileN > 1;
  const showBatch = phase === 'batchcaps' || (multiPull && (phase === 'dropping' || phase === 'sealed'));
  // A burn credits a free pull and awards no card, so the wait and a lost answer never show a capsule.
  const burnSettling = ritual.source === 'burn' && (phase === 'committing' || phase === 'sealed');
  const showCapsule = !showBatch && !multiPull && !burnSettling && (phase === 'dropping' || phase === 'capsule' || phase === 'sealed');
  const one = ritual.outcomes[0];
  const spec = one ? TIER[one.rarity] : null;
  const album = one?.albumId ? albums.find((a) => a.id === one.albumId) ?? null : null;
  // A share card is offered on a holo-or-better single reveal only (F2.11): commons and reverse holos do not get one.
  const shareable = CAN_SHARE_CARD && phase === 'card' && one !== undefined && spec && spec.lvl >= 2;

  // Milestones (design crack()): a new common that brings its album to 5, 10, 15 or 20 cards adds "N/25!" to the result
  // and bursts confetti (F3.4). The burst is keyed by the session's reveal count, so each milestone plays once.
  const albumHave = phase === 'card' && one && spec && !one.isDupe && spec.lvl < 1 && album ? albumProgress(album, holdings).have : 0;
  const milestoneHit = MILESTONES.includes(albumHave);
  useEffect(() => { if (milestoneHit) playSfx('chord'); }, [milestoneHit, pullsThisSession]);
  // Snow when the pull has a card new to the collector, or any rare (#345). All duplicates: none.
  // A batch of four or more of those gets a second shower. Milestone confetti stays its own burst.
  const snowN = phase === 'card' || phase === 'spread' ? snowCount(ritual.outcomes) : 0;
  const freshBurst = snowN >= 1 ? pullsThisSession : 0;
  const [freshAgain, setFreshAgain] = useState(0);
  useEffect(() => {
    if (snowN < 4) return;
    const t = setTimeout(() => setFreshAgain(pullsThisSession), CONFETTI_AGAIN_MS);
    return () => clearTimeout(t);
  }, [snowN, pullsThisSession]);
  const freshAgainTrigger = snowN >= 4 && freshAgain === pullsThisSession ? freshAgain : 0;

  const drawUrl = useDrawLink(ritual.prepared, phase === 'card' || phase === 'spread');
  // Result copy (design crack(): title/sub by tier and dupe state).
  let result: { chip: string; chipBg: string; chipInk: string; chipGlow: string; title: string; sub: string } | null = null;
  if (phase === 'card' && one && spec) {
    const v = TIER_VALUE_USD[one.rarity];
    const money = dollars(v);
    const slot = album?.cards.find((c) => c.id === one.cardId)?.slot;
    const milestone = milestoneHit ? ` · ${albumHave}/25!` : '';
    result = {
      chip: one.isDupe ? 'EXTRA' : spec.chip,
      chipBg: one.isDupe ? 'rgba(255,255,255,0.1)' : spec.lvl >= 1 ? spec.glow : color.mint,
      chipInk: one.isDupe ? color.text2 : spec.lvl >= 3 ? '#FFFFFF' : color.inkOnMint,
      chipGlow: one.isDupe ? 'rgba(0,0,0,0)' : spec.lvl >= 1 ? hexGlow(spec.glow) : 'rgba(143,227,197,0.6)',
      title: one.isDupe ? `Extra — ${one.card.name}` : `New! ${one.card.name}`,
      sub: spec.lvl >= 1 ? `about ${money} · kept in your rares` : one.isDupe ? 'Extras burn into free pulls.' : `Slot ${slot ?? '?'} of 25 · ${album?.title ?? ''}${milestone}`,
    };
  } else if (phase === 'spread') {
    const n = ritual.outcomes.length;
    result = { chip: `×${n}`, chipBg: color.yellow, chipInk: color.inkOnYellow, chipGlow: 'rgba(255,210,63,0.5)', title: `${n} pulled`, sub: spreadSummary(ritual.outcomes).text };
  }

  // Album complete (F3.5): once the card that filled an album is filed, the takeover claims its holo. It stays pending
  // through anything else until closed, so the reward is never lost. A complete album's binder reopens it (SHOW_TAKEOVER).
  const completedAlbum = phase === 'idle' && ritual.takeover ? albums.find((a) => a.id === ritual.takeover) ?? null : null;

  const resultBar = result ? (
    <ResultBar {...result} drawUrl={drawUrl} bonusChip={ritual.streakBonus === 2 ? STREAK_BONUS_CHIP : undefined} canSettle={(phase === 'card' && !settle) || (phase === 'spread' && allFlipped)} onSettle={() => { if (phase === 'card') setSettle((n) => n + 1); else { playSfx('tick'); dispatch({ type: 'INTO_BINDER' }); } }} />
  ) : null;
  // Sharing's own line rides with the result bar, not with the card: Into binder takes the pill away mid-capture, and the
  // answer to "did that work?" has to outlive it.
  // Just above the result bar: the 44pt chip, its padding, the border, and a few points of air.
  // It used to be a fixed 146, which was 76 above the old `bottom: 70`.
  const shareNoteBar = shareNote ? (
    <View style={[s.shareNote, { bottom: railHeight(insets.bottom) + RESULT_GAP + 76 }]} accessibilityRole="alert" accessibilityLiveRegion="polite" pointerEvents="none">
      <Text style={s.shareNoteText}>{SHARE_NOTE[shareNote]}</Text>
    </View>
  ) : null;
  const toast = credit && credit.at !== toastDoneAt ? (
    <View style={[s.toast, { top: insets.top + 60 }]} pointerEvents="none" accessibilityLiveRegion="polite">
      <View style={s.toastTick}><Text style={s.toastTickText}>✓</Text></View>
      <Text style={s.toastText}>{`Added $${credit.usd.toFixed(2)} — that's ${Math.floor(credit.usd)} pull${Math.floor(credit.usd) === 1 ? '' : 's'}. The machine's lit.`}</Text>
    </View>
  ) : null;

  return (
    <Page pinBottom overlay={<>
      {resultBar}{toast}{shareNoteBar}
    </>}>
      {/* First child, so the vignette sits behind the stage and darkens the room, never the machine. */}
      {ritual.night ? <NightVignette /> : null}
      {/* Off stage while a rare is revealed: view-shot captures a view that is rendered and attached, and Android needs
          collapsable={false} so the wrapper survives as a real native view. Hidden from screen readers: it is a copy of
          what the stage already reads out. */}
      {shareable && one ? (
        <View ref={shareRef} collapsable={false} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -(SHARE_W + 40), top: 0 }}>
          <ShareCard outcome={one} />
        </View>
      ) : null}
      {kept ? (
        <View style={s.banner} accessibilityRole="alert">
          <Text style={s.bannerText}>{kept.kind === 'burn' ? 'A burn is still settling — nothing is lost.' : waiting.length > 1 ? `${waiting.length} capsules are waiting to open — nothing is lost.` : 'A capsule is waiting to open — nothing is lost.'}</Text>
          <Pressable onPress={() => dispatch(kept.kind === 'burn' ? { type: 'RESUME_BURN', idem: kept.idem } : { type: 'RESUME', prepared: kept.prepared, txSignature: kept.txSignature })} disabled={!canOpenKept} hitSlop={6} style={[s.bannerBtn, !canOpenKept && { opacity: 0.5 }]} accessibilityRole="button" accessibilityLabel={kept.kind === 'burn' ? 'Try again' : 'Open it'} accessibilityState={{ disabled: !canOpenKept }}><Text style={s.bannerBtnText}>{kept.kind === 'burn' ? 'Try again' : 'Open it'}</Text></Pressable>
        </View>
      ) : null}
      {soldOutAlbum ? (
        <View style={s.banner} accessibilityRole="alert">
          <Text style={s.bannerText}>{`${soldOutAlbum.title} is sold out — pulls skip it until the restock on ${odds?.nextRestock ?? 'the next restock'}. Odds spread over ${openAlbums === 1 ? 'the other album' : `the other ${openAlbums} albums`}.`}</Text>
          <Pressable onPress={() => setSeenSoldOut((ids) => [...ids, soldOutAlbum.id])} hitSlop={6} style={s.bannerBtn} accessibilityRole="button"><Text style={s.bannerBtnText}>Got it</Text></Pressable>
        </View>
      ) : null}
      {targeted && targetAlbum ? (
        <View style={s.targetBanner} accessibilityRole="summary">
          <Text style={s.targetText} numberOfLines={2}>Pulling {targetAlbum.title} · any card in the album</Text>
          <Pressable onPress={() => dispatch({ type: 'SET_TARGET', albumId: null })} disabled={phase !== 'idle'} hitSlop={8} accessibilityRole="button"><Text style={[s.targetClear, phase !== 'idle' && { opacity: 0.5 }]}>Clear · back to $1</Text></Pressable>
        </View>
      ) : <View style={{ height: 12 }} />}
      {/* The stage is exactly the machine's width so every absolute overlay (capsule, pile, card, spread) centres on it. */}
      <Animated.View style={[s.stage, stageStyle]}>
        {/* Out of the accessibility tree until the count is real. The frost over the whole app is Home's veil.
            The same render that clears `balanceKnown` writes the real balance, so this never reads as 0 PULLS. */}
        <View
          accessibilityElementsHidden={!balanceKnown}
          importantForAccessibility={balanceKnown ? 'auto' : 'no-hide-descendants'}
          aria-hidden={balanceKnown ? undefined : true}
        >
        <Machine
          balanceUsd={balanceUsd}
          balanceKnown={balanceKnown}
          freePulls={freePulls}
          multi={multi as Multi}
          onMulti={onMulti}
          active={page === PAGE.pull}
          targeted={targeted}
          phase={phase}
          burnStep={ritual.burnStep}
          locked={!!ritual.takeover}
          capsuleCount={targetAlbum ? targetCapsules(targetAlbum) : undefined}
          capsuleColors={targetAlbum ? [albumSwatch(targetAlbum.id)] : undefined}
          tickerText={ticker}
          onDeposit={() => setPage(PAGE.wallet)}
          restocking={restocking}
          onBrowse={() => setPage(PAGE.albums)}
          onCrankStart={onCrankStart}
          onCrankAbandon={onCrankAbandon}
          onRelease={onRelease}
          onCrankActive={lockPager}
          crankRef={crankRef}
          reelStop={ritual.reelStop}
          showRoll={phase === 'rolling' || phase === 'stopping'}
          rollFlash={phase === 'stopping'}
          rollFlashMs={stopPlan(multi).flashMs}
          rollActions={phase === 'rolling' && rollWait.actions}
          onRollKeep={rollKeep}
          onRollNotify={rollNotify}
        />
        </View>
        {showCapsule ? <ScratchCapsule tier={one?.rarity ?? null} shellColor={targeted && targetAlbum ? albumSwatch(targetAlbum.id) : undefined} interactive={phase === 'capsule'} onCrack={onCrack} onActive={lockPager} /> : null}
        {phase === 'sealed' ? (
          <View style={s.sealedRow}>
            {/* Try again sends the same pull or burn again; Later leaves it with the session, whose banner opens it again. */}
            {cannotOpen ? null : <Pressable onPress={() => dispatch({ type: 'RETRY_COMMIT' })} style={s.retry} accessibilityRole="button"><Text style={s.retryText}>Try again</Text></Pressable>}
            <Pressable onPress={() => { dispatch({ type: 'RESET' }); void refreshCost(); }} style={s.startOver} accessibilityRole="button"><Text style={s.startOverText}>{cannotOpen ? 'Start over' : 'Later'}</Text></Pressable>
          </View>
        ) : null}
        {showBatch ? (
          <BatchPile
            key="batch-pile"
            count={pileN}
            outcomes={ritual.outcomes.length > 1 ? ritual.outcomes : undefined}
            label={phase === 'batchcaps' ? 'tap' : 'none'}
            onOpen={onOpenPile}
          />
        ) : null}
        {phase === 'spread' ? <View style={s.spreadWrap}><Spread outcomes={ritual.outcomes} width={STAGE_W + 60} onFlipped={onFlipped} onShake={onShake} onFlash={onFlash} onAllFlipped={onAllFlipped} /></View> : null}
        {/* The card, its tags above and the slot strip below (stage 60 to 510): in a short browser window the page is still
            scrolled down to the capsule, and the card's top would sit under the header (web only; nothing on the apps). */}
        {phase === 'card' && one ? <ScrollHere top={60} height={450} testID="card-rest" /> : null}
        {phase === 'card' && one ? (
          <CardReveal outcome={one} album={album} holdings={holdings} settle={settle} onSettled={onSettled} onShake={onShake} onFlash={onFlash} stageWidth={STAGE_W} />
        ) : null}
        {/* Share (F2.11) sits under the card's own line, where the eye already is, and leaves with the card at Into binder.
            The result bar keeps the design's single CTA: a second button there squeezed the card's name to "New! H…". */}
        {shareable && !settle ? (
          <View style={s.shareRow} pointerEvents="box-none">
            <Pressable
              onPress={onShare}
              disabled={shareBusy}
              hitSlop={10}
              style={({ pressed }) => [s.share, (pressed || shareBusy) && { opacity: 0.7, transform: [{ scale: 0.96 }] }]}
              accessibilityRole="button"
              accessibilityLabel="Share"
              accessibilityState={{ disabled: shareBusy, busy: shareBusy }}
            >
              <Text style={s.shareText}>Share</Text>
            </Pressable>
          </View>
        ) : null}
        {burst && one && phase === 'card' ? <Burst key={burst} x={STAGE_W / 2} y={560} color={spec?.glow ?? color.mint} seed={burst} /> : null}
        <Flash trigger={flash} />
        <Confetti trigger={freshBurst} width={STAGE_W} />
        <Confetti trigger={freshAgainTrigger} width={STAGE_W} />
        <Confetti trigger={milestoneHit ? pullsThisSession : 0} width={STAGE_W} />
      </Animated.View>
      {ritual.night ? <NightStars height={700} seed={burst} /> : null}
      {hint ? <Text testID="pull-hint" style={s.hint}>{hint}</Text> : null}
      {sealed ? <Text style={s.caption}>{sealed.body}</Text> : caption ? <Text style={s.caption}>{caption}</Text> : null}
      {targeted && targetAlbum ? (
        <AlbumPicker albums={albums} holdings={holdings} selectedId={targetAlbum.id} disabled={phase !== 'idle'} onPick={(id) => dispatch({ type: 'SET_TARGET', albumId: id })} />
      ) : null}
      <SessionTray recent={recent} pulled={pullsThisSession} />
      {completedAlbum ? (
        <AlbumCompleteTakeover
          key={completedAlbum.id}
          album={completedAlbum}
          finisher={ritual.completingAlbumId === completedAlbum.id ? ritual.completingCard ?? null : null}
          onClaim={async () => {
            const gift = (await claimCompletion(completedAlbum.id)).gift;
            // Empty is not "already claimed": the cover stays on the error, and the album stays unclaimed.
            if (gift?.status !== 'confirmed') throw new ApiError({ code: 'UNKNOWN', message: 'Your Degen pack is temporarily unavailable. Try again.' });
            return gift;
          }}
          onDone={() => dispatch({ type: 'TAKEOVER_DONE' })}
        />
      ) : null}
    </Page>
  );
}

const s = StyleSheet.create({
  stage: { width: STAGE_W, alignSelf: 'center' },
  // Opaque mint-on-navy: RN has no backdrop blur, so the design's translucent mint glass let the sold-out banner's text show through.
  toast: { position: 'absolute', left: 14, right: 14, zIndex: 7, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1D3337', borderWidth: 1, borderColor: 'rgba(143,227,197,0.55)', borderRadius: 14, paddingVertical: 10, paddingHorizontal: 14, shadowColor: '#000', shadowOpacity: 0.5, shadowRadius: 15, shadowOffset: { width: 0, height: 10 } },
  toastTick: { width: 26, height: 26, borderRadius: 13, backgroundColor: color.mint, alignItems: 'center', justifyContent: 'center' },
  toastTickText: { fontFamily: font.black, fontSize: 13, color: color.inkOnMint },
  toastText: { flex: 1, fontFamily: font.extrabold, fontSize: 12.5, color: '#B9F0DC', lineHeight: 17 },
  banner: { marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: 'rgba(255,210,63,0.12)', borderWidth: 1, borderColor: 'rgba(255,210,63,0.5)', borderRadius: 14, paddingVertical: 9, paddingLeft: 14, paddingRight: 8 },
  bannerText: { flex: 1, fontFamily: font.extrabold, fontSize: 12, color: color.marqueeInk, lineHeight: 16 },
  bannerBtn: { borderRadius: 99, paddingVertical: 6, paddingHorizontal: 11, backgroundColor: color.yellow },
  bannerBtnText: { fontFamily: font.extrabold, fontSize: 11, color: color.inkOnYellow },
  targetBanner: { marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'rgba(143,227,197,0.1)', borderWidth: 1, borderColor: 'rgba(143,227,197,0.4)', borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12 },
  targetText: { flex: 1, fontFamily: font.extrabold, fontSize: 12, color: color.text, lineHeight: 16 },
  targetClear: { fontFamily: font.extrabold, fontSize: 12, color: color.mint, textDecorationLine: 'underline' },
  hint: { marginTop: 6, textAlign: 'center', fontFamily: font.extrabold, fontSize: 13, lineHeight: 18, color: color.text },
  caption: { marginTop: 6, textAlign: 'center', fontFamily: font.semibold, fontSize: 11, color: color.text2 },
  spreadWrap: { position: 'absolute', left: -30, top: 0, width: STAGE_W + 60, height: 640, zIndex: 6 },
  shareRow: { position: 'absolute', left: 0, right: 0, top: 512, alignItems: 'center', zIndex: 7 },
  share: { borderRadius: 99, paddingVertical: 9, paddingHorizontal: 20, borderWidth: 1, borderColor: color.glassBorder, backgroundColor: 'rgba(14,19,38,0.94)' },
  shareText: { fontFamily: font.extrabold, fontSize: 13, color: color.text },
  shareNote: { position: 'absolute', left: 24, right: 24, alignItems: 'center', paddingVertical: 8, paddingHorizontal: 14, borderRadius: 14, backgroundColor: 'rgba(14,19,38,0.94)', borderWidth: 1, borderColor: color.glassBorder, zIndex: 7 },
  shareNoteText: { fontFamily: font.semibold, fontSize: 12, color: color.text2, textAlign: 'center' },
  sealedRow: { position: 'absolute', left: 0, right: 0, top: 616, flexDirection: 'row', justifyContent: 'center', gap: 8, zIndex: 6 },
  retry: { width: 140, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: color.mint },
  retryText: { fontFamily: font.extrabold, fontSize: 13, color: color.inkOnMint },
  startOver: { width: 110, alignItems: 'center', paddingVertical: 8, borderRadius: 12, backgroundColor: color.glassBg, borderWidth: 1, borderColor: color.glassBorder },
  startOverText: { fontFamily: font.extrabold, fontSize: 13, color: color.text2 },
});
