// "Check the draw" (#418): the link is built by the app from a well-formed signature on a known cluster, never taken from the
// server, and is fetched while the reveal is shown so the press opens it at once.
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { api, type PullDrawView, type PullPrepareResponse } from '@/api';
import { DRAW_LINK_RETRY_MS, DRAW_LINK_TRIES, drawTxUrl, useDrawLink } from './drawLink';

const SIG = '5'.repeat(30) + 'Kq9xYbNw3mH7rTzVdJ2fG8cLpE4sWuA6nB1oXiQjMaRvZyUe9tC'; // 81 base58 characters
const view = (over: Partial<PullDrawView> = {}): PullDrawView =>
  ({ pullId: 'p1', source: 'magicblock', cluster: 'devnet', fulfilSignature: SIG, ...over });

test('a MagicBlock draw with a signature on a known cluster links its Solana Explorer page', () => {
  expect(drawTxUrl(view())).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
  expect(drawTxUrl(view({ cluster: 'mainnet-beta' }))).toBe(`https://explorer.solana.com/tx/${SIG}`);
});

test('anything else links nothing: another source, an unknown cluster, a missing or malformed signature', () => {
  expect(drawTxUrl(view({ source: 'ecvrf' }))).toBeNull();
  for (const cluster of [null, undefined, 'testnet', 'Devnet', 'devnet&x=1', 'https://evil.example/']) {
    expect(drawTxUrl(view({ cluster }))).toBeNull();
  }
  for (const fulfilSignature of [null, undefined, '', 'short', `${SIG}/../../x`, `${SIG}?cluster=mainnet`, SIG.replace('5', '0'),
    SIG.replace('K', 'I'), SIG.replace('q', 'l'), SIG.replace('x', 'O'), 'A'.repeat(63), 'A'.repeat(89)]) {
    expect(drawTxUrl(view({ fulfilSignature }))).toBeNull();
  }
  // The signature's own bounds are links.
  expect(drawTxUrl(view({ fulfilSignature: 'A'.repeat(64) }))).not.toBeNull();
  expect(drawTxUrl(view({ fulfilSignature: 'A'.repeat(88) }))).not.toBeNull();
});

const prepared = (pullId: string, draw = true): PullPrepareResponse => ({ pullId, costUsd: 1, useFreePulls: 0, expiresAt: '2026-10-07T00:01:00Z',
  ...(draw ? { draw: { source: 'magicblock' as const, sequence: 7, poolHash: '0'.repeat(64) } } : {}) });

let pullDraw: jest.SpiedFunction<typeof api.pullDraw>;
beforeEach(() => { jest.useFakeTimers(); pullDraw = jest.spyOn(api, 'pullDraw'); });
afterEach(() => { pullDraw.mockRestore(); jest.useRealTimers(); });
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

test('a pull not drawn by MagicBlock, or not on show, asks for nothing and links nothing', async () => {
  pullDraw.mockResolvedValue(view());
  const off = await renderHook(({ p, shown }: { p: PullPrepareResponse | undefined; shown: boolean }) => useDrawLink(p, shown), { initialProps: { p: prepared('p1', false), shown: true } });
  await flush();
  expect(off.result.current).toBeNull();
  await off.rerender({ p: prepared('p1'), shown: false });
  await flush();
  expect(off.result.current).toBeNull();
  await off.rerender({ p: undefined, shown: true });
  await flush();
  expect(pullDraw).not.toHaveBeenCalled();
});

