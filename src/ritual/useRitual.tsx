// Host for the ritual reducer: runs its effects against the session (prepare, sign, commit, burn)
// and feeds the results back as events. One ritual per app, provided above the pager so the Pull
// page drives it and the binder can target it (SET_TARGET); screens read `ritual` and dispatch.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as Haptics from 'expo-haptics';
import { useReducedMotion } from 'react-native-reanimated';
import { USDC_BASE, pullCostUsd, type Outcome, type PullPrepareResponse } from '@/api/contract';
import { answerLost, toApiError } from '@/api/errors';
import { newIdempotencyKey } from '@/api/http';
import { track } from '@/analytics';
import { playSfx, setRollLoop } from '@/audio/sfx';
import { PAGE, useSession, type Session } from '@/state/session';
import { useSeason, type PullGrant } from '@/state/season';
import { chaseMarqueeReset, initialRitual, outcomesJustRevealed, reduce, type BurnStep, type Effect, type Event, type Ritual } from './reducer';
import { DROP_MS, POLL_MS, rollFloorMs, stopPlan } from './rollTiming';
import { useRollWait } from './useRollWait';

type Dispatch = (e: Event) => void;

type RitualHandle = {
  ritual: Ritual;
  dispatch: Dispatch;
  /** Hint for `rolling` / `stopping` / `dropping`. `actions` is only true while still rolling. */
  rollWait: { text: string; actions: boolean };
  rollKeep: () => void;
  rollNotify: () => void;
};
const RitualCtx = createContext<RitualHandle | null>(null);

export function RitualProvider({ children }: { children: React.ReactNode }) {
  const handle = useRitualHost();
  return <RitualCtx.Provider value={handle}><StreakGrantBridge />{children}</RitualCtx.Provider>;
}

/** Applies a commit's ticket grant when the card (or a sealed capsule) is what the collector sees. */
function StreakGrantBridge() {
  const { ritual } = useRitual();
  const { revealGrant } = useSeason();
  const phase = ritual.phase;
  useEffect(() => {
    if (phase === 'card' || phase === 'spread' || phase === 'sealed') revealGrant();
  }, [phase, revealGrant]);
  return null;
}

export function useRitual(): RitualHandle {
  const v = useContext(RitualCtx);
  if (!v) throw new Error('useRitual outside RitualProvider');
  return v;
}

/** The burn hand-off (F4.2, design doBurn), in ms from pressing Burn: the copies gather until ignition at 1.15 s, the page
 *  slides to the machine at 1.5 s, embers stream into the dome at 1.95 s, and at 2.95 s the dome flashes and the crank arms. */
export const BURN_TIMELINE: readonly (readonly [BurnStep, number])[] = [['ignite', 1150], ['slide', 1500], ['stream', 1950], ['flash', 2950]];

type PendingCommit = { pullId: string; outcomes: Outcome[]; albumCompleted?: string; streakBonus: 0 | 2 };

