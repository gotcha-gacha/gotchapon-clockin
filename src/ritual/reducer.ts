// The pull ritual's logical state (design/README.md "The pull ritual — state machine"), kept pure
// so it can be tested without a screen. Timing (520 ms drop, scratch threshold, reveal durations)
// lives in the components; this decides *what* happens, never *when it animates*.
//
//   idle ──crank starts──▶ preparing ──prepared──▶ armed ──crank 360° (release)──▶ rolling
//   rolling ──committed──▶ stopping (reels lock) ──▶ dropping ──×1──▶ capsule ──cracked──▶ card ──into binder──▶ idle
//   dropping ──×5/×10──▶ batchcaps ──tap pile──▶ spread ──done──▶ idle
//   rolling ──commit failed after payment, or a free pull's answer lost──▶ sealed ──try again──▶ rolling, or ──later──▶ idle (the session keeps the pull)
//   A lost answer while rolling is the host's to poll; this reducer still seals if that failure is delivered.
//   idle ──open a kept pull (resume)──▶ rolling …
//   idle ──burn 5 extras──▶ burning (hand-off plays, crank locked) ──armed──▶ committing (credits one free pull, no card; a burn never rolls) ──credited──▶ idle
//   committing ──a burn's answer lost──▶ sealed ──try again──▶ committing
//
// Release before prepare has answered is remembered and fires the commit the moment it does.
// Each prepare goes out numbered, and only the latest one's answer counts: grab, let go and grab again leaves an older prepare
// out, and its answer is dropped in whichever order the two come back.
import type { ApiErrorCode, CardRef, Outcome, PullCount, PullPrepareResponse, Tier } from '@/api/contract';
import { answerLost } from '@/api/errors';

const isNight = (t?: Tier) => t === 'ultra' || t === 'graded';

export type Phase = 'idle' | 'preparing' | 'armed' | 'rolling' | 'stopping' | 'dropping' | 'committing' | 'capsule' | 'card' | 'batchcaps' | 'spread' | 'sealed' | 'coined' | 'burning';

/** The burn hand-off (F4.2): copies gather and ignite on Albums, the page slides, embers stream into the dome, it flashes. */
export type BurnStep = 'gather' | 'ignite' | 'slide' | 'stream' | 'flash';

export type Ritual = {
  phase: Phase;
  multi: PullCount;
  targeted: boolean;
  albumId?: string;
  prepared?: PullPrepareResponse;
  releasePending: boolean;
  /** The number the latest prepare went out with. An answer carrying an older one is from a grab that was let go, whose pull the
   *  server may already have superseded: it arms, fails or reprices nothing. Only ever counts up within a host, through Into binder,
   *  Later, Open it and a burn; a new host (sign-out, the geo-block screen) starts again at 0 and takes no answer it did not send. */
  prepareSeq: number;
  txSignature?: string;
  /** A burn's idempotency key, from the moment it is armed: a sealed burn goes out again with it, never as a second burn. */
  burnIdem?: string;
  outcomes: Outcome[];
  albumCompleted?: string;
  error?: ApiErrorCode;
  /** The server quoted more than the machine showed when the crank started (free pulls already used, a stale screen): nothing
   *  was signed, the machine is idle again, and this is what the pull costs. */
  repriced?: number;
  /** Source of the pull in flight: paid/free crank, or a burn. */
  source: 'crank' | 'burn';
  /** Where the burn hand-off is: set while burning and kept while the burn request is out, so the dome's flash plays once. */
  burnStep?: BurnStep;
  /** An album the pull just filed completed (F3.5): its takeover shows until TAKEOVER_DONE, and no pull or burn starts
   *  behind it (a shake reaches the crank through the modal). */
  takeover?: string;
  /** The card that filled `completingAlbumId`, kept for the COMPLETE hero and a later reopen of that album. */
  completingAlbumId?: string;
  completingCard?: CardRef;
  /** Ultra+ reveals turn the room into a night sky that persists until the next pull starts. */
  night: boolean;
  /** How many tray reels have locked during `stopping` (0–3, left to right). */
  reelStop: number;
  /** +2 when this pull counted streak day 5. The result bar's chip reads it and Into binder clears it. */
  streakBonus: 0 | 2;
};

