import { describe, expect, test } from '@jest/globals';
import { chaseMarqueeReset, finishingCard, initialRitual, outcomesJustRevealed, reduce, type Event, type Ritual } from './reducer';
import type { Outcome, PullPrepareResponse } from '@/api/contract';

const prep = (transfer: boolean, pullId = 'p1'): PullPrepareResponse => ({ pullId, costUsd: transfer ? 1 : 0, useFreePulls: transfer ? 0 : 1, transfer: transfer ? { to: 'T', mint: 'USDC', amount: 1_000_000, memo: pullId } : undefined, expiresAt: '2026-09-10T00:01:00Z' });
const common: Outcome = { cardId: 'sv3-76', rarity: 'common', isDupe: false, albumId: 'A', card: { id: 'sv3-76', name: 'Tadbulb', set: 'SV3', number: '76', imgSmall: '', imgLarge: '' } };

function run(events: Event[], start: Ritual = initialRitual) {
  let r = start; const effects = [] as ReturnType<typeof reduce>[1];
  for (const e of events) { const [n, fx] = reduce(r, e); r = n; effects.push(...fx); }
  return { r, effects };
}

/** Server result → reels lock → the capsule or pile is interactive. */
const handoff: Event[] = [{ type: 'ROLL_DONE' }, { type: 'DROP_DONE' }];

describe('charge point', () => {
  test('the crank starting prepares; a full turn commits — a free pull needs no signature', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }]);
    expect(r.phase).toBe('rolling');
    expect(effects).toEqual([{ type: 'prepare', seq: 1, multi: 1, targeted: false, albumId: undefined }, { type: 'commit', pullId: 'p1', txSignature: undefined }]);
  });

  test('a paid pull signs the transfer at release, then commits with the signature', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }]);
    expect(r.phase).toBe('rolling');
    expect(effects.map((f) => f.type)).toEqual(['prepare', 'sign', 'commit']);
    expect(effects[2]).toEqual({ type: 'commit', pullId: 'p1', txSignature: 'mock:p1' });
  });

  test('nothing is committed before the turn completes: prepare alone charges nothing', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }]);
    expect(r.phase).toBe('armed');
    expect(effects.map((f) => f.type)).toEqual(['prepare']);
  });

  test('release before prepare answers is remembered and fires the moment it does', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'RELEASE' }, { type: 'PREPARED', seq: 1, res: prep(false) }]);
    expect(r.phase).toBe('rolling');
    expect(effects.map((f) => f.type)).toEqual(['prepare', 'commit']);
  });

  test('hand off before 360° abandons the prepared pull with no commit', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'CRANK_ABANDONED' }]);
    expect(r.phase).toBe('idle');
    expect(r.prepared).toBeUndefined();
    expect(effects.map((f) => f.type)).toEqual(['prepare']);
  });

  test('prepare failing (no balance) returns to idle with the error', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARE_FAILED', seq: 1, code: 'INSUFFICIENT_FUNDS' }]);
    expect(r).toMatchObject({ phase: 'idle', error: 'INSUFFICIENT_FUNDS' });
  });
});