function useRitualHost(): RitualHandle {
  const session = useSession();
  const [ritual, setRitual] = useState<Ritual>(initialRitual);
  const stateRef = useRef<Ritual>(initialRitual);
  const sessionRef = useRef<Session>(session);
  const dispatchRef = useRef<Dispatch>(() => {});
  // A fast commit waits out the tier floor before `stopping`. The answer is parked until the floor
  // timer opens; a slow commit finds the floor already open and stops at once. ×1 and ×10 floors are 0.
  const floorOpen = useRef(true);
  const pendingCommit = useRef<PendingCommit | null>(null);
  const rollGen = useRef(0);
  // Once this host has gone (sign-out, the geo-block screen) nobody is at its crank, so a prepare's answer that comes back to it
  // arms nothing: a turn it was waiting on must not sign a pull the next host may already have superseded. A signature or a
  // commit already out still goes through.
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { sessionRef.current = session; }, [session]);
  // A pull's cards wait in the session until this host reveals them. Registering tells the session a reveal can still happen;
  // unmounting (sign-out, the geo-block screen) hands back whatever was left waiting.
  const { attachRitual } = session;
  const season = useSeason();
  const grantNote = useRef(season.noteGrant);
  const grantReveal = useRef(season.revealGrant);
  useEffect(() => { grantNote.current = season.noteGrant; grantReveal.current = season.revealGrant; }, [season.noteGrant, season.revealGrant]);
  useEffect(() => attachRitual(), [attachRitual]);

  const finishRoll = useCallback(() => {
    const pending = pendingCommit.current;
    if (!pending || !floorOpen.current || !mounted.current) return;
    const r = stateRef.current;
    if (r.phase !== 'rolling' || r.prepared?.pullId !== pending.pullId) return;
    pendingCommit.current = null;
    dispatchRef.current({ type: 'COMMITTED', outcomes: pending.outcomes, albumCompleted: pending.albumCompleted, streakBonus: pending.streakBonus });
  }, []);

  const deliverCommit = useCallback((pullId: string, outcomes: Outcome[], albumCompleted?: string, streakBonus: 0 | 2 = 0) => {
    if (stateRef.current.phase !== 'rolling' || stateRef.current.prepared?.pullId !== pullId) return;
    pendingCommit.current = { pullId, outcomes, albumCompleted, streakBonus };
    finishRoll();
  }, [finishRoll]);

  const dispatch = useCallback<Dispatch>((e) => {
    if (!mounted.current && (e.type === 'PREPARED' || e.type === 'PREPARE_FAILED' || e.type === 'REPRICED')) return;
    const prev = stateRef.current;
    // The hand left an armed crank: that prepare's free pulls go back on the counter. The reservation expires on the server.
    if (e.type === 'CRANK_ABANDONED' && prev.phase === 'armed' && prev.prepared) sessionRef.current.releasePreparedPull(prev.prepared.pullId);
    const [next, effects] = reduce(prev, e);
    stateRef.current = next;
    // A prepare answer the machine did not keep (the crank was let go, or grabbed again) must not leave its free pulls off
    // the counter. `run` cannot see this ref: it lives on the host.
    if (e.type === 'PREPARED' && next.prepared?.pullId !== e.res.pullId) sessionRef.current.releasePreparedPull(e.res.pullId);
    setRitual(next);
    // The price leaves the pill as the wait starts. A resume or a retry already spent it; debiting again would double it.
    // Free pulls left the counter at prepare. A sign that never completes reads the cost back (run's sign catch).
    if (next.phase === 'rolling' && (prev.phase === 'armed' || prev.phase === 'preparing')) {
      const usd = next.prepared?.costUsd ?? 0;
      if (usd > 0) sessionRef.current.optimisticPullDebit(usd);
    }
    if (e.type === 'COMMITTED' && prev.phase === 'rolling') {
      track('pull_committed', { count: e.outcomes.length, targeted: prev.targeted, freePulls: prev.prepared?.useFreePulls ?? (prev.source === 'burn' ? 1 : 0), costUsd: prev.prepared?.costUsd ?? 0 });
      if (e.albumCompleted) track('album_completed', { albumId: e.albumCompleted });
    }
    const revealed = outcomesJustRevealed(e, prev, next);
    if (revealed) {
      for (const o of revealed) track('pull_revealed', { rarity: o.rarity, isDupe: o.isDupe, albumId: o.albumId, source: next.source, count: revealed.length });
      sessionRef.current.revealed(revealed);
    }
    if (chaseMarqueeReset(e, prev, next)) sessionRef.current.clearMarquee();
    if (next.phase === 'rolling' && prev.phase !== 'rolling') {
      pendingCommit.current = null;
      const floor = rollFloorMs(next.multi);
      const pullId = next.prepared?.pullId;
      const gen = ++rollGen.current;
      floorOpen.current = floor <= 0;
      if (floor > 0 && pullId) {
        setTimeout(() => {
          if (rollGen.current !== gen) return;
          if (stateRef.current.phase !== 'rolling' || stateRef.current.prepared?.pullId !== pullId) return;
          floorOpen.current = true;
          finishRoll();
        }, floor);
      }
    }
    const waiting = (pullId: string) => mounted.current && stateRef.current.phase === 'rolling' && stateRef.current.prepared?.pullId === pullId;
    for (const fx of effects) void run(fx, sessionRef.current, dispatchRef.current, waiting, deliverCommit, (grant) => grantNote.current(grant), () => grantReveal.current());
  }, [deliverCommit, finishRoll]);

  useEffect(() => { dispatchRef.current = dispatch; }, [dispatch]);

  const phase = ritual.phase;
  const multi = ritual.multi;
  const reduced = useReducedMotion() === true;
  const roll = useRollWait(phase, multi);
  // The ratchet covers the whole dispense: the wait, the reel lock, and the drop. It stops when that window ends
  // (capsule, pile, sealed, idle), which is before the land one-shot. One boolean so the lock does not restart it.
  const dispensing = phase === 'rolling' || phase === 'stopping' || phase === 'dropping';
  useEffect(() => {
    setRollLoop(dispensing);
    return () => setRollLoop(false);
  }, [dispensing]);
  // Stop and drop live here, not on the page: swiping away must not freeze the phase on `stopping`.
  useEffect(() => {
    if (phase !== 'stopping') return;
    const k = reduced ? 0.5 : 1;
    const plan = stopPlan(multi);
    const timers: ReturnType<typeof setTimeout>[] = [];
    plan.lockMs.forEach((ms, i) => {
      timers.push(setTimeout(() => {
        dispatch({ type: 'REEL_STEP', stop: (i + 1) as 1 | 2 | 3 });
        playSfx('click');
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }, ms * k));
    });
    timers.push(setTimeout(() => { playSfx('shimmer'); }, plan.shimmerMs * k));
    timers.push(setTimeout(() => { dispatch({ type: 'ROLL_DONE' }); }, plan.stopMs * k));
    return () => { for (const t of timers) clearTimeout(t); };
  }, [phase, reduced, dispatch, multi]);
  useEffect(() => {
    if (phase !== 'dropping') return;
    const t = setTimeout(() => { dispatch({ type: 'DROP_DONE' }); }, DROP_MS);
    return () => clearTimeout(t);
  }, [phase, dispatch]);

  return useMemo(() => ({ ritual, dispatch, rollWait: { text: roll.text, actions: roll.actions }, rollKeep: roll.keep, rollNotify: roll.notify }), [ritual, dispatch, roll.text, roll.actions, roll.keep, roll.notify]);
}