export type Event =
  | { type: 'SET_MULTI'; multi: PullCount }
  | { type: 'SET_TARGET'; albumId: string | null }
  | { type: 'CRANK_START' }
  | { type: 'PREPARED'; seq: number; res: PullPrepareResponse }
  | { type: 'PREPARE_FAILED'; seq: number; code: ApiErrorCode }
  | { type: 'REPRICED'; seq: number; costUsd: number }
  | { type: 'CRANK_ABANDONED' }
  | { type: 'RELEASE' }
  | { type: 'SIGNED'; txSignature: string }
  | { type: 'COMMITTED'; outcomes: Outcome[]; albumCompleted?: string; streakBonus?: 0 | 2 }
  | { type: 'REEL_STEP'; stop: 1 | 2 | 3 }
  | { type: 'ROLL_DONE' }
  | { type: 'DROP_DONE' }
  | { type: 'COMMIT_FAILED'; code: ApiErrorCode }
  | { type: 'RETRY_COMMIT' }
  | { type: 'RESUME'; prepared: PullPrepareResponse; txSignature?: string }
  | { type: 'RESUME_BURN'; idem: string }
  | { type: 'CRACKED' }
  | { type: 'OPEN_PILE' }
  | { type: 'INTO_BINDER' }
  | { type: 'BURN_STARTED' }
  | { type: 'BURN_STEP'; step: BurnStep }
  | { type: 'BURN_ARMED'; idem: string }
  | { type: 'BURN_CREDITED' }
  | { type: 'TAKEOVER_DONE' }
  | { type: 'SHOW_TAKEOVER'; albumId: string }
  | { type: 'FLIPPED'; rarity: Tier }
  | { type: 'RESET' };

/** Side effects the host must perform after a transition. A prepare's answer goes back with the prepare's `seq`. */
export type Effect =
  | { type: 'prepare'; seq: number; multi: PullCount; targeted: boolean; albumId?: string }
  | { type: 'sign'; prepared: PullPrepareResponse }
  | { type: 'commit'; pullId: string; txSignature?: string }
  | { type: 'burn'; idem: string }
  | { type: 'burnSequence' };

export const initialRitual: Ritual = { phase: 'idle', multi: 1, targeted: false, releasePending: false, prepareSeq: 0, outcomes: [], source: 'crank', night: false, reelStop: 0, streakBonus: 0 };

/** A pull, a burn, a resumed pull or the binder's takeover can only start on an idle machine with no album-complete takeover up. */
export function canStart(r: Ritual): boolean {
  return r.phase === 'idle' && !r.takeover;
}

/** What every pull that starts from an idle machine clears from the last one (a crank, a resume, a burn). A function, so
 *  `outcomes` is a new array each time. */
const newPull = () => ({ prepared: undefined, burnIdem: undefined, releasePending: false, outcomes: [] as Outcome[], error: undefined, repriced: undefined, night: false, reelStop: 0, streakBonus: 0 as const });
/** The hand-off is one untargeted ×1 so a turn during it cannot start a paid pull. The burn credits a free pull and awards no card. */
const BURN_PULL = { source: 'burn', multi: 1, targeted: false, albumId: undefined } as const;
/** A prepare's answer counts only while the machine waits on that very prepare: an older grab's answer is stale in either order. */
const answersLatestPrepare = (r: Ritual, e: { seq: number }) => r.phase === 'preparing' && e.seq === r.prepareSeq;

