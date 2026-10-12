import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { BUFFER_CAP, ERROR_CAP, captureError, identify, pendingEvents, resetAnalyticsForTests, resetIdentity, setAnalyticsSink, track } from './index';

afterEach(() => resetAnalyticsForTests());

describe('analytics seam', () => {
  test('events buffer until a sink is installed, then replay once in order', () => {
    setAnalyticsSink(null);
    track('session_start', { usingMock: true });
    track('pull_committed', { count: 1, targeted: false, freePulls: 3, costUsd: 0 });
    expect(pendingEvents().map((e) => e.name)).toEqual(['session_start', 'pull_committed']);
    const seen: string[] = [];
    setAnalyticsSink((e) => seen.push(e.name));
    expect(seen).toEqual(['session_start', 'pull_committed']);
    expect(pendingEvents()).toEqual([]);
    track('odds_viewed', {});
    expect(seen).toEqual(['session_start', 'pull_committed', 'odds_viewed']);
    setAnalyticsSink(null);
  });

  // #143 (audit item 7): the buffer had no cap, so a build that never installs a sink (no key) grew it for the life of the page.
  test('with no sink the buffer keeps the newest BUFFER_CAP events and drops the oldest', () => {
    for (let i = 0; i < BUFFER_CAP + 5; i++) track('deposit_credited', { usd: i });
    const kept = pendingEvents();
    expect(kept).toHaveLength(BUFFER_CAP);
    expect((kept[0] as { props: { usd: number } }).props.usd).toBe(5); // the five oldest went
    expect((kept[kept.length - 1] as { props: { usd: number } }).props.usd).toBe(BUFFER_CAP + 4);
  });

  test('a vendor installed after sign-in learns who the user is; a sign-out is forgotten by both', () => {
    identify('user_1');
    const v = { send: jest.fn(), identify: jest.fn(), reset: jest.fn() };
    setAnalyticsSink(v);
    expect(v.identify).toHaveBeenCalledWith('user_1');
    identify('user_2');
    expect(v.identify).toHaveBeenLastCalledWith('user_2');
    resetIdentity();
    expect(v.reset).toHaveBeenCalledTimes(1);
    setAnalyticsSink(null);
    const later = { send: jest.fn(), identify: jest.fn(), reset: jest.fn() };
    setAnalyticsSink(later);
    expect(later.identify).not.toHaveBeenCalled(); // nobody is signed in any more
  });

  test('errors caught before a vendor exists reach it once it does, newest ERROR_CAP of them', () => {
    for (let i = 0; i < ERROR_CAP + 3; i++) captureError(new Error(`e${i}`));
    const v = { send: jest.fn(), captureError: jest.fn() };
    setAnalyticsSink(v);
    expect(v.captureError).toHaveBeenCalledTimes(ERROR_CAP);
    expect((v.captureError.mock.calls[0][0] as Error).message).toBe('e3');
    captureError(new Error('live'));
    expect(v.captureError).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'live' }));
  });

  test('a vendor without identify or captureError is fine: those calls are simply nothing', () => {
    const v = { send: jest.fn() };
    setAnalyticsSink(v);
    expect(() => { identify('u'); resetIdentity(); captureError(new Error('x')); }).not.toThrow();
    track('odds_viewed', {});
    expect(v.send).toHaveBeenCalledTimes(1);
  });
});