test('the shown MagicBlock pull gets its link, retried while the fulfilment is not yet known, then given up on', async () => {
  pullDraw.mockResolvedValueOnce(view({ fulfilSignature: null })).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(view());
  const hook = await renderHook(() => useDrawLink(prepared('p1'), true));
  await flush();
  expect(hook.result.current).toBeNull();
  for (let n = 1; n < DRAW_LINK_TRIES; n++) { await act(async () => { jest.advanceTimersByTime(DRAW_LINK_RETRY_MS); }); await flush(); }
  expect(pullDraw).toHaveBeenCalledTimes(DRAW_LINK_TRIES);
  expect(pullDraw).toHaveBeenLastCalledWith('p1');
  expect(hook.result.current).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);

  pullDraw.mockClear();
  pullDraw.mockResolvedValue(view({ fulfilSignature: null }));
  const never = await renderHook(() => useDrawLink(prepared('p2'), true));
  for (let n = 0; n < DRAW_LINK_TRIES + 2; n++) { await flush(); await act(async () => { jest.advanceTimersByTime(DRAW_LINK_RETRY_MS); }); }
  expect(pullDraw).toHaveBeenCalledTimes(DRAW_LINK_TRIES);
  expect(never.result.current).toBeNull();
});

test('an answer for a pull no longer on show never becomes the next pull\'s link', async () => {
  let answerFirst!: (v: PullDrawView) => void;
  pullDraw.mockImplementationOnce(() => new Promise<PullDrawView>((resolve) => { answerFirst = resolve; }));
  pullDraw.mockResolvedValueOnce(view({ pullId: 'p2', fulfilSignature: null }));
  const hook = await renderHook(({ p }: { p: PullPrepareResponse }) => useDrawLink(p, true), { initialProps: { p: prepared('p1') } });
  await hook.rerender({ p: prepared('p2') });
  await flush();
  await act(async () => { answerFirst(view()); });
  await flush();
  expect(hook.result.current).toBeNull();
});

test('the last pull\'s link is not shown on the next pull while the next one\'s draw is still being asked for', async () => {
  pullDraw.mockResolvedValueOnce(view());
  pullDraw.mockImplementationOnce(() => new Promise<PullDrawView>(() => {}));
  const hook = await renderHook(({ p }: { p: PullPrepareResponse }) => useDrawLink(p, true), { initialProps: { p: prepared('p1') } });
  await flush();
  expect(hook.result.current).not.toBeNull();
  await hook.rerender({ p: prepared('p2') });
  await flush();
  expect(hook.result.current).toBeNull();
});

test('a late answer for the last pull does not take the next pull\'s link away', async () => {
  const SIG2 = 'B'.repeat(80);
  let answerFirst!: (v: PullDrawView) => void;
  pullDraw.mockImplementationOnce(() => new Promise<PullDrawView>((resolve) => { answerFirst = resolve; }));
  pullDraw.mockResolvedValueOnce(view({ pullId: 'p2', fulfilSignature: SIG2 }));
  const hook = await renderHook(({ p }: { p: PullPrepareResponse }) => useDrawLink(p, true), { initialProps: { p: prepared('p1') } });
  await hook.rerender({ p: prepared('p2') });
  await flush();
  expect(hook.result.current).toBe(`https://explorer.solana.com/tx/${SIG2}?cluster=devnet`);
  await act(async () => { answerFirst(view()); });
  await flush();
  expect(hook.result.current).toBe(`https://explorer.solana.com/tx/${SIG2}?cluster=devnet`);
});

test('retries wait the full gap, and an unmounted reveal stops asking', async () => {
  pullDraw.mockResolvedValue(view({ fulfilSignature: null }));
  const hook = await renderHook(() => useDrawLink(prepared('p1'), true));
  await flush();
  expect(pullDraw).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(DRAW_LINK_RETRY_MS - 1); });
  await flush();
  expect(pullDraw).toHaveBeenCalledTimes(1);
  await act(async () => { jest.advanceTimersByTime(1); });
  await flush();
  expect(pullDraw).toHaveBeenCalledTimes(2);
  await hook.unmount();
  await act(async () => { jest.advanceTimersByTime(DRAW_LINK_RETRY_MS * 3); });
  await flush();
  expect(pullDraw).toHaveBeenCalledTimes(2);
});