export function reduce(r: Ritual, e: Event): [Ritual, Effect[]] {
  switch (e.type) {
    case 'SET_MULTI':
      // A stock refusal was about the size it refused: a new size clears it rather than being described by it.
      return r.phase === 'idle' ? [{ ...r, multi: e.multi, repriced: undefined, ...(r.error === 'RESTOCKING' ? { error: undefined } : {}) }, []] : [r, []];
    case 'SET_TARGET':
      // Entering a chase starts at ×1. ×5 and ×10 stay selectable afterwards (#396). Clearing the chase keeps the size.
      return r.phase === 'idle' ? [{ ...r, targeted: e.albumId !== null, albumId: e.albumId ?? undefined, multi: e.albumId ? 1 : r.multi, repriced: undefined }, []] : [r, []];
    case 'CRANK_START': {
      if (!canStart(r)) return [r, []];
      const prepareSeq = r.prepareSeq + 1;
      return [{ ...r, ...newPull(), phase: 'preparing', source: 'crank', prepareSeq }, [{ type: 'prepare', seq: prepareSeq, multi: r.multi, targeted: r.targeted, albumId: r.albumId }]];
    }
    case 'PREPARED': {
      if (!answersLatestPrepare(r, e)) return [r, []];
      const next: Ritual = { ...r, phase: 'armed', prepared: e.res };
      if (r.releasePending) return release(next);
      return [next, []];
    }
    case 'PREPARE_FAILED':
      return answersLatestPrepare(r, e) ? [{ ...r, phase: 'idle', error: e.code, releasePending: false }, []] : [r, []];
    case 'REPRICED':
      // The quote asks more than the machine showed: nothing is signed, whether the hand is still on the crank or already let go.
      return answersLatestPrepare(r, e) ? [{ ...r, phase: 'idle', prepared: undefined, releasePending: false, repriced: e.costUsd }, []] : [r, []];
    case 'CRANK_ABANDONED':
      // Hand came off before 360°: the prepared pull simply expires server-side (60 s); nothing was charged. A turn that already
      // reached 360° while the prepare was out is a release, not a let-go: a later touch or shake that comes off leaves it waiting.
      return (r.phase === 'preparing' && !r.releasePending) || r.phase === 'armed' ? [{ ...r, phase: 'idle', prepared: undefined, releasePending: false }, []] : [r, []];
    case 'RELEASE':
      if (r.phase === 'preparing') return [{ ...r, releasePending: true }, []];
      if (r.phase === 'armed') return release(r);
      if (r.phase === 'coined' && r.burnIdem) return [{ ...r, phase: 'committing', burnStep: undefined }, [{ type: 'burn', idem: r.burnIdem }]];
      return [r, []];
    case 'SIGNED':
      if (r.phase !== 'rolling' || !r.prepared) return [r, []];
      return [{ ...r, txSignature: e.txSignature }, [{ type: 'commit', pullId: r.prepared.pullId, txSignature: e.txSignature }]];
    case 'COMMITTED': {
      // Idempotent: a late or second answer must not restart the stop sequence.
      if (r.phase !== 'rolling') return [r, []];
      return [{ ...r, phase: 'stopping', outcomes: e.outcomes, albumCompleted: e.albumCompleted, streakBonus: e.streakBonus === 2 ? 2 : 0, error: undefined, reelStop: 0 }, []];
    }
    case 'REEL_STEP':
      if (r.phase !== 'stopping' || e.stop !== r.reelStop + 1) return [r, []];
      return [{ ...r, reelStop: e.stop }, []];
    case 'ROLL_DONE':
      if (r.phase !== 'stopping') return [r, []];
      return [{ ...r, phase: 'dropping' }, []];
    case 'DROP_DONE': {
      if (r.phase !== 'dropping') return [r, []];
      const phase: Phase = r.outcomes.length > 1 ? 'batchcaps' : 'capsule';
      return [{ ...r, phase }, []];
    }
    case 'COMMIT_FAILED': {
      if (r.phase !== 'rolling' && r.phase !== 'committing') return [r, []];
      // A confirmed payment always resolves to pulls or a refund — never silently. Once a transfer is signed the capsule
      // stays sealed whatever the code (BUILD_PLAN §2 step 4: the server records pending_pull and the client retries).
      // A free pull or a burn whose answer was lost may have landed too, so it stays sealed as well; any answer from the
      // server means it did not. Leaving a sealed capsule (RESET) is always allowed: the session keeps the pull until its
      // cards come back, and RESUME or RESUME_BURN sends it again. Anything else returns to idle: nothing was paid or spent.
      const spent = r.source === 'burn' ? r.burnIdem !== undefined : r.prepared !== undefined && !r.prepared.transfer;
      if (r.txSignature || (spent && answerLost(e.code))) return [{ ...r, phase: 'sealed', error: e.code }, []];
      return [{ ...r, phase: 'idle', error: e.code, prepared: undefined, burnIdem: undefined }, []];
    }
    case 'RETRY_COMMIT':
      if (r.phase !== 'sealed') return [r, []];
      if (r.burnIdem) return [{ ...r, phase: 'committing', error: undefined }, [{ type: 'burn', idem: r.burnIdem }]];
      if (!r.prepared) return [r, []];
      return [{ ...r, phase: 'rolling', error: undefined, reelStop: 0 }, [{ type: 'commit', pullId: r.prepared.pullId, txSignature: r.txSignature }]];
    case 'RESUME':
      // A pull the session kept (a sealed capsule left for later, or a relaunch mid-pull) commits again with its own signature, if it has one.
      if (!canStart(r)) return [r, []];
      return [{ ...r, ...newPull(), phase: 'rolling', prepared: e.prepared, txSignature: e.txSignature, source: 'crank' }, [{ type: 'commit', pullId: e.prepared.pullId, txSignature: e.txSignature }]];
    case 'RESUME_BURN':
      // A burn the session kept goes out again with its own key: the server answers with that burn, never a second one. Like any
      // burn it is one untargeted ×1 free pull.
      if (!canStart(r)) return [r, []];
      return [{ ...r, ...newPull(), ...BURN_PULL, phase: 'committing', txSignature: undefined, burnIdem: e.idem, burnStep: undefined }, [{ type: 'burn', idem: e.idem }]];
    case 'CRACKED':
      return r.phase === 'capsule' ? [{ ...r, phase: 'card', night: r.night || isNight(r.outcomes[0]?.rarity) }, []] : [r, []];
    case 'OPEN_PILE':
      return r.phase === 'batchcaps' ? [{ ...r, phase: 'spread' }, []] : [r, []];
    case 'INTO_BINDER':
      return r.phase === 'card' || r.phase === 'spread'
        ? [{ ...initialRitual, ...keptAcrossPulls(r), ...finishFor(r), night: r.night, takeover: r.albumCompleted ?? r.takeover }, []]
        : [r, []];
    case 'TAKEOVER_DONE':
      return r.takeover ? [{ ...r, takeover: undefined }, []] : [r, []];
    case 'SHOW_TAKEOVER':
      // A complete album's binder claims its holo again: the same takeover, held here, so nothing pulls behind it either.
      return canStart(r) ? [{ ...r, takeover: e.albumId }, []] : [r, []];
    case 'FLIPPED':
      return r.phase === 'spread' ? [{ ...r, night: r.night || isNight(e.rarity) }, []] : [r, []];
    case 'BURN_STARTED':
      // The crank stays locked while the hand-off plays: turning it then must not start a paid pull.
      return canStart(r)
        ? [{ ...r, ...newPull(), ...BURN_PULL, phase: 'burning', burnStep: 'gather' }, [{ type: 'burnSequence' }]]
        : [r, []];
    case 'BURN_STEP':
      return r.phase === 'burning' ? [{ ...r, burnStep: e.step }, []] : [r, []];
    case 'BURN_ARMED':
      // The hand-off is done: spend the five extras now. The key is the one Try again and a kept burn send again.
      return r.phase === 'burning'
        ? [{ ...r, phase: 'committing', burnIdem: e.idem }, [{ type: 'burn', idem: e.idem }]]
        : [r, []];
    case 'BURN_CREDITED':
      if (r.phase !== 'committing' || r.source !== 'burn') return [r, []];
      return [{ ...initialRitual, ...keptAcrossPulls(r), ...keptFinish(r), takeover: r.takeover, night: r.night }, []];
    case 'RESET':
      return [{ ...initialRitual, ...keptAcrossPulls(r), ...keptFinish(r), takeover: r.takeover }, []];
  }
}