describe('reveal', () => {
  test('a day-5 bonus stays on the revealed card and clears when the card is put away', () => {
    const shown = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: [common], streakBonus: 2 }, ...handoff, { type: 'CRACKED' }]).r;
    expect(shown).toMatchObject({ phase: 'card', streakBonus: 2 });
    expect(run([{ type: 'INTO_BINDER' }], shown).r.streakBonus).toBe(0);
  });

  test('one outcome → capsule → card → into binder → idle', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: [common] }, ...handoff, { type: 'CRACKED' }, { type: 'INTO_BINDER' }]);
    expect(r.phase).toBe('idle');
    expect(r.outcomes).toEqual([]);
  });

  test('×5 → batch pile → spread → idle, keeping the multi', () => {
    const five = Array.from({ length: 5 }, () => common);
    const { r } = run([{ type: 'SET_MULTI', multi: 5 }, { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMITTED', outcomes: five }]);
    expect(r.phase).toBe('stopping');
    const landed = run(handoff, r);
    expect(landed.r.phase).toBe('batchcaps');
    const { r: r2 } = run([{ type: 'OPEN_PILE' }, { type: 'INTO_BINDER' }], landed.r);
    expect(r2.phase).toBe('idle');
    expect(r2.multi).toBe(5);
  });

  test('multi and target cannot change mid-ritual', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'SET_MULTI', multi: 10 }, { type: 'SET_TARGET', albumId: 'A' }]);
    expect(r).toMatchObject({ phase: 'preparing', multi: 1, targeted: false });
  });

  test('entering a chase starts at ×1, and the size can change while chasing', () => {
    const { r } = run([{ type: 'SET_MULTI', multi: 10 }, { type: 'SET_TARGET', albumId: 'A' }]);
    expect(r).toMatchObject({ multi: 1, targeted: true, albumId: 'A' });
    const sized = run([{ type: 'SET_MULTI', multi: 5 }], r);
    expect(sized.r).toMatchObject({ multi: 5, targeted: true, albumId: 'A' });
    const started = run([{ type: 'CRANK_START' }], sized.r);
    expect(started.effects[0]).toMatchObject({ type: 'prepare', multi: 5, targeted: true, albumId: 'A' });
  });

  test('a chase ×5 lands in the pile, not a single capsule', () => {
    const five = Array.from({ length: 5 }, () => common);
    const { r } = run([{ type: 'SET_TARGET', albumId: 'A' }, { type: 'SET_MULTI', multi: 5 }, { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMITTED', outcomes: five }]);
    expect(r.phase).toBe('stopping');
    expect(r.multi).toBe(5);
    const dropping = run([{ type: 'ROLL_DONE' }], r);
    expect(dropping.r.phase).toBe('dropping');
    expect(dropping.r.outcomes).toHaveLength(5);
    const landed = run([{ type: 'DROP_DONE' }], dropping.r);
    expect(landed.r.phase).toBe('batchcaps');
  });

  test('the target survives a reveal, and is dropped once that album is complete', () => {
    const toSigned = [{ type: 'SET_TARGET', albumId: 'A' }, { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }] as const;
    const { r: kept } = run([...toSigned, { type: 'COMMITTED', outcomes: [common] }, ...handoff, { type: 'CRACKED' }, { type: 'INTO_BINDER' }]);
    expect(kept).toMatchObject({ phase: 'idle', targeted: true, albumId: 'A' });
    const { r: done } = run([...toSigned, { type: 'COMMITTED', outcomes: [common], albumCompleted: 'A' }, ...handoff, { type: 'CRACKED' }, { type: 'INTO_BINDER' }]);
    expect(done).toMatchObject({ phase: 'idle', targeted: false });
    expect(done.albumId).toBeUndefined();
  });
});

describe('night sky', () => {
  test('an ultra reveal turns the night on; it survives Into binder and clears when the next pull starts', () => {
    const ultra: Outcome = { ...common, rarity: 'ultra' };
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: [ultra] }, ...handoff, { type: 'CRACKED' }]);
    expect(r.night).toBe(true);
    const { r: r2 } = run([{ type: 'INTO_BINDER' }], r);
    expect(r2).toMatchObject({ phase: 'idle', night: true });
    const { r: r3 } = run([{ type: 'CRANK_START' }], r2);
    expect(r3.night).toBe(false);
  });
  test('a common reveal leaves the room lit; flipping a graded card in a spread turns it on', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: [common] }, ...handoff, { type: 'CRACKED' }]);
    expect(r.night).toBe(false);
    const five = Array.from({ length: 5 }, () => common);
    const { r: sp } = run([{ type: 'SET_MULTI', multi: 5 }, { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: five }, ...handoff, { type: 'OPEN_PILE' }, { type: 'FLIPPED', rarity: 'graded' }]);
    expect(sp).toMatchObject({ phase: 'spread', night: true });
  });
});

