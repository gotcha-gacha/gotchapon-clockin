// Sharing a pull (F2.11), against the in-app mock: a holo-or-better reveal offers Share, and pressing it captures the
// off-stage share card and hands that PNG to the system sheet. Commons and reverse holos offer nothing to share; a
// capture that fails says so even once Into binder has taken the pill away; a failure never follows the next card; and a
// second tap while the sheet is coming up captures nothing more.
// A share belongs to the reveal it was made on, and every write after an await is that reveal's alone: once another reveal
// has taken the stage, the older share opens no sheet, writes no line over the new card, and un-greys no pill.
// A failure also says *which half* failed: the picture, or the sheet it was handed to.
// Its own file: it forces the tier the mock draws.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as Sharing from 'expo-sharing';
import { captureRef } from 'react-native-view-shot';
import { mock } from '@/api';
import { POOLS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage, shareDeadline } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import type { Tier } from '@/api/contract';
import { heldTimers } from './heldTimers';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}
const app = (
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider initialPage={PAGE.pull}>
        <RitualProvider><Probe /><PullPage /></RitualProvider>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>
);
/** `strict` double-invokes every effect (mount → cleanup → mount) over the same refs, as Fast Refresh does on a hot reload. */
const renderApp = (strict = false) => render(strict ? <React.StrictMode>{app}</React.StrictMode> : app);
/** Awaiting a press whose handler never settles hangs RNTL, so presses that start a held capture go through this. */
const press = (label: string) => act(async () => { void fireEvent.press(screen.getByLabelText(label)); await new Promise((done) => setTimeout(done, 60)); });

// The share failure line erases itself 3.8 s after `sayShare` sets it, and every assertion on it used to race that. The
// clock is held still for this whole file instead — see `heldTimers.ts` for why, and for what the hold still pins.
const NOTE_MS = 3800; // `sayShare` in PullPage.tsx: the design's transient-line life
const notes = heldTimers(NOTE_MS);
const pendingNotes = notes.pending;
const fireNotes = notes.fire;
const holds = notes.holds;

/** Crank a ×1 free pull and crack it open, so the card is on stage. */
async function crackOne() {
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('capsule'));
  expect(screen.queryByLabelText('Share')).toBeNull(); // never over a sealed capsule: it would call the rare before the scratch
  await act(async () => { probe.ritual!.dispatch({ type: 'CRACKED' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('card'));
}

/** A fresh server forced to `tier`, with one pull revealed. `prepare` narrows the mock before the app reads it. */
async function revealOne(tier: Tier, opts: { prepare?: () => void; strict?: boolean } = {}) {
  jest.mocked(captureRef).mockClear();
  jest.mocked(Sharing.shareAsync).mockClear();
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier(tier);
  opts.prepare?.();
  await renderApp(opts.strict);
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await crackOne();
}

test('a holo reveal shares a capture of its card', async () => {
  await revealOne('holo');
  // The pill and the poster it captures are on screen together: the stage's tag, and the poster's own — which a screen
  // reader never sees, since the poster only repeats what the stage already reads out.
  expect(screen.getAllByText('HOLO RARE', { includeHiddenElements: true })).toHaveLength(2);
  expect(screen.getAllByText('HOLO RARE')).toHaveLength(1);
  await fireEvent.press(screen.getByLabelText('Share'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(captureRef).toHaveBeenCalledTimes(1);
  // #221: view-shot resizes to this. The poster's 360×450 pt is 4:5, so 1080×1350 does not stretch it.
  expect(jest.mocked(captureRef).mock.calls[0]![1]).toMatchObject({ format: 'png', width: 1080, height: 1350 });
  expect(jest.mocked(Sharing.shareAsync).mock.calls[0]).toEqual(['file:///tmp/gachapon-share.png', expect.objectContaining({ mimeType: 'image/png', UTI: 'public.png' })]);
  // And the sheet coming back hands the pill over: without this, dropping the success write leaves it greyed for the reveal.
  await waitFor(() => expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: false, busy: false }));
  expect(screen.queryByText(/try again/)).toBeNull();
}, 30_000);

// Holo-and-above only: a reverse holo is a rare on the shelf but not a share card.
test.each<[Tier]>([['common'], ['reverse']])('a %s reveal offers no share', async (tier) => {
  await revealOne(tier);
  expect(screen.queryByLabelText('Share')).toBeNull();
  expect(captureRef).not.toHaveBeenCalled();
}, 30_000);

test('a capture that fails still says so after Into binder has taken the pill away', async () => {
  await revealOne('ultra');
  let fail!: (e: Error) => void;
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>((_, reject) => { fail = reject; }));
  await press('Share');
  await press('Into binder');
  // All the way off the stage, not just the start of the shrink: the machine is idle and the pill is gone.
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'), { timeout: 5000 });
  expect(screen.queryByLabelText('Share')).toBeNull();
  await act(async () => { fail(new Error('the view has gone')); await new Promise((done) => setTimeout(done, 60)); });
  expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
}, 30_000);

test('a failure does not follow the next card', async () => {
  await revealOne('holo');
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await crackOne(); // the next rare arrives well inside the line's 3.8 s
  expect(screen.queryByText(/Couldn't make the picture/)).toBeNull();
  expect(screen.getByLabelText('Share')).toBeTruthy(); // and it can be shared
}, 30_000);

test('a sheet that never comes back leaves the next card shareable', async () => {
  await revealOne('holo');
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>(() => {})); // the sheet never answers
  await press('Share');
  expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: true });
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await crackOne();
  expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: false });
  await fireEvent.press(screen.getByLabelText('Share'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
}, 30_000);