/** What the machine keeps when it goes back to idle after a pull (Into binder, Later): the multiplier, the chase, and the prepare
 *  count, so an answer from before never matches a prepare after. */
function keptAcrossPulls(r: Ritual): Pick<Ritual, 'multi' | 'targeted' | 'albumId' | 'prepareSeq'> {
  return { multi: r.multi, ...keptTarget(r), prepareSeq: r.prepareSeq };
}

/** Chasing an album survives the reveal. Completing that album drops the chase: the partner pack takes the row. */
function keptTarget(r: Ritual): Pick<Ritual, 'targeted' | 'albumId'> {
  return r.albumCompleted && r.albumCompleted === r.albumId ? { targeted: false, albumId: undefined } : { targeted: r.targeted, albumId: r.albumId };
}

function keptFinish(r: Ritual): Pick<Ritual, 'completingAlbumId' | 'completingCard'> {
  return { completingAlbumId: r.completingAlbumId, completingCard: r.completingCard };
}

/** The card that filled the album: the last new card of that album in this pull. A lone new card with no album id
 *  is that card (a ×1 whose response did not name the album). */
export function finishingCard(outcomes: Outcome[], albumId: string): CardRef | undefined {
  let match: CardRef | undefined;
  for (const o of outcomes) {
    if (!o.isDupe && o.albumId === albumId) match = o.card;
  }
  if (match) return match;
  const fresh = outcomes.filter((o) => !o.isDupe);
  if (fresh.length === 1 && fresh[0].albumId == null) return fresh[0].card;
  return undefined;
}