describe('payment safety', () => {
  test('commit failing after a signed transfer keeps the capsule sealed and retries with the same signature', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMIT_FAILED', code: 'TX_NOT_FOUND' }, { type: 'RETRY_COMMIT' }]);
    expect(r.phase).toBe('rolling');
    expect(effects.filter((f) => f.type === 'commit')).toEqual([
      { type: 'commit', pullId: 'p1', txSignature: 'mock:p1' },
      { type: 'commit', pullId: 'p1', txSignature: 'mock:p1' },
    ]);
  });

  test('any failure after a signed transfer keeps the capsule sealed — even EXPIRED — and retry resends the same signature', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMIT_FAILED', code: 'EXPIRED' }]);
    expect(r).toMatchObject({ phase: 'sealed', error: 'EXPIRED', txSignature: 'mock:p1' });
    expect(r.prepared).toBeDefined();
    const { effects } = run([{ type: 'RETRY_COMMIT' }], r);
    expect(effects).toEqual([{ type: 'commit', pullId: 'p1', txSignature: 'mock:p1' }]);
  });

  // The review of PR #66 reverses F2.10's "Start over refused" rule: a capsule whose retry can never succeed (a pull that
  // expired) locked the machine for good, and the handle lived only in memory. The session now keeps every signed pull on
  // disk until a commit returns its cards (state/pendingPulls), so a sealed capsule can always be left and RESUME opens it.
  test('a sealed paid pull can always be left, whatever the code, and RESUME commits the same pull and signature again', () => {
    for (const code of ['TX_NOT_FOUND', 'NETWORK', 'UNKNOWN', 'EXPIRED', 'TX_MISMATCH'] as const) {
      const sealed = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMIT_FAILED', code }]).r;
      expect(sealed).toMatchObject({ phase: 'sealed', error: code, txSignature: 'mock:p1' });
      const left = run([{ type: 'RESET' }], sealed).r;
      expect(left).toMatchObject({ phase: 'idle', outcomes: [] });
      expect(left.txSignature).toBeUndefined();
      expect(left.error).toBeUndefined();
    }
    const resumed = run([{ type: 'RESUME', prepared: prep(true), txSignature: 'mock:p1' }]);
    expect(resumed.r).toMatchObject({ phase: 'rolling', txSignature: 'mock:p1', source: 'crank' });
    expect(resumed.effects).toEqual([{ type: 'commit', pullId: 'p1', txSignature: 'mock:p1' }]);
    expect(run([{ type: 'COMMIT_FAILED', code: 'NETWORK' }], resumed.r).r).toMatchObject({ phase: 'sealed', error: 'NETWORK' }); // and it can be left again
  });

  test('a failure before anything was paid returns to idle and clears the prepared pull', () => {
    const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'COMMIT_FAILED', code: 'TX_MISMATCH' }]);
    expect(r).toMatchObject({ phase: 'idle', error: 'TX_MISMATCH' });
    expect(r.prepared).toBeUndefined();
    expect(r.txSignature).toBeUndefined();
  });

  test('RESUME only starts from an idle machine', () => {
    const busy = run([{ type: 'CRANK_START' }]).r;
    const refused = run([{ type: 'RESUME', prepared: prep(true), txSignature: 'mock:p1' }], busy);
    expect(refused.r).toBe(busy);
    expect(refused.effects).toEqual([]);
  });

  test('a free pull whose answer was lost stays sealed and goes out again as the same pull; one the server refused returns to idle', () => {
    const lost = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMIT_FAILED', code: 'NETWORK' }]).r;
    expect(lost).toMatchObject({ phase: 'sealed', error: 'NETWORK' });
    expect(run([{ type: 'RETRY_COMMIT' }], lost).effects).toEqual([{ type: 'commit', pullId: 'p1', txSignature: undefined }]);
    const resumed = run([{ type: 'RESUME', prepared: prep(false) }]);
    expect(resumed.effects).toEqual([{ type: 'commit', pullId: 'p1', txSignature: undefined }]);
    expect(run([{ type: 'COMMIT_FAILED', code: 'NETWORK' }], resumed.r).r.phase).toBe('sealed');
    for (const code of ['EXPIRED', 'RESTOCKING', 'UNKNOWN'] as const) {
      const { r } = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMIT_FAILED', code }]);
      expect(r).toMatchObject({ phase: 'idle', error: code });
      expect(r.prepared).toBeUndefined();
    }
    // A paid pull that failed before its transfer was signed spent nothing, even with its answer lost.
    expect(run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'COMMIT_FAILED', code: 'NETWORK' }]).r.phase).toBe('idle');
  });

  test('a burn whose answer was lost stays sealed and goes out again with its own key, by Try again or as a kept burn; a refused one returns to idle', () => {
    const lost = run([{ type: 'BURN_STARTED' }, { type: 'BURN_ARMED', idem: 'b1' }, { type: 'COMMIT_FAILED', code: 'NETWORK' }]).r;
    expect(lost).toMatchObject({ phase: 'sealed', burnIdem: 'b1', source: 'burn' });
    expect(run([{ type: 'RETRY_COMMIT' }], lost).effects).toEqual([{ type: 'burn', idem: 'b1' }]);
    expect(run([{ type: 'RESET' }], lost).r.burnIdem).toBeUndefined();
    const resumed = run([{ type: 'SET_MULTI', multi: 5 }, { type: 'RESUME_BURN', idem: 'b1' }]);
    expect(resumed.r).toMatchObject({ phase: 'committing', source: 'burn', burnIdem: 'b1', multi: 1 });
    expect(resumed.effects).toEqual([{ type: 'burn', idem: 'b1' }]);
    expect(run([{ type: 'RESUME_BURN', idem: 'b1' }], run([{ type: 'CRANK_START' }]).r).effects).toEqual([]); // only from an idle machine
    const refused = run([{ type: 'COMMIT_FAILED', code: 'UNKNOWN' }], resumed.r).r;
    expect(refused).toMatchObject({ phase: 'idle', error: 'UNKNOWN' });
    expect(refused.burnIdem).toBeUndefined();
  });

  test('the pull that fills an album leaves its takeover pending once filed; no pull, burn or resume starts behind it until done', () => {
    const card: Outcome = { cardId: 'c25', rarity: 'common', isDupe: false, albumId: 'A', card: { id: 'c25', name: 'Last', set: 'SV', number: '25', imgSmall: '', imgLarge: '' } };
    const filled = (tail: Parameters<typeof run>[0] = []) => run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }, { type: 'COMMITTED', outcomes: [card], albumCompleted: 'A' }, ...handoff, { type: 'CRACKED' }, ...tail]).r;
    expect(filled().takeover).toBeUndefined(); // never over the reveal
    const up = filled([{ type: 'INTO_BINDER' }]);
    expect(up).toMatchObject({ phase: 'idle', takeover: 'A', completingAlbumId: 'A', completingCard: card.card });
    expect(run([{ type: 'TAKEOVER_DONE' }], up).r.completingCard).toEqual(card.card);
    expect(run([{ type: 'RESET' }], up).r.completingCard).toEqual(card.card);
    // A shake reaches the crank through the takeover's modal: nothing may start a pull behind it.
    for (const e of [{ type: 'CRANK_START' }, { type: 'BURN_STARTED' }, { type: 'RESUME', prepared: prep(true), txSignature: 'mock:p1' }] as Event[]) {
      const behind = run([e], up);
      expect(behind.r).toBe(up);
      expect(behind.effects).toEqual([]);
    }
    const done = run([{ type: 'TAKEOVER_DONE' }], up).r;
    expect(done.takeover).toBeUndefined();
    expect(run([{ type: 'CRANK_START' }], done).r.phase).toBe('preparing');
  });

  test('the COMPLETE hero is the last new card of the album that filled, not an earlier card or the cover', () => {
    const cardOf = (id: string, name: string, albumId: string, isDupe = false): Outcome => ({
      cardId: id, rarity: 'common', isDupe, albumId, card: { id, name, set: 'SV', number: '1', imgSmall: '', imgLarge: '' },
    });
    const tink = cardOf('sv4-83', 'Tinkatink', 'A');
    const outcomes = [cardOf('sv3-76', 'Tadbulb', 'A', true), cardOf('b1', 'Other', 'B'), tink];
    expect(finishingCard(outcomes, 'A')?.name).toBe('Tinkatink');
    const filed = run([
      { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' },
      { type: 'COMMITTED', outcomes, albumCompleted: 'A' }, ...handoff, { type: 'OPEN_PILE' }, { type: 'INTO_BINDER' },
    ]).r;
    expect(filed.completingCard?.name).toBe('Tinkatink');
    expect(filed.completingCard?.name).not.toBe('Tadbulb');
  });

  test('a complete album\'s binder reopens the takeover, only on an idle machine and never over another one', () => {
    const up = run([{ type: 'SHOW_TAKEOVER', albumId: 'A' }]).r;
    expect(up.takeover).toBe('A');
    expect(run([{ type: 'SHOW_TAKEOVER', albumId: 'B' }], up).r.takeover).toBe('A');
    expect(run([{ type: 'CRANK_START' }, { type: 'SHOW_TAKEOVER', albumId: 'A' }]).r.takeover).toBeUndefined();
  });

  test('a quote above the price the machine showed signs nothing, even after the hand let go, and says what it costs', () => {
    const held = run([{ type: 'CRANK_START' }, { type: 'REPRICED', seq: 1, costUsd: 1 }]);
    expect(held.r).toMatchObject({ phase: 'idle', repriced: 1, releasePending: false });
    expect(held.effects.map((f) => f.type)).toEqual(['prepare']);
    const letGo = run([{ type: 'CRANK_START' }, { type: 'RELEASE' }, { type: 'REPRICED', seq: 1, costUsd: 2 }]);
    expect(letGo.r).toMatchObject({ phase: 'idle', repriced: 2, releasePending: false });
    expect(letGo.effects.map((f) => f.type)).toEqual(['prepare']);
    expect(run([{ type: 'CRANK_START' }], letGo.r).r.repriced).toBeUndefined();
    expect(run([{ type: 'REPRICED', seq: 0, costUsd: 1 }]).r.repriced).toBeUndefined(); // only a pull being prepared
  });

  test('arming a burn sends it; the credit returns to idle with no card, and a crank release does not send it again', () => {
    const armed = run([{ type: 'BURN_STARTED' }, { type: 'BURN_STEP', step: 'flash' }, { type: 'BURN_ARMED', idem: 'b1' }]);
    expect(armed.r).toMatchObject({ phase: 'committing', burnIdem: 'b1', burnStep: 'flash', source: 'burn' });
    expect(armed.effects).toContainEqual({ type: 'burn', idem: 'b1' });
    expect(run([{ type: 'RELEASE' }], armed.r).effects).toEqual([]);
    const credited = run([{ type: 'BURN_CREDITED' }], armed.r);
    expect(credited.r).toMatchObject({ phase: 'idle', source: 'crank', outcomes: [] });
    expect(credited.r.burnIdem).toBeUndefined();
    expect(run([{ type: 'BURN_CREDITED' }]).r.phase).toBe('idle'); // a credit needs a burn in flight
  });

  test('a burn starts the hand-off as one untargeted ×1 pull whatever was selected, only from idle', () => {
    const started = run([{ type: 'SET_MULTI', multi: 5 }, { type: 'BURN_STARTED' }]);
    expect(started.r).toMatchObject({ phase: 'burning', burnStep: 'gather', multi: 1, source: 'burn' });
    expect(started.effects).toContainEqual({ type: 'burnSequence' });
    const fromTarget = run([{ type: 'SET_TARGET', albumId: 'A' }, { type: 'BURN_STARTED' }]).r;
    expect(fromTarget).toMatchObject({ phase: 'burning', targeted: false });
    expect(fromTarget.albumId).toBeUndefined();
    expect(run([{ type: 'CRANK_START' }, { type: 'BURN_STARTED' }]).r.phase).toBe('preparing');
  });

  test('while the hand-off plays the crank cannot start a paid pull; the steps advance, then it arms', () => {
    const { r, effects } = run([{ type: 'BURN_STARTED' }, { type: 'CRANK_START' }, { type: 'RELEASE' }, { type: 'SET_MULTI', multi: 10 }, { type: 'BURN_STEP', step: 'stream' }]);
    expect(r).toMatchObject({ phase: 'burning', burnStep: 'stream', multi: 1 });
    expect(effects.some((f) => f.type === 'prepare' || f.type === 'commit' || f.type === 'sign')).toBe(false);
    const armed = run([{ type: 'BURN_STARTED' }, { type: 'BURN_STEP', step: 'flash' }, { type: 'BURN_ARMED', idem: 'b1' }]);
    expect(armed.r).toMatchObject({ phase: 'committing', burnStep: 'flash', burnIdem: 'b1' });
    expect(armed.effects).toContainEqual({ type: 'burn', idem: 'b1' });
    expect(run([{ type: 'BURN_ARMED', idem: 'b1' }]).r.phase).toBe('idle'); // arming needs a hand-off in progress
    expect(run([{ type: 'BURN_STEP', step: 'slide' }]).r.burnStep).toBeUndefined();
  });
});

