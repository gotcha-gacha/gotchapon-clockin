// A lost commit response during an outage (review of PR #66, round 3), against the in-app mock. Prepare has already taken the
// free pulls off the counter, so a lost commit no longer leaves them on screen. The balance re-read can still fail; the retry
// reads it again. A quote higher than the price the machine showed still signs nothing — that guard is the cases below, and a screen
// another device made stale (failedPrepare).
// Its own file: it resets the mock and fails commits and reads.
import { expect, jest, test } from '@jest/globals';
import React, { useEffect } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { api, mock } from '@/api';
import type { PullPrepareResponse } from '@/api/contract';
import { ApiError } from '@/api/errors';
import { AuthProvider } from '@/auth/AuthProvider';
import { RitualProvider, useRitual } from '@/ritual/useRitual';
import { PullPage } from '@/screens/PullPage';
import { readPendingPulls } from '@/state/pendingPulls';
import { PAGE, SessionProvider, useSession } from '@/state/session';

const probe: { session: ReturnType<typeof useSession> | null; ritual: ReturnType<typeof useRitual> | null } = { session: null, ritual: null };
function Probe() {
  const session = useSession();
  const ritual = useRitual();
  useEffect(() => { probe.session = session; probe.ritual = ritual; });
  return null;
}
const renderApp = () => render(
  <SafeAreaProvider>
    <AuthProvider>
      <SessionProvider initialPage={PAGE.pull}>
        <RitualProvider><Probe /><PullPage /></RitualProvider>
      </SessionProvider>
    </AuthProvider>
  </SafeAreaProvider>,
);
const shown = () => ({ balanceUsd: probe.session!.balanceUsd, freePulls: probe.session!.freePulls });
const held = () => { const s = mock!.dev.state(); return { balanceUsd: s.balanceUsd, freePulls: s.freePulls }; };
const offline = () => new ApiError({ code: 'NETWORK', message: 'offline' });
/** How many times the cost has been re-read. `refreshCost` reads /balance and /me together, so /me counts the re-reads a
 *  refusal fired — and the count moves the moment one starts, before its answer lands on the screen. */
const meSpy = jest.spyOn(api, 'me');
const meReads = () => meSpy.mock.calls.length;
/** The counter above is cumulative only while the jest config sets no `restoreMocks` / `clearMocks` / `resetMocks`. If one is
 *  ever added it returns 0 forever and every `toBe(readsBefore)` below silently becomes `0 === 0`, so a booted session pins it. */
const assertCounterLive = () => expect(meReads()).toBeGreaterThan(0);

async function crank(multi: 1 | 5, until: 'sealed' | 'capsule' | 'batchcaps') {
  await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('armed'));
  await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe(until));
}

/** A fresh server with three credited free pulls and $10, and a ×5 (3 free + $2) whose first answer is lost. The wait
 *  polls the same commit (#335); the retry is the pull that already landed, so the pile opens instead of a sealed capsule. */
async function landALostFivePull(failedCostReads: number) {
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier('common');
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  expect(held().freePulls).toBe(3);
  const real = api.commitPull.bind(api);
  jest.spyOn(api, 'commitPull').mockImplementationOnce(async (req) => { await real(req); throw offline(); });
  for (let i = 0; i < failedCostReads; i++) meSpy.mockRejectedValueOnce(offline());
  await crank(5, 'batchcaps');
  expect(held().freePulls).toBe(0);
  await act(async () => { probe.ritual!.dispatch({ type: 'OPEN_PILE' }); });
  await act(async () => { probe.ritual!.dispatch({ type: 'INTO_BINDER' }); });
  await waitFor(() => expect(probe.ritual!.ritual.phase).toBe('idle'));
}

test('a lost answer\'s retry reads the cost again when the read right after the failure failed too', async () => {
  await landALostFivePull(1);
  expect(probe.session!.freePulls).toBe(0); // reserved when the ×5 was prepared; the lost commit did not put them back
  await waitFor(() => expect(shown()).toEqual(held()));
  expect(screen.getByText("Turn the crank — that's the $1")).toBeTruthy();
}, 30_000);