test('the failure line clears itself while the card is still on stage', async () => {
  await revealOne('ultra');
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  // The line's life, read off the timer the page armed rather than slept through: one note, armed for the design's 3.8 s.
  // A page that stops arming one, or arms some other life, fails here — where sleeping past 3.8 s could only ever have
  // shown that *something* took the line down by then.
  expect(pendingNotes().map((note) => note.ms)).toEqual([NOTE_MS]);
  await fireNotes(); // and what that timer does when it comes due is take the line down
  // ...and it stays down across the whole window the old sleep sampled, polled throughout rather than at its ends, so a
  // clear that defers, or one that puts the line back for a moment in the middle, fails on a sample that lands inside it.
  await holds(5000, () => expect(screen.queryByText(/Couldn't make the picture/)).toBeNull());
  expect(probe.ritual!.ritual.phase).toBe('card'); // the card never moved
}, 30_000);

test('a hung sheet does not strand the same card when it comes round again', async () => {
  // One holo left in the pool, so every holo reveal is that same card — the shape that stranded a card-keyed share state.
  await revealOne('holo', { prepare: () => { for (const c of POOLS.holo.slice(1)) mock!.dev.setStock(`pool:holo:${c.id}`, 0); } });
  const first = probe.ritual!.ritual.outcomes[0]!.cardId;
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>(() => {})); // the sheet never answers
  await press('Share');
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await crackOne();
  expect(probe.ritual!.ritual.outcomes[0]!.cardId).toBe(first); // the very same card
  expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: false });
  await fireEvent.press(screen.getByLabelText('Share'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
}, 30_000);

test('a second tap while the sheet is coming up captures nothing more', async () => {
  await revealOne('holo');
  // A capture that takes a moment, so the second tap lands while the first is still out.
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>((resolve) => { setTimeout(() => resolve('file:///tmp/gachapon-share.png'), 250); }));
  const pill = screen.getByLabelText('Share');
  await act(async () => {
    void fireEvent.press(pill);
    void fireEvent.press(pill);
    await new Promise((done) => setTimeout(done, 500));
  });
  expect(captureRef).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
}, 30_000);

/** A share whose capture is still out, so the reveal can move on underneath it. Returns that capture's own resolve/reject. */
async function shareWithHeldCapture(): Promise<{ land: (uri: string) => void; fail: (e: Error) => void }> {
  let land!: (uri: string) => void, fail!: (e: Error) => void;
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>((resolve, reject) => { land = resolve; fail = reject; }));
  await press('Share');
  return { land, fail };
}

/** Put the next rare on stage: the one being shared goes into the binder, and a fresh pull is cracked open. */
async function nextReveal() {
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await crackOne();
}

test('a capture that lands after the next reveal opens no sheet', async () => {
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await nextReveal();
  await act(async () => { first.land('file:///tmp/gachapon-share.png'); await new Promise((done) => setTimeout(done, 60)); });
  expect(Sharing.shareAsync).not.toHaveBeenCalled(); // the guard returned before presenting anything
  // And the card on stage is still the one that can be shared.
  await fireEvent.press(screen.getByLabelText('Share'));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
}, 30_000);

