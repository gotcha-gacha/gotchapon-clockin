// Signing out while a pull's cards wait to be revealed never hides them (reviews of PR #67). Sign-out swaps the pager, and the
// ritual host inside it, for the sign-in screen. The host hands back any waiting cards as it unmounts, and a commit or burn
// whose request was still out when it left (even once a new host is mounted) applies its cards at once instead of parking
// them for a reveal that can no longer happen. If the new host is already holding a pull's cards for its own reveal by then,
// the late cards wait with them, and a pull whose cards come back twice (its first commit, and the one Open it sent) adds its
// new cards to the NEW badge once. A prepare still out when the host leaves is left behind: its answer comes back to a host
// nobody is at, and signs and commits nothing (review of PR #72).
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { PullPrepareResponse } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { ALBUMS } from '@/api/mock/fixtures';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { AccountSheet } from '@/components/AccountSheet';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import * as pendingPulls from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

jest.mock('@/audio/sfx', () => ({ ...jest.requireActual<object>('@/audio/sfx'), playSfx: jest.fn() }));

const live: { auth: ReturnType<typeof useAuth> | null; session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { auth: null, session: null, ritual: null };
function RitualProbe() {
  const r = useRitual();
  useEffect(() => { live.ritual = r; });
  return null;
}
function Probe() {
  const auth = useAuth();
  const session = useSession();
  useEffect(() => { live.auth = auth; live.session = session; });
  return null;
}
/** Home's gate (src/app/index.tsx): signed out shows sign-in, which unmounts the pager and the ritual host inside it. */
function Gate() {
  const auth = useAuth();
  if (auth.stage === 'idle' || auth.stage === 'busy') return <Text>sign-in screen</Text>;
  return (
    <>
      <RitualProvider><RitualProbe /><PullPage /></RitualProvider>
      <AccountSheet onClose={() => {}} />
    </>
  );
}
const heldCards = () => Object.values(live.session!.holdings).reduce((n, h) => n + h.qty, 0);
/** What the app shows of pulled cards: copies held, extras, and the NEW badge. */
const cards = () => ({ held: heldCards(), extras: live.session!.extras, newCards: live.session!.newCards });
/** What the machine shows pulling costs. */
const cost = () => ({ balanceUsd: live.session!.balanceUsd, freePulls: live.session!.freePulls });
/** Cards on stage that were new to the binder: what the NEW badge gains when they are revealed. */
const newOnStage = () => live.ritual!.ritual.outcomes.filter((o) => !o.isDupe).length;

/** Hold the next call to an API method until `release()`, then pass it on to the real mock. */
function holdNext(method: 'holdings' | 'commitPull' | 'burn') {
  const real = (api[method] as (...args: unknown[]) => Promise<unknown>).bind(api);
  let pass!: () => void;
  const spy = jest.spyOn(api, method).mockImplementationOnce(((...args: unknown[]) => new Promise((resolve, reject) => { pass = () => { real(...args).then(resolve, reject); }; })) as never);
  return { spy, release: () => pass() };
}
/** Until the returned restore, re-reading what pulling costs (/me/balance and /me) fails, as it would offline. */
function failCostReads() {
  const offline = new ApiError({ code: 'NETWORK', message: 'cost read failed' });
  const balance = jest.spyOn(api, 'balance').mockRejectedValue(offline);
  const me = jest.spyOn(api, 'me').mockRejectedValue(offline);
  return () => { balance.mockRestore(); me.mockRestore(); };
}

async function signIn() {
  live.ritual = null;
  await act(async () => { live.auth!.signIn('Apple'); });
  await waitFor(() => expect(live.ritual).not.toBeNull());
}
async function mount() {
  await render(<SafeAreaProvider><AuthProvider><SessionProvider initialPage={PAGE.pull}><Probe /><Gate /></SessionProvider></AuthProvider></SafeAreaProvider>);
  await waitFor(() => expect(live.session?.me).toBeTruthy());
  await signIn();
}
/** Mount, and hand back the session's deposit poll: the callback the Pull page runs every 15 s to re-read the balance. setInterval
 *  is spied only while mounting, and passes through. */
async function mountFindingPoll() {
  const interval = jest.spyOn(globalThis, 'setInterval');
  try {
    await mount();
    const poll = interval.mock.calls.find((call) => call[1] === 15_000)?.[0];
    expect(poll).toBeInstanceOf(Function);
    return poll as () => void;
  } finally {
    interval.mockRestore();
  }
}
/** One tick of the deposit poll, with its balance read landed. */
async function pollOnce(poll: () => void) {
  const read = jest.spyOn(api, 'balance');
  try {
    await act(async () => { poll(); await read.mock.results[0]?.value; });
  } finally {
    read.mockRestore();
  }
}
async function turnTheCrank() {
  await act(async () => { live.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(live.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { live.ritual!.dispatch({ type: 'RELEASE' }); });
}
async function signOutAndBackIn() {
  await fireEvent.press(screen.getByLabelText('Sign out'));
  expect(screen.getByText('sign-in screen')).toBeTruthy();
  await signIn();
}
/** Let a held commit response in, and wait until the session has placed its cards (shown, or kept for a reveal): reading the
 *  holdings is the last thing it waits on. */
async function letResponseIn(release: () => void) {
  const readHoldings = api.holdings.bind(api);
  let read = 0;
  const holdings = jest.spyOn(api, 'holdings').mockImplementation(async () => { const list = await readHoldings(); read += 1; return list; });
  try {
    await act(async () => { release(); });
    await waitFor(() => expect(read).toBe(1));
    await act(async () => {});
  } finally {
    holdings.mockRestore();
  }
}

/** A paid ×5 is opened again after signing back in, and its first commit comes back last. `costReads`: after signing back in,
 *  re-reading balance and free pulls works; fails; or fails once a tick of the deposit poll has landed while the first commit
 *  is still out. The failing cases start from a fresh mock with credited free pulls, so free pulls from before the pull
 *  would show. */
async function openedAgainFirstCommitLast(costReads: 'work' | 'fail' | 'fail after a poll') {
  if (costReads !== 'work') { mock!.dev.reset(); mock!.dev.creditFree(3); }
  const poll = await mountFindingPoll();
  if (costReads !== 'work') expect(live.session!.freePulls).toBeGreaterThan(0);
  await act(async () => { await live.session!.devDeposit?.(10); });
  await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  const before = cards();
  const firstCommit = holdNext('commitPull');
  let restoreCostReads = () => {};
  try {
    await turnTheCrank();
    await waitFor(() => expect(firstCommit.spy).toHaveBeenCalled()); // the transfer is signed and the commit request is out
    await signOutAndBackIn();
    if (costReads === 'fail after a poll') await pollOnce(poll); // a balance read while the first commit is out: it predates the pull
    if (costReads !== 'work') restoreCostReads = failCostReads();
    await fireEvent.press(await screen.findByText('Open it')); // the new host sends the commit again, and it comes straight back
    await waitFor(() => expect(live.ritual!.ritual.phase).toBe('batchcaps'));
    expect(firstCommit.spy).toHaveBeenCalledTimes(2);
    const fresh = newOnStage();
    expect(fresh).toBeGreaterThan(0); // so counting them twice would show
    await letResponseIn(firstCommit.release); // the first commit comes back last, to the host that sent it and is gone
    expect(cards()).toEqual(before); // the pile is still sealed
    await act(async () => { live.ritual!.dispatch({ type: 'OPEN_PILE' }); });
    const server = mock!.dev.state();
    expect(cards()).toEqual({ held: before.held + 5, extras: server.extras, newCards: before.newCards + fresh });
    expect(heldCards()).toBe(server.held);
    expect(cost()).toEqual({ balanceUsd: server.balanceUsd, freePulls: server.freePulls });
  } finally {
    restoreCostReads();
    firstCommit.spy.mockRestore();
  }
}

/** A ×1 is sealed while an older paid ×5's response is still out. `costReads: 'fail'`: re-reading balance and free pulls fails from
 *  the moment the ×1 is sealed. */
async function sealedBehindLateFive(costReads: 'work' | 'fail') {
  await mount();
  await act(async () => { await live.session!.devDeposit?.(10); });
  // One card in stock, and the binder does not hold it: the ×5 files it with four extras, and the ×1 is a fifth extra, so a
  // count written before the ×1 would be one short. Stock comes back at the end.
  const card = ALBUMS[0].cards.find((c) => !live.session!.holdings[c.id])!;
  mock!.dev.forceTier('common');
  for (const album of ALBUMS) for (const c of album.cards) mock!.dev.setStock(c.id, c.id === card.id ? 10 : 0);
  await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  const before = cards();
  const heldOnServer = mock!.dev.state().held;
  const sendCommit = api.commitPull.bind(api);
  let letResponseThrough!: () => void;
  // The ×5 lands on the server at once and only its response is held: held before it landed, the ×1's prepare would supersede it.
  const commit = jest.spyOn(api, 'commitPull').mockImplementationOnce((req) => {
    const landed = sendCommit(req);
    return new Promise<Awaited<ReturnType<typeof api.commitPull>>>((resolve, reject) => { letResponseThrough = () => { landed.then(resolve, reject); }; });
  });
  let restoreCostReads = () => {};
  try {
    await turnTheCrank();
    await waitFor(() => expect(mock!.dev.state().held).toBe(heldOnServer + 5));
    await signOutAndBackIn();
    await act(async () => { await live.session!.refreshCost(); }); // what the ×1 costs while the ×5's response is still out
    await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 1 }); });
    await turnTheCrank();
    await waitFor(() => expect(live.ritual!.ritual.phase).toBe('capsule'));
    expect(live.ritual!.ritual.outcomes[0]).toMatchObject({ cardId: card.id, isDupe: true });
    if (costReads === 'fail') restoreCostReads = failCostReads();
    await letResponseIn(letResponseThrough); // the ×5's response comes back to the host that sent it and is gone
    expect(cards()).toEqual(before); // the capsule is still sealed
    await act(async () => { live.ritual!.dispatch({ type: 'CRACKED' }); });
    const server = mock!.dev.state();
    expect(server.extras).toBe(before.extras + 5);
    expect(cards()).toEqual({ held: before.held + 6, extras: server.extras, newCards: before.newCards + 1 });
    expect(heldCards()).toBe(server.held);
    expect(cost()).toEqual({ balanceUsd: server.balanceUsd, freePulls: server.freePulls });
  } finally {
    restoreCostReads();
    commit.mockRestore();
    mock!.dev.forceTier(null);
    for (const album of ALBUMS) for (const c of album.cards) mock!.dev.setStock(c.id, null);
  }
}