test('after a lost ×5 the next ×1 is priced as the paid pull it is, and charges it', async () => {
  await landALostFivePull(2);
  expect(probe.session!.freePulls).toBe(0);
  expect(screen.queryByText(/Free pull/)).toBeNull();
  expect(screen.getByText("Turn the crank — that's the $1")).toBeTruthy();
  const balance = held().balanceUsd;
  await crank(1, 'capsule');
  expect(probe.ritual!.ritual.repriced).toBeUndefined();
  expect(held().balanceUsd).toBe(balance - 1);
}, 30_000);

test('a quote whose price asks more than its transfer signs nothing either: the ledger debits that price', async () => {
  // The mirror of the case below. `costUsd` is what the server charges (the mock debits it at commit), so a quote asking $5
  // there while its transfer honestly asks $2 must not arm a machine showing $2.
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const prepareOnServer = api.preparePull.bind(api);
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => ({ ...(await prepareOnServer(req)), costUsd: 5 }));
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual.repriced).toBe(5));
    expect(probe.ritual!.ritual.phase).toBe('idle');
    expect(held().balanceUsd).toBe(balance); // nothing charged
    expect(readPendingPulls().length).toBe(kept); // and nothing signed
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

// A quote the client cannot read a price out of must arm nothing. Two different ways it hides: `undefined`, a non-numeric
// string and `1e400` make the comparison NaN or Infinity, while `null` and `''` coerce through arithmetic to 0 — the most
// permissive figure there is — so an unreadable price reads as "free" and hands the transfer beside it a signature. `null` is
// the likelier shape on a real wire: most serializers emit it for an absent number rather than dropping the key.
// The machine shows $2 for these (a fresh account's three free pulls against a ×5).
const unreadable: [string, (res: PullPrepareResponse) => PullPrepareResponse][] = [
  ['no price at all, beside a transfer asking $5', (res) => ({ ...res, transfer: { ...res.transfer!, amount: 5_000_000 }, costUsd: undefined as unknown as number })],
  ['a null price, beside a transfer asking $5', (res) => ({ ...res, transfer: { ...res.transfer!, amount: 5_000_000 }, costUsd: null as unknown as number })],
  ['an honest price but a transfer whose amount is null', (res) => ({ ...res, transfer: { ...res.transfer!, amount: null as unknown as number } })],
  ['a price too large to be a price', (res) => ({ ...res, costUsd: Infinity })],
];

test.each(unreadable)('a quote with %s signs nothing: an unpriceable quote is not a quote', async (_label, mangle) => {
  mock!.dev.reset();
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const prepareOnServer = api.preparePull.bind(api);
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => mangle(await prepareOnServer(req)));
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
    expect(probe.ritual!.ritual.repriced).toBeUndefined(); // no "$NaN" or "$Infinity" on the machine
    expect(held().balanceUsd).toBe(balance); // and nothing signed or charged
    expect(readPendingPulls().length).toBe(kept);
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

test('a quote with nothing to sign is still checked against its own price', async () => {
  // No transfer means no signature is required at all (the mock skips that check) while `costUsd` is still debited, so the
  // free-pull machine has to check that field.
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const prepareOnServer = api.preparePull.bind(api);
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req); // a ×1 on a free pull: costUsd 0, no transfer
    expect(res.transfer).toBeUndefined();
    return { ...res, costUsd: 1 };
  });
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual.repriced).toBe(1));
    expect(probe.ritual!.ritual.phase).toBe('idle');
    expect(held().balanceUsd).toBe(balance); // nothing charged, which is the claim
    expect(readPendingPulls().length).toBe(kept);
    // The refused quote leaves its free pull reserved on the mock until it expires — a known mock quirk on the Dev 2 list,
    // not a spend: the balance above is what money moved.
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