function finishFor(r: Ritual): Pick<Ritual, 'completingAlbumId' | 'completingCard'> {
  if (!r.albumCompleted) return keptFinish(r);
  const card = finishingCard(r.outcomes, r.albumCompleted) ?? (r.completingAlbumId === r.albumCompleted ? r.completingCard : undefined);
  return { completingAlbumId: r.albumCompleted, completingCard: card };
}

/** A reveal counts once, on the transition into the card or the spread. A later crack or pile-open while already there does not. */
export function outcomesJustRevealed(e: Event, prev: Ritual, next: Ritual): Outcome[] | null {
  if (e.type === 'CRACKED' && prev.phase === 'capsule' && next.phase === 'card' && next.outcomes[0]) return [next.outcomes[0]];
  if (e.type === 'OPEN_PILE' && prev.phase === 'batchcaps' && next.phase === 'spread' && next.outcomes.length > 0) return next.outcomes;
  return null;
}

/** Entering a chase, or switching the chased album, starts a fresh marquee. Clearing back to a $1 pull does not.
 *  A target change the machine ignores (a pull is under way) does not clear it either. */
export function chaseMarqueeReset(e: Event, prev: Ritual, next: Ritual): boolean {
  return e.type === 'SET_TARGET' && e.albumId != null && e.albumId !== prev.albumId && next.albumId === e.albumId;
}

function release(r: Ritual): [Ritual, Effect[]] {
  const prepared = r.prepared!;
  const next: Ritual = { ...r, phase: 'rolling', releasePending: false, reelStop: 0 };
  // Free pulls cover it → no transfer, commit straight away. Otherwise sign the transfer first.
  if (!prepared.transfer) return [next, [{ type: 'commit', pullId: prepared.pullId }]];
  return [next, [{ type: 'sign', prepared }]];
}