test('signing out with a sealed capsule, then back in: the pulled card is in the binder', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await mount();
  const before = heldCards();
  await turnTheCrank();
  await waitFor(() => expect(live.ritual!.ritual.phase).toBe('capsule'));
  expect(heldCards()).toBe(before); // still sealed: not shown yet
  await signOutAndBackIn();
  expect(heldCards()).toBe(before + 1);
  expect(heldCards()).toBe(mock!.dev.state().held);
}, 30_000);

test('a commit whose cards arrive after signing out and back in shows them at once', async () => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await mount();
  const before = heldCards();
  const cardsRead = holdNext('holdings');
  try {
    await turnTheCrank();
    await waitFor(() => expect(cardsRead.spy).toHaveBeenCalled()); // the commit returned; its cards are being read
    await signOutAndBackIn(); // the host that committed is gone, and a new one is mounted
    await act(async () => { cardsRead.release(); });
    await waitFor(() => expect(heldCards()).toBe(before + 1));
    expect(heldCards()).toBe(mock!.dev.state().held);
  } finally {
    cardsRead.spy.mockRestore();
  }
}, 30_000);

test('a paid pull whose commit is still out while you sign out and back in lands in the binder, with nothing left to open', async () => {
  await mount();
  await act(async () => { await live.session!.devDeposit?.(10); });
  await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  const before = heldCards();
  const commit = holdNext('commitPull');
  try {
    await turnTheCrank();
    await waitFor(() => expect(commit.spy).toHaveBeenCalled()); // the transfer is signed and the commit request is out
    await signOutAndBackIn(); // the host that sent it is gone, and a new one is mounted, before it returns
    await act(async () => { commit.release(); });
    await waitFor(() => expect(heldCards()).toBe(before + 5));
    expect(heldCards()).toBe(mock!.dev.state().held);
    await waitFor(() => expect(live.session!.pendingPulls).toHaveLength(0));
  } finally {
    commit.spy.mockRestore();
  }
}, 30_000);

