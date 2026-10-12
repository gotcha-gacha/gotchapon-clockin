// Pull page overlays and the session tray against the in-app mock (F2.9). Its own file: it changes mock stock.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect, useRef } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { mock } from '@/api';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { PAGE, SessionProvider, useSession } from '@/state/session';
import { heldTimers } from './heldTimers';

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The deposit toast takes itself away 3.8 s after it lands (`PullPage.tsx`, the effect on `credit`), so every assertion on
// it is racing that, and the one below that waits for it to *go* could not tell 3.8 s from any other life under its 6 s
// budget. The clock is held still for this file instead — `heldTimers.ts` says why, and what the hold still pins.
const TOAST_MS = 3800; // the design's transient-overlay life, shared with the share failure line
const toasts = heldTimers(TOAST_MS);

function renderPull(probe?: React.ReactElement) {
  return render(
    <SafeAreaProvider>
      <AuthProvider>
        <SessionProvider initialPage={PAGE.pull}>
          <RitualProvider>{probe}<PullPage /></RitualProvider>
        </SessionProvider>
      </AuthProvider>
    </SafeAreaProvider>,
  );
}

function DepositOnce() {
  const { ready, devDeposit } = useSession();
  const done = useRef(false);
  useEffect(() => { if (!ready || done.current) return; done.current = true; void devDeposit?.(10); }, [ready, devDeposit]);
  return null;
}

const ritualRef: { current: ReturnType<typeof useRitual> | null } = { current: null };
function RitualProbe() {
  const r = useRitual();
  useEffect(() => { ritualRef.current = r; });
  return null;
}

const sessionRef: { current: ReturnType<typeof useSession> | null } = { current: null };
function SessionProbe() {
  const s = useSession();
  useEffect(() => { sessionRef.current = s; });
  return null;
}

test('a deposit landing toasts on the Pull page, and the toast hides itself on the design 3.8 s timer', async () => {
  await renderPull(<DepositOnce />);
  const toast = "Added $10.00 — that's 10 pulls. The machine's lit.";
  expect(await screen.findByText(toast)).toBeTruthy();
  // The life, read off the timer the page armed rather than slept through. Waiting 6 s for the toast to vanish could only
  // ever show that *something* took it away by then: it passed just as happily with the life at 5 s, at 3801 ms, with the
  // clear deferred half a second, and with the toast flickering back mid-window. This names the life instead.
  // This pins the timer, not the pixel: a page that kept the 3.8 s timer and *also* hid the toast early by some other
  // route would still pass. It is the life of the clear that was unpinned before, and that is what this names.
  expect(toasts.pending().map((t) => t.ms)).toEqual([TOAST_MS]);
  await toasts.fire(); // and what that timer does when it comes due is take the toast away
  // ...and it stays away for at least as long as it was ever shown, polled throughout rather than sampled at its ends —
  // one toast-life is the principled window here, where the old wait's 6 s was just the budget it happened to be given.
  // What that leaves unseen, since a finite window always leaves something: a toast that comes *back* more than one
  // toast-life after the clear. A 6 s window caught a flicker at +4000 ms and this does not (it survives on main too).
  await toasts.holds(TOAST_MS, () => expect(screen.queryByText(toast)).toBeNull());
}, 15_000);

test('the tray fills when the capsule cracks, not at commit: it sits in view under the capsule', async () => {
  await renderPull(<RitualProbe />);
  await waitFor(() => expect(ritualRef.current).not.toBeNull());
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('armed'));
  await act(async () => { ritualRef.current!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('capsule'));
  expect(screen.queryByText('This session')).toBeNull(); // committed and allocated, still face-down
  const pulled = ritualRef.current!.ritual.outcomes[0]!;
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  expect(await screen.findByText('This session')).toBeTruthy();
  expect(screen.getByText(/^1 pulled · /)).toBeTruthy();
  const tray = screen.getByTestId('session-tray');
  await fireEvent(tray, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 370, height: 0 } } });
  expect(within(tray).getByLabelText(new RegExp(`^${escapeRe(pulled.card.name)}(,|$)`))).toBeTruthy();
});

test('one album selling out shows a banner that names it, and Got it dismisses it', async () => {
  for (const c of ALBUMS[1].cards) mock!.dev.setStock(c.id, 0);
  await renderPull();
  const text = `${ALBUMS[1].title} is sold out — pulls skip it until the restock on Friday 8pm MYT. Odds spread over the other 2 albums.`;
  expect(await screen.findByText(text)).toBeTruthy();
  await fireEvent.press(screen.getByText('Got it'));
  expect(screen.queryByText(text)).toBeNull();
});