/** A figure off the wire, or NaN when it is not one. Arithmetic coerces `null`, `''` and `false` to 0 — the most permissive
 *  price there is — so a field the client cannot read as a number must never be allowed to look like "free". */
const wireNumber = (v: unknown): number => (typeof v === 'number' ? v : NaN);

/** A quote's own id, usable as one: it is what the commit goes out with, what a kept pull is filed under, and what a transfer
 *  has to name. Neither `''` nor anything that is not a string is an id. */
const usableId = (pullId: unknown): boolean => typeof pullId === 'string' && pullId !== '';

/** Whether a quote names the pull it is for. The contract fixes a transfer's memo to its own quote's `pullId` (BUILD_PLAN §2)
 *  and the server reads it back to match a payment to the pull it commits, so a memo naming a different pull pays for that one.
 *  Written as a positive that has to succeed: an absent, non-string or foreign memo all fail it, and so does a quote with no
 *  usable id of its own to have named — which is checked with or without a transfer, because the id is what the commit goes out
 *  with either way. */
const namesItsPull = (res: PullPrepareResponse): boolean =>
  usableId(res.pullId) && (!res.transfer || res.transfer.memo === res.pullId);

async function run(
  fx: Effect,
  s: Session,
  dispatch: Dispatch,
  waiting: (pullId: string) => boolean,
  deliverCommit: (pullId: string, outcomes: Outcome[], albumCompleted?: string, streakBonus?: 0 | 2) => void,
  noteGrant: (grant: PullGrant) => void,
  revealGrant: () => void,
) {
  try {
    switch (fx.type) {
      case 'prepare': {
        // The machine showed a price when the crank started, and the server's quote is the truth. If the quote asks more (free
        // pulls already used, a screen that could not refresh), nothing is signed: the machine goes back to idle, says what the
        // pull costs, and reads the cost again. `s` is the session the crank started from. Every answer carries `fx.seq`, so the
        // ritual drops one from a grab that was let go and grabbed again.
        // Both halves of the quote are checked against the price the machine showed, and the larger one decides: `transfer.amount`
        // is what the wallet would sign, and `costUsd` is what the server's ledger debits (the mock charges it, and skips the
        // signature entirely when there is no transfer). Checking either one alone lets the other ask for more.
        // Then the pull it names (below), and then where the money goes: the server builds the transaction the wallet signs, so
        // `s.paymentSignable` decodes it and holds its mint, destination, amount, authority and memo to what this build pinned
        // (#186). Nothing in the quote supplies the expected treasury — a server that can move the destination could move that too.
        const shownBase = Math.round(pullCostUsd(fx.multi, fx.targeted, s.freePulls) * USDC_BASE);
        const res = await s.preparePull({
          count: fx.multi,
          targeted: fx.targeted,
          albumId: fx.albumId,
        });
        // No transfer at all means nothing to sign, which is honestly 0; a transfer whose amount cannot be read is not.
        const quotedBase = Math.max(res.transfer ? wireNumber(res.transfer.amount) : 0, Math.round(wireNumber(res.costUsd) * USDC_BASE));
        // Written as "not provably at or under the price shown", so the pull arms only on a comparison that actually succeeded.
        // A missing or non-numeric price makes `quotedBase` NaN, and every comparison with NaN is false: asking `quoted > shown`
        // would answer "no" and wave through whatever the transfer beside it asks.
        if (!(quotedBase <= shownBase)) {
          // A quote that cannot be priced has no figure to put on the machine — a reprice would read "$NaN" — so it is a plain
          // refusal instead.
          if (Number.isFinite(quotedBase)) dispatch({ type: 'REPRICED', seq: fx.seq, costUsd: quotedBase / USDC_BASE });
          else dispatch({ type: 'PREPARE_FAILED', seq: fx.seq, code: 'UNKNOWN' });
          // Prepare already took its free pulls off the counter. The re-read below is the server's count; drop the hold so a
          // later release cannot add them on top of it.
          s.settlePreparedPull(res.pullId);
          void s.refreshCost();
          return;
        }
        // The price is right; now check the quote names the pull it is for. The memo's expected value is in the same
        // response, so this needs nothing pinned: an honest $1 to the right treasury carrying someone else's pull id. Signing it would pay for that pull instead: the
        // commit for this id then finds no payment, and the sealed copy tells the user nothing was taken. Refused like an
        // unpriceable quote, but with no `refreshCost()` beside it: a misdirected quote says nothing about the price being
        // stale, and re-reading copies the server's reservation for the quote just refused onto the screen — free pulls gone,
        // the price up — after a refusal that spent nothing. The free pulls prepare took off the counter go back on, for the
        // same reason. Checked after the price, so a quote that is both overpriced and
        // misdirected still reprices, which is the more actionable of the two messages.
        if (!namesItsPull(res)) {
          s.releasePreparedPull(res.pullId);
          dispatch({ type: 'PREPARE_FAILED', seq: fx.seq, code: 'UNKNOWN' });
          return;
        }
        // A paid quote whose transaction would pay anyone, anything or any pull other than what the build expects is refused the
        // same way, before a signature is asked for, and for the same reason with no `refreshCost()`. `signTransfer` checks
        // again, so this is where the refusal is kind, not where it is enforced.
        if (res.transfer && !s.paymentSignable(res)) {
          s.releasePreparedPull(res.pullId);
          dispatch({ type: 'PREPARE_FAILED', seq: fx.seq, code: 'UNKNOWN' });
          return;
        }
        dispatch({ type: 'PREPARED', seq: fx.seq, res });
        return;
      }
      case 'sign': {
        const txSignature = await s.signTransfer(fx.prepared);
        dispatch({ type: 'SIGNED', txSignature });
        return;
      }
      case 'commit': {
        // A lost answer (timeout, unreadable body) stays on the reels and retries the same commit. The server is idempotent.
        // There is no GET /pull/:id. A definitive refusal still fails the pull. Unmount stops the loop.
        for (;;) {
          try {
            const res = await s.commitPull({ pullId: fx.pullId, txSignature: fx.txSignature });
            const streakBonus = res.streakBonus === 2 ? 2 : 0;
            noteGrant({
              ticketsEarned: res.ticketsEarned ?? 0,
              streakBonus,
              myTickets: res.myTickets ?? 0,
              streak: res.streak ?? { count: 0, countedToday: false },
            });
            if (waiting(fx.pullId)) deliverCommit(fx.pullId, res.outcomes, res.albumCompleted, streakBonus);
            else revealGrant();
            return;
          } catch (e) {
            const code = toApiError(e).code;
            if (!answerLost(code) || !waiting(fx.pullId)) {
              if (waiting(fx.pullId)) dispatch({ type: 'COMMIT_FAILED', code });
              return;
            }
            await new Promise((done) => setTimeout(done, POLL_MS));
            if (!waiting(fx.pullId)) return;
          }
        }
      }
      case 'burnSequence': {
        let at = 0;
        for (const [step, t] of BURN_TIMELINE) {
          await new Promise((done) => setTimeout(done, t - at));
          at = t;
          dispatch({ type: 'BURN_STEP', step });
          if (step === 'slide') s.setPage(PAGE.pull);
        }
        dispatch({ type: 'BURN_ARMED', idem: newIdempotencyKey() });
        return;
      }
      case 'burn': {
        await s.burn(fx.idem);
        dispatch({ type: 'BURN_CREDITED' });
        return;
      }
    }
  } catch (e) {
    const err = toApiError(e);
    if (fx.type === 'prepare') {
      dispatch({ type: 'PREPARE_FAILED', seq: fx.seq, code: err.code });
      // A refused prepare can mean the machine's price is stale (free pulls already used, a balance that moved): read it again,
      // or the machine keeps offering a pull the server will not prepare.
      void s.refreshCost();
    } else if (fx.type === 'sign') {
      // The wait already took the price off the pill. Nothing was signed, so the server's figure goes back.
      void s.refreshCost();
      dispatch({ type: 'COMMIT_FAILED', code: err.code });
    } else if (fx.type !== 'commit') dispatch({ type: 'COMMIT_FAILED', code: err.code });
  }
}