describe('letting go after a full turn', () => {
  test('a turn that reached 360° while the prepare was out is not undone by a later let-go; the answer still commits', () => {
    const { r, effects } = run([{ type: 'CRANK_START' }, { type: 'RELEASE' }, { type: 'CRANK_ABANDONED' }, { type: 'PREPARED', seq: 1, res: prep(false) }]);
    expect(r.phase).toBe('rolling');
    expect(effects.map((f) => f.type)).toEqual(['prepare', 'commit']);
    expect(run([{ type: 'CRANK_START' }, { type: 'CRANK_ABANDONED' }]).r.phase).toBe('idle'); // short of a turn, letting go still abandons
  });
});

describe('answers from an earlier grab', () => {
  // Grab, let go and grab again: two prepares are out, and their answers can come back in either order. Only the latest prepare's
  // answer counts (review of PR #71, round 2): the server supersedes the older pull as it prepares the newer one, so arming the
  // older pull failed the turn EXPIRED, and a paid turn signed a transfer for it.
  const regrabbed = run([{ type: 'CRANK_START' }, { type: 'CRANK_ABANDONED' }, { type: 'CRANK_START' }]);
  const [older, newer] = [1, 2]; // the numbers the two grabs' prepares go out with
  /** Each kind of answer a prepare can get, for the pull `pullId`. */
  const answers = (seq: number, pullId: string): Event[] => [{ type: 'PREPARED', seq, res: prep(true, pullId) }, { type: 'PREPARE_FAILED', seq, code: 'NETWORK' }, { type: 'REPRICED', seq, costUsd: 2 }];
  /** `e` changes nothing: the same state back, and no effect. */
  function ignored(r: Ritual, e: Event) {
    const out = run([e], r);
    expect(out.r).toBe(r);
    expect(out.effects).toEqual([]);
  }

  test('in order: the older answer, arriving while the newer prepare is out, changes nothing, with the hand still on the crank or the turn made; the newer answer counts', () => {
    const [prepared, failed, repriced] = answers(newer, 'newer');
    for (const turn of [[], [{ type: 'RELEASE' }]] as Event[][]) {
      const waiting = run(turn, regrabbed.r).r;
      expect(waiting.phase).toBe('preparing');
      for (const e of answers(older, 'older')) ignored(waiting, e);
      const live = run([prepared], waiting);
      expect(live.r).toMatchObject({ phase: turn.length ? 'rolling' : 'armed', prepared: { pullId: 'newer' } });
      expect(live.effects).toEqual(turn.length ? [{ type: 'sign', prepared: prep(true, 'newer') }] : []); // a paid turn signs the newer pull
      expect(run([failed], waiting).r).toMatchObject({ phase: 'idle', error: 'NETWORK' });
      expect(run([repriced], waiting).r).toMatchObject({ phase: 'idle', repriced: 2 });
    }
  });

  test('out of order: the older answer, arriving after the newer one, changes nothing, nor once the crank is grabbed a third time', () => {
    for (const first of answers(newer, 'newer')) {
      const answered = run([first], regrabbed.r).r; // armed, or idle after a failure or a higher quote
      const third = run([{ type: 'CRANK_ABANDONED' }, { type: 'CRANK_START' }], answered).r;
      expect(third.phase).toBe('preparing');
      for (const e of answers(older, 'older')) {
        ignored(answered, e);
        ignored(third, e);
      }
    }
  });

  test('an older answer that outlives a whole pull changes nothing: the numbers carry on past Into binder, Later, Open it and a burn', () => {
    const released: Event[] = [{ type: 'PREPARED', seq: newer, res: prep(false, 'newer') }, { type: 'RELEASE' }];
    const filed = run([...released, { type: 'COMMITTED', outcomes: [common] }, ...handoff, { type: 'CRACKED' }, { type: 'INTO_BINDER' }, { type: 'CRANK_START' }], regrabbed.r).r;
    const idle = run([...released, { type: 'COMMIT_FAILED', code: 'NETWORK' }, { type: 'RESET' }], regrabbed.r).r; // sealed, then Later
    const left = run([{ type: 'CRANK_START' }], idle).r;
    // Opening a kept pull and burning start pulls of their own, and neither restarts the count.
    const opened = run([{ type: 'RESUME', prepared: prep(true, 'kept'), txSignature: 'mock:kept' }, { type: 'COMMIT_FAILED', code: 'NETWORK' }, { type: 'RESET' }, { type: 'CRANK_START' }], idle).r;
    const burned = run([{ type: 'BURN_STARTED' }, { type: 'BURN_ARMED', idem: 'b1' }, { type: 'COMMIT_FAILED', code: 'NETWORK' }, { type: 'RESET' }, { type: 'CRANK_START' }], idle).r;
    for (const grabbed of [filed, left, opened, burned]) {
      expect(grabbed.phase).toBe('preparing');
      for (const e of answers(older, 'older')) ignored(grabbed, e);
    }
  });

  test('the latest prepare\'s answer, arriving after the hand let go short of a turn, changes nothing either', () => {
    const letGo = run([{ type: 'CRANK_START' }, { type: 'CRANK_ABANDONED' }]).r;
    expect(letGo.phase).toBe('idle');
    for (const e of answers(1, 'p1')) ignored(letGo, e);
  });
});