// Review of PR #66: a commit returns before the capsule is scratched, so anything that counts cards (the marquee, the chase
// picker and globe, the page-dot NEW badge, the Albums page) would show the outcome early. The session holds a pull's cards
// until the ritual reveals them.
test('a pull\'s cards wait for the reveal: the marquee, the chase picker and the NEW badge are unchanged at the sealed capsule', async () => {
  const album = ALBUMS[0];
  mock!.dev.forceTier('common');
  album.cards.forEach((c) => mock!.dev.setStock(c.id, 3));
  await renderPull(<><DepositOnce /><RitualProbe /><SessionProbe /></>);
  await waitFor(() => expect(ritualRef.current).not.toBeNull());
  await act(async () => { ritualRef.current!.dispatch({ type: 'SET_TARGET', albumId: album.id }); });
  expect(await screen.findByText('Turn the crank — $1.50, a random card from this album')).toBeTruthy();
  const chip = new RegExp(`^${escapeRe(album.title)}, (\\d+) of (\\d+)$`);
  const have = () => Number(chip.exec(screen.getByLabelText(chip).props.accessibilityLabel as string)![1]);
  const held = () => Number(/(\d+) cards held by you/.exec(screen.getAllByText(/cards held by you/)[0]!.props.children as string)![1]);
  const before = { have: have(), held: held(), newCards: sessionRef.current!.newCards };
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('armed'));
  await act(async () => { ritualRef.current!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('capsule'));
  expect({ have: have(), held: held(), newCards: sessionRef.current!.newCards }).toEqual(before); // committed and allocated, still face-down
  const pulled = ritualRef.current!.ritual.outcomes[0]!;
  expect(pulled.albumId).toBe(album.id);
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); }); // a second crack must not file it again
  await act(async () => { ritualRef.current!.dispatch({ type: 'INTO_BINDER' }); });
  await waitFor(() => expect(held()).toBe(before.held + 1));
  expect(have()).toBe(pulled.isDupe ? before.have : before.have + 1);
  expect(sessionRef.current!.newCards).toBe(before.newCards + (pulled.isDupe ? 0 : 1));
  expect(sessionRef.current!.recent.filter((o) => o.cardId === pulled.cardId)).toHaveLength(1);
}, 15_000);

// Review of PR #66, round 2: a refresh (the connection card's Retry, the Odds page's Try again) while a capsule is still
// face-down reads extras fresh from the server; they wait with the pull like its holdings do.
test('a refresh while a capsule is still face-down keeps its extra waiting for the reveal', async () => {
  const card = ALBUMS[0].cards[0];
  mock!.dev.forceTier('common');
  for (const a of ALBUMS) for (const c of a.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(card.id, 5); // every pull is this card, so from the second copy on each one is an extra
  await renderPull(<><DepositOnce /><RitualProbe /><SessionProbe /></>);
  await waitFor(() => expect(sessionRef.current?.ready).toBe(true));
  const crankToCapsule = async () => {
    await act(async () => { ritualRef.current!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('armed'));
    await act(async () => { ritualRef.current!.dispatch({ type: 'RELEASE' }); });
    await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('capsule'));
  };
  await crankToCapsule();
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { ritualRef.current!.dispatch({ type: 'INTO_BINDER' }); });
  await crankToCapsule();
  expect(ritualRef.current!.ritual.outcomes[0]!.isDupe).toBe(true);
  const extras = sessionRef.current!.extras;
  await act(async () => { await sessionRef.current!.refresh(); });
  expect(sessionRef.current!.extras).toBe(extras); // still face-down
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  expect(sessionRef.current!.extras).toBe(extras + 1);
}, 15_000);

// Review of PR #66, round 3: the balance is read on the Pull page too, so a deposit that lands while it is open still toasts.
// (Jest's fake timers break Reanimated's mocked frames here, so the test fires the page's 15 s balance timer itself.)
test('a deposit that lands while the Pull page is open toasts at its next 15 s balance read', async () => {
  const intervals = jest.spyOn(globalThis, 'setInterval');
  try {
    await renderPull(<SessionProbe />);
    await waitFor(() => expect(sessionRef.current?.ready).toBe(true));
    const poll = intervals.mock.calls.find((c) => c[1] === 15_000)?.[0] as unknown as (() => void) | undefined;
    expect(poll).toBeDefined(); // the Pull page reads the balance every 15 s
    mock!.dev.deposit(5);
    await act(async () => { poll!(); });
    expect(await screen.findByText("Added $5.00 — that's 5 pulls. The machine's lit.")).toBeTruthy();
  } finally {
    intervals.mockRestore();
  }
});

test('entering a chase clears the marquee and keeps the session tray', async () => {
  await renderPull(<><DepositOnce /><RitualProbe /><SessionProbe /></>);
  await waitFor(() => expect(sessionRef.current?.balanceUsd).toBeGreaterThan(0));
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('armed'));
  await act(async () => { ritualRef.current!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(ritualRef.current!.ritual.phase).toBe('capsule'));
  await act(async () => { ritualRef.current!.dispatch({ type: 'CRACKED' }); });
  await act(async () => { ritualRef.current!.dispatch({ type: 'INTO_BINDER' }); });
  const name = sessionRef.current!.recent[0]!.card.name;
  expect(screen.getAllByText(new RegExp(`you pulled ${escapeRe(name)}`)).length).toBeGreaterThan(0);
  await act(async () => { ritualRef.current!.dispatch({ type: 'SET_TARGET', albumId: 'B' }); });
  expect(screen.queryByText(new RegExp(`you pulled ${escapeRe(name)}`))).toBeNull();
  expect(sessionRef.current!.recent[0]!.card.name).toBe(name);
  expect(screen.getByText('Pulling Tidepool Friends · any card in the album')).toBeTruthy();
  expect(screen.queryByText(/duplicate/i)).toBeNull();
}, 15_000);