test('a paid ×5 opened again after signing back in, whose first commit comes back last, shows its cards once, when the pile opens', () => openedAgainFirstCommitLast('work'), 30_000);

test('the same, with every cost re-read failing after signing back in: balance and free pulls still end where the server has them', () => openedAgainFirstCommitLast('fail'), 30_000);

test('the same, with a deposit poll landing while the first commit is out and the re-reads failing after it: the late commit still shows its own cost', () => openedAgainFirstCommitLast('fail after a poll'), 30_000);

test('the same pull, but its first commit comes back before the one Open it sent: the NEW badge still counts its cards once', async () => {
  await mount();
  await act(async () => { await live.session!.devDeposit?.(10); });
  await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
  const before = cards();
  const sendCommit = api.commitPull.bind(api);
  const letThrough: (() => void)[] = [];
  const commit = jest.spyOn(api, 'commitPull').mockImplementation((req) => new Promise<Awaited<ReturnType<typeof api.commitPull>>>((resolve, reject) => {
    letThrough.push(() => { sendCommit(req).then(resolve, reject); });
  }));
  try {
    await turnTheCrank();
    await waitFor(() => expect(letThrough).toHaveLength(1));
    await signOutAndBackIn();
    await fireEvent.press(await screen.findByText('Open it'));
    await waitFor(() => expect(letThrough).toHaveLength(2)); // both commits are out
    await letResponseIn(letThrough[0]); // the first lands and comes back while the second is still out
    await act(async () => { letThrough[1](); });
    await waitFor(() => expect(live.ritual!.ritual.phase).toBe('batchcaps'));
    const fresh = newOnStage();
    expect(fresh).toBeGreaterThan(0); // so counting them twice would show
    await act(async () => { live.ritual!.dispatch({ type: 'OPEN_PILE' }); });
    expect(cards()).toEqual({ held: before.held + 5, extras: mock!.dev.state().extras, newCards: before.newCards + fresh });
    expect(heldCards()).toBe(mock!.dev.state().held);
  } finally {
    commit.mockRestore();
  }
}, 30_000);