describe('the pull wait', () => {
  test('a result locks the reels then drops a capsule or a pile, and a second result is ignored', () => {
    const rolling = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(false) }, { type: 'RELEASE' }]).r;
    expect(run([{ type: 'RELEASE' }, { type: 'CRANK_START' }], rolling).r).toBe(rolling);
    const stopping = run([{ type: 'COMMITTED', outcomes: [common] }], rolling).r;
    expect(stopping).toMatchObject({ phase: 'stopping', reelStop: 0 });
    expect(run([{ type: 'COMMITTED', outcomes: [common] }], stopping).r).toBe(stopping);
    const one = run([{ type: 'REEL_STEP', stop: 1 }], stopping).r;
    expect(one.reelStop).toBe(1);
    expect(run([{ type: 'REEL_STEP', stop: 1 }], one).r).toBe(one);
    expect(run([{ type: 'REEL_STEP', stop: 3 }], one).r).toBe(one);
    const dropping = run([{ type: 'ROLL_DONE' }], one).r;
    expect(dropping.phase).toBe('dropping');
    expect(run([{ type: 'ROLL_DONE' }], dropping).r).toBe(dropping);
    expect(run([{ type: 'DROP_DONE' }], dropping).r.phase).toBe('capsule');
    const batch = run([{ type: 'COMMITTED', outcomes: [common, common] }, { type: 'ROLL_DONE' }, { type: 'DROP_DONE' }], rolling).r;
    expect(batch.phase).toBe('batchcaps');
  });

  test('a burn still commits without rolling', () => {
    const armed = run([{ type: 'BURN_STARTED' }, { type: 'BURN_ARMED', idem: 'b1' }]).r;
    expect(armed.phase).toBe('committing');
    expect(run([{ type: 'COMMITTED', outcomes: [common] }], armed).r).toBe(armed);
  });
});