test('the amount that would be signed is what is checked, not the price beside it', async () => {
  // A quote whose `transfer.amount` asks for more than its own `costUsd`: the transfer is what the wallet would sign, so it is
  // what the machine's price is checked against. Before this, a ×5 showing $2 would have signed $5.
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const prepareOnServer = api.preparePull.bind(api);
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req);
    expect(res.transfer).toBeDefined(); // a ×5 on three free pulls is $2
    return { ...res, transfer: { ...res.transfer!, amount: res.transfer!.amount + 3_000_000 } };
  });
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual.repriced).toBe(5));
    expect(probe.ritual!.ritual.phase).toBe('idle');
    expect(readPendingPulls().length).toBe(kept); // nothing signed
    expect(held().balanceUsd).toBe(balance);
    expect(screen.getByText('Nothing was charged — that pull costs $5, not what the machine showed. Turn the crank again.')).toBeTruthy();
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

// A quote that arms the machine has to be a quote for *this* pull. The contract fixes a transfer's memo to its own quote's
// `pullId` (BUILD_PLAN §2) and the server reads it back to match a payment to the pull it commits, so a transfer carrying
// someone else's id pays for that pull: an honest $1, to the right treasury, that this pull never sees. The signature goes out,
// the commit for this id finds no payment, and the sealed copy tells the user nothing was taken. Unlike `to` and `mint` — whose
// expected values the client has nowhere to get (BUILD_PLAN §2, "Nothing lets the client check where a quote's money goes") —
// the memo's expected value is in the same response, so this is the one misdirection the client can refuse today.
// The last two are the ones a mirror-check would miss: with no usable id of its own either, the quote's memo "matches" by
// being absent, or by both being empty — and an empty id names no pull at commit any more than a foreign one does.
const misdirected: [string, (res: PullPrepareResponse) => PullPrepareResponse][] = [
  ['a memo naming another pull', (res) => ({ ...res, transfer: { ...res.transfer!, memo: 'pull_2_somebodyelse' } })],
  ['no memo at all', (res) => ({ ...res, transfer: { ...res.transfer!, memo: undefined as unknown as string } })],
  ['a memo that is not a string', (res) => ({ ...res, transfer: { ...res.transfer!, memo: 7 as unknown as string } })],
  ['neither a memo nor a pull id', (res) => ({ ...res, pullId: undefined as unknown as string, transfer: { ...res.transfer!, memo: undefined as unknown as string } })],
  ['an empty memo and an empty pull id', (res) => ({ ...res, pullId: '', transfer: { ...res.transfer!, memo: '' } })],
];

test.each(misdirected)('a quote with %s signs nothing: a transfer has to name the pull it pays for', async (_label, mangle) => {
  mock!.dev.reset();
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const freeShown = probe.session!.freePulls;
  assertCounterLive();
  const readsBefore = meReads();
  const prepareOnServer = api.preparePull.bind(api);
  let quoted: PullPrepareResponse | null = null;
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req);
    quoted = res; // asserted outside the spy, where a throw cannot pass as the refusal this test looks for
    return mangle(res);
  });
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
    expect(quoted).not.toBeNull();
    expect(quoted!.transfer).toBeDefined(); // a x5 on three free pulls is $2, so there is something to sign
    expect(quoted!.transfer!.memo).toBe(quoted!.pullId); // ... and an honest server names the pull in it
    expect(probe.ritual!.ritual.repriced).toBeUndefined(); // the price was honest; there is no figure to put on the machine
    expect(readPendingPulls().length).toBe(kept); // nothing signed
    expect(held().balanceUsd).toBe(balance); // and nothing charged
    // ... and the machine still offers what it offered. A refusal here says nothing about the price, so the cost is not re-read:
    // doing so copies the server's reservation for the quote just refused onto the screen — the free pulls the machine shows go
    // to 0 and the x5 goes from $2 to $5 ("3 free pulls left" disappears) — after a refusal that spent nothing. The
    // wait is what gives this teeth: a re-read calls /me at once but applies 120 ms later, so reading the count straight after
    // the refusal passes either way.
    expect(meReads()).toBe(readsBefore);
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    expect(meReads()).toBe(readsBefore);
    expect(probe.session!.freePulls).toBe(freeShown);
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