test('a stale rejection does not wipe the line the card on stage is showing', async () => {
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await nextReveal();
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share')); // this card's own capture fails, and says so
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  await act(async () => { first.fail(new Error('the view has gone')); await new Promise((done) => setTimeout(done, 60)); });
  expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy(); // the older reveal's rejection is not this card's news
}, 30_000);

test('a sheet answering after the next reveal does not wipe that reveal line', async () => {
  await revealOne('holo');
  let done!: () => void;
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(() => new Promise<void>((resolve) => { done = resolve; }));
  await press('Share');
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  await nextReveal();
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  await act(async () => { done(); await new Promise((d) => setTimeout(d, 60)); });
  expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy();
}, 30_000);

test('a stale rejection never un-greys a pill whose sheet is still up', async () => {
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await nextReveal();
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(() => new Promise<void>(() => {})); // this card's sheet stays up
  await press('Share');
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  await act(async () => { first.fail(new Error('the view has gone')); await new Promise((d) => setTimeout(d, 60)); });
  expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  await press('Share'); // and the greyed pill is what swallows this, before `sharing.current` is even consulted
  expect(captureRef).toHaveBeenCalledTimes(2);
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
}, 30_000);

test('a retry inside the failed line 3.8 s is not un-greyed by the old timer', async () => {
  await revealOne('ultra');
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>(() => {})); // the retry's capture is still out
  await press('Share');
  // The old note's timer is what would un-grey a pill whose capture is still out. `forgetNote` is expected to have
  // cancelled it at the retry, so by here there should be nothing left armed at all — asserted directly, because a page
  // that skipped `forgetNote` leaves one behind and `fireNotes` below would run it.
  expect(pendingNotes()).toEqual([]);
  await fireNotes();
  // And nothing on any other clock hands the pill back either: the capture is still out, so the pill stays greyed across
  // the whole window the old sleep sampled, polled throughout. Measured from the retry press, as that sleep was.
  await holds(4200, () => {
    expect(screen.queryByText(/Couldn't make the picture/)).toBeNull();
    expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
  });
}, 30_000);

test('a rejection after the page is gone arms no timer', async () => {
  await revealOne('graded');
  const first = await shareWithHeldCapture();
  const armed: (number | undefined)[] = [];
  const real = globalThis.setTimeout;
  globalThis.setTimeout = ((fn: () => void, ms?: number) => { armed.push(ms); return real(fn, ms); }) as typeof globalThis.setTimeout;
  try {
    await screen.unmount(); // RNTL 14's unmount is async (it acts internally): unawaited, the rejection beats the cleanup
    await act(async () => { first.fail(new Error('the view has gone')); await new Promise((d) => real(d, 60)); });
  } finally {
    globalThis.setTimeout = real;
  }
  expect(armed).not.toContain(3800); // a note timer armed now outlives the cleanup that would have cleared it
}, 30_000);

test('the failure line still speaks after the mount effect is re-created', async () => {
  // The page's own "gone" flag is cleared by that effect's cleanup, so it has to come back with the second mount — or one
  // hot reload silences every share failure for the rest of the session.
  await revealOne('ultra', { strict: true });
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
}, 30_000);

test('a capture that lands after the page is gone opens no sheet', async () => {
  // The sheet is presented by the OS, not by this tree, so nothing on the JS side takes it back down. Sign-out needs two
  // taps, but a geo-block answer unmounts the page on a server reply, with no user action at all.
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await screen.unmount();
  await act(async () => { first.land('file:///tmp/gachapon-share.png'); await new Promise((done) => setTimeout(done, 60)); });
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
}, 30_000);

test('a stale finally hands back no in-flight guard while this reveal sheet is up', async () => {
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await nextReveal();
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(() => new Promise<void>(() => {})); // this card's sheet stays up
  const pill = screen.getByLabelText('Share');
  // One act throughout, so the pill's greying is never committed between the taps: `sharing.current` is then the only thing
  // in the way, and it belongs to this reveal's share — an older one must not hand it back.
  await act(async () => {
    void fireEvent.press(pill);
    await new Promise((done) => setTimeout(done, 40));
    first.fail(new Error('the view has gone'));
    await new Promise((done) => setTimeout(done, 20));
    void fireEvent.press(pill);
    await new Promise((done) => setTimeout(done, 60));
  });
  expect(captureRef).toHaveBeenCalledTimes(2);
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(1);
}, 30_000);

// Which half failed (added after #87): the picture is made before the sheet is asked for, so a failure past `captureRef` has
// a made picture behind it and must not blame one. Two lines, two retries — re-tap for the sheet, not "the capture is broken".
test('a sheet that fails says the sharing did not go through, and never blames the picture', async () => {
  await revealOne('holo');
  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('the sheet would not present'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Sharing didn't go through/)).toBeTruthy();
  expect(screen.queryByText(/Couldn't make the picture/)).toBeNull(); // `captureRef` resolved: the PNG exists
  expect(captureRef).toHaveBeenCalledTimes(1);
}, 30_000);

test('a stale sheet rejection never puts its line over the card on stage', async () => {
  // Two shares in flight across a reveal, each at a different half: the older one is at the sheet, the newer one's capture
  // failed. Which half a note names belongs to the share that failed, and the reveal guard still keeps the older one quiet.
  await revealOne('holo');
  let refuse!: (e: Error) => void;
  jest.mocked(Sharing.shareAsync).mockImplementationOnce(() => new Promise<void>((_, reject) => { refuse = reject; }));
  await press('Share');
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  await nextReveal();
  jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
  await fireEvent.press(screen.getByLabelText('Share'));
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy(); // this card's own capture, not the older sheet
  await act(async () => { refuse(new Error('the sheet would not present')); await new Promise((d) => setTimeout(d, 60)); });
  expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy();
  expect(screen.queryByText(/Sharing didn't go through/)).toBeNull();
}, 30_000);

test('one share crossing into the sheet does not relabel another whose picture is still out', async () => {
  // Two captures out at once, across a reveal — the slow capture the user left behind at Into binder, and the new card's.
  // The older one lands, reaching the sheet half, while the newer one's is still out; when that one then fails it is the
  // *picture* that failed, and only its own share's half may name it.
  await revealOne('holo');
  const first = await shareWithHeldCapture();
  await nextReveal();
  const second = await shareWithHeldCapture();
  await act(async () => { first.land('file:///tmp/gachapon-share.png'); await new Promise((d) => setTimeout(d, 60)); });
  expect(Sharing.shareAsync).not.toHaveBeenCalled(); // the older share crossed the half, then stopped at the reveal guard
  await act(async () => { second.fail(new Error('the view has gone')); await new Promise((d) => setTimeout(d, 60)); });
  expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
  expect(screen.queryByText(/Sharing didn't go through/)).toBeNull();
}, 30_000);

test('a capture nobody answers times out and hands the pill back', async () => {
  shareDeadline.ms = 250;
  try {
    await revealOne('holo');
    jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>(() => {}));
    await press('Share');
    expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await act(async () => { await new Promise((done) => setTimeout(done, 280)); });
    expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy();
    expect(screen.queryByText(/Sharing didn't go through/)).toBeNull();
    expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: false, busy: false });
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Share'));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  } finally {
    shareDeadline.ms = 30_000;
  }
}, 30_000);

test('a sheet nobody answers times out as the sheet, not the picture, and hands the pill back', async () => {
  shareDeadline.ms = 250;
  try {
    await revealOne('holo');
    jest.mocked(Sharing.shareAsync).mockImplementationOnce(() => new Promise<void>(() => {}));
    await press('Share');
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    await act(async () => { await new Promise((done) => setTimeout(done, 280)); });
    expect(screen.getByText(/Sharing didn't go through/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't make the picture/)).toBeNull();
    expect(screen.getByLabelText('Share').props.accessibilityState).toMatchObject({ disabled: false, busy: false });
  } finally {
    shareDeadline.ms = 30_000;
  }
}, 30_000);

test('a share timeout on a stale reveal does not wipe the line the card on stage is showing', async () => {
  shareDeadline.ms = 80;
  try {
    await revealOne('holo');
    jest.mocked(captureRef).mockImplementationOnce(() => new Promise<string>(() => {}));
    await press('Share');
    await nextReveal();
    jest.mocked(captureRef).mockRejectedValueOnce(new Error('nope'));
    await fireEvent.press(screen.getByLabelText('Share'));
    expect(await screen.findByText(/Couldn't make the picture/)).toBeTruthy();
    await act(async () => { await new Promise((done) => setTimeout(done, 120)); });
    expect(screen.getByText(/Couldn't make the picture/)).toBeTruthy();
    expect(screen.queryByText(/Sharing didn't go through/)).toBeNull();
  } finally {
    shareDeadline.ms = 30_000;
  }
}, 30_000);