describe('a reveal files once, and a chase clears the marquee', () => {
  test('cracking files the card once, and a second crack does not', () => {
    const capsule = run([{ type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMITTED', outcomes: [common] }, ...handoff]).r;
    expect(capsule.phase).toBe('capsule');
    const [card] = reduce(capsule, { type: 'CRACKED' });
    expect(outcomesJustRevealed({ type: 'CRACKED' }, capsule, card)).toEqual([common]);
    const [again] = reduce(card, { type: 'CRACKED' });
    expect(outcomesJustRevealed({ type: 'CRACKED' }, card, again)).toBeNull();
  });

  test('opening a pile files it once', () => {
    const five = Array.from({ length: 5 }, () => common);
    const pile = run([{ type: 'SET_MULTI', multi: 5 }, { type: 'CRANK_START' }, { type: 'PREPARED', seq: 1, res: prep(true) }, { type: 'RELEASE' }, { type: 'SIGNED', txSignature: 'mock:p1' }, { type: 'COMMITTED', outcomes: five }, ...handoff]).r;
    expect(pile.phase).toBe('batchcaps');
    const [spread] = reduce(pile, { type: 'OPEN_PILE' });
    expect(outcomesJustRevealed({ type: 'OPEN_PILE' }, pile, spread)).toEqual(five);
    expect(outcomesJustRevealed({ type: 'OPEN_PILE' }, spread, spread)).toBeNull();
  });

  test('entering or switching a chase resets the marquee; clearing the chase, or a switch mid-pull, does not', () => {
    const entered = run([{ type: 'SET_TARGET', albumId: 'A' }]).r;
    expect(chaseMarqueeReset({ type: 'SET_TARGET', albumId: 'A' }, initialRitual, entered)).toBe(true);
    const same = run([{ type: 'SET_TARGET', albumId: 'A' }], entered).r;
    expect(chaseMarqueeReset({ type: 'SET_TARGET', albumId: 'A' }, entered, same)).toBe(false);
    const switched = run([{ type: 'SET_TARGET', albumId: 'B' }], entered).r;
    expect(chaseMarqueeReset({ type: 'SET_TARGET', albumId: 'B' }, entered, switched)).toBe(true);
    const cleared = run([{ type: 'SET_TARGET', albumId: null }], entered).r;
    expect(chaseMarqueeReset({ type: 'SET_TARGET', albumId: null }, entered, cleared)).toBe(false);
    const pulling = run([{ type: 'CRANK_START' }], entered).r;
    expect(chaseMarqueeReset({ type: 'SET_TARGET', albumId: 'B' }, pulling, pulling)).toBe(false);
  });
});

describe('a size change and the last refusal (PR #312)', () => {
  // Only a stock refusal is about the size it refused; any other error is left for its own hint.
  test.each(['INSUFFICIENT_FUNDS', 'NETWORK', 'UNKNOWN'] as const)('keeps a %s refusal', (error) => {
    expect(run([{ type: 'SET_MULTI', multi: 5 }], { ...initialRitual, multi: 10, error }).r).toMatchObject({ multi: 5, error });
  });
  test('clears a RESTOCKING refusal', () => {
    expect(run([{ type: 'SET_MULTI', multi: 5 }], { ...initialRitual, multi: 10, error: 'RESTOCKING' }).r.error).toBeUndefined();
  });
});