test('a ×1 sealed while an older paid ×5 is still coming back: nothing of either shows before the crack, and both show then', () => sealedBehindLateFive('work'), 30_000);

test("the same, with cost re-reads failing once the ×1 is sealed: the ×5's older balance never replaces the ×1's", () => sealedBehindLateFive('fail'), 30_000);

test('a prepare still out when you sign out signs and commits nothing when it answers: only the new host\'s pull goes through', async () => {
  await mount();
  await act(async () => { await live.session!.devDeposit?.(10); });
  await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); }); // a ×5 has a transfer to sign
  const keptBefore = pendingPulls.readPendingPulls();
  const prepareOnServer = api.preparePull.bind(api);
  let first: PullPrepareResponse | undefined;
  let answerFirst!: () => void;
  const firstAnswered = new Promise<void>((done) => { answerFirst = done; });
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => { const res = await prepareOnServer(req); first = res; await firstAnswered; return res; });
  const commit = jest.spyOn(api, 'commitPull');
  const writes = jest.spyOn(pendingPulls, 'writePendingPulls');
  try {
    await act(async () => { live.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(first).toBeDefined()); // the server has prepared it, and its answer is held
    await act(async () => { live.ritual!.dispatch({ type: 'RELEASE' }); }); // a full turn before the answer
    await signOutAndBackIn(); // the host waiting on it is gone
    await act(async () => { live.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { live.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(live.ritual!.ritual.phase).toBe('armed')); // the new host's pull, which superseded the first
    const second = live.ritual!.ritual.prepared!.pullId;
    expect(second).not.toBe(first!.pullId);
    await act(async () => { answerFirst(); await new Promise((done) => setTimeout(done, 300)); }); // the first answer reaches the host that has gone
    expect(commit).not.toHaveBeenCalled();
    // Nothing was signed: a signed pull is written to disk the moment its signature exists, even when a failed commit drops it at once.
    expect(writes.mock.calls.flatMap(([list]) => list).some((p) => pendingPulls.pendingId(p) === first!.pullId)).toBe(false);
    await act(async () => { live.ritual!.dispatch({ type: 'RELEASE' }); });
    await waitFor(() => expect(live.ritual!.ritual.phase).toBe('batchcaps'));
    expect(commit.mock.calls).toEqual([[{ pullId: second, txSignature: `mock:${second}` }]]);
    await waitFor(() => expect(pendingPulls.readPendingPulls()).toEqual(keptBefore));
  } finally {
    prepare.mockRestore();
    commit.mockRestore();
    writes.mockRestore();
  }
}, 30_000);

test('a burn whose request is still out while you sign out and back in credits the free pull', async () => {
  await mount();
  // Nine extras of one card (as in burn.test), then stock for the free pull the burn buys. Last in the file: it narrows stock.
  mock!.dev.forceTier('common');
  for (const album of ALBUMS) for (const c of album.cards) mock!.dev.setStock(c.id, 0);
  mock!.dev.setStock(ALBUMS[0].cards[0].id, 10);
  await act(async () => {
    await live.session!.devDeposit?.(10);
    const p = await live.session!.preparePull({ count: 10, targeted: false });
    const txSignature = p.transfer ? await live.session!.signTransfer(p) : undefined;
    live.session!.revealed((await live.session!.commitPull({ pullId: p.pullId, txSignature })).outcomes);
  });
  await waitFor(() => expect(live.session!.extras).toBeGreaterThanOrEqual(5));
  const burn = holdNext('burn');
  try {
    let burning!: Promise<unknown>;
    await act(async () => { burning = live.session!.burn('burn-across-sign-out'); });
    await waitFor(() => expect(burn.spy).toHaveBeenCalled());
    await signOutAndBackIn();
    await act(async () => { burn.release(); await burning; });
    await waitFor(() => expect(heldCards()).toBe(mock!.dev.state().held));
    expect(live.session!.extras).toBe(mock!.dev.state().extras);
    expect(live.session!.freePulls).toBe(mock!.dev.state().freePulls);
    expect(mock!.dev.state().freePulls).toBeGreaterThan(0);
  } finally {
    burn.spy.mockRestore();
  }
}, 30_000);