test('the memo check refuses only a misdirected transfer: an honest quote still arms and pulls', async () => {
  // The control for the cases above. Without it, a guard that refused every paid quote would look like a pass.
  mock!.dev.reset();
  mock!.dev.creditFree(3);
  mock!.dev.forceTier('common');
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  await crank(5, 'batchcaps'); // three free pulls and $2, through the real mock quote
  expect(probe.ritual!.ritual.error).toBeUndefined();
  expect(held().balanceUsd).toBe(balance - 2); // the paid half of the x5 went through
}, 30_000);

test('a misdirected quote signs nothing even when the hand let go before it came back', async () => {
  // The cases above refuse before the machine ever arms, so "nothing was signed" was never at risk in them. This is the
  // ordering that could sign one: a full turn released while the quote is still in flight (`releasePending`), which is how the
  // amount guard's sibling case at the top of this file is driven.
  mock!.dev.reset();
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  await act(async () => { await probe.session!.devDeposit?.(10); });
  const balance = held().balanceUsd;
  const kept = readPendingPulls().length;
  const prepareOnServer = api.preparePull.bind(api);
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req);
    return { ...res, transfer: { ...res.transfer!, memo: 'pull_2_somebodyelse' } };
  });
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'SET_MULTI', multi: 5 }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await act(async () => { probe.ritual!.dispatch({ type: 'RELEASE' }); }); // let go before the quote came back
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
    expect(readPendingPulls().length).toBe(kept);
    expect(held().balanceUsd).toBe(balance);
  } finally {
    prepare.mockRestore();
  }
}, 30_000);

// A free pull has no transfer and so no memo, but it still has to be a quote for a pull that exists: `pullId` is what the commit
// goes out with, what a kept pull is filed under, and what the free-pull reservation is keyed by. A quote with no usable id of
// its own arms a machine whose pull nothing can open — no money moves, and one free pull is stranded on the server.
const unnamed: [string, (res: PullPrepareResponse) => PullPrepareResponse][] = [
  ['no pull id at all', (res) => ({ ...res, pullId: undefined as unknown as string })],
  ['an empty pull id', (res) => ({ ...res, pullId: '' })],
  ['a pull id that is not a string', (res) => ({ ...res, pullId: 7 as unknown as string })],
];

test.each(unnamed)('a free quote with %s signs nothing either: a quote has to name its own pull', async (_label, mangle) => {
  mock!.dev.reset();
  mock!.dev.creditFree(1);
  await renderApp();
  await waitFor(() => expect(probe.session?.ready).toBe(true));
  const freeBefore = probe.session!.freePulls;
  assertCounterLive();
  const readsBefore = meReads();
  const prepareOnServer = api.preparePull.bind(api);
  // The premise is captured here and asserted outside the spy: a failed `expect` in here throws into `run`'s catch, which turns
  // it into the very PREPARE_FAILED/UNKNOWN this test looks for, so the case would pass on its own broken premise.
  let quoted: PullPrepareResponse | null = null;
  const prepare = jest.spyOn(api, 'preparePull').mockImplementationOnce(async (req) => {
    const res = await prepareOnServer(req);
    quoted = res;
    return mangle(res);
  });
  try {
    await act(async () => { probe.ritual!.dispatch({ type: 'CRANK_START' }); });
    await waitFor(() => expect(probe.ritual!.ritual).toMatchObject({ phase: 'idle', error: 'UNKNOWN' }));
    expect(quoted).not.toBeNull();
    expect(quoted!.transfer).toBeUndefined(); // a ×1 on a free pull: nothing to sign, so no memo to check
    expect(probe.ritual!.ritual.prepared).toBeUndefined(); // the machine never armed on it
    // Same window as the misdirected cases: a re-read calls /me at once but applies 120 ms later, so reading the free-pull
    // count straight after the refusal passes whether or not one fired. Wait it out, and check none fired.
    expect(meReads()).toBe(readsBefore);
    await act(async () => { await new Promise((done) => setTimeout(done, 400)); });
    expect(meReads()).toBe(readsBefore);
    expect(probe.session!.freePulls).toBe(freeBefore);
  } finally {
    prepare.mockRestore();
  }
}, 30_000);
