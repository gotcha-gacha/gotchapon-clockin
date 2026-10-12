// One active tab (W0.2b, #136; Ben, 17 Sept). Every tab of a browser shares localStorage, and the session (its kept pulls, its
// balance, its ritual) is written for a single writer. So one tab runs the machine, and any other shows "gachapon is open in
// another tab · Use it here" and runs nothing until it takes over, at which point the first goes inert. Merge-by-id writes
// (pendingPulls) are the safety net behind this, not a replacement for it.
//
// Who has the machine is not worked out by the tabs: the browser already keeps that fact. One named Web Lock; the tab that
// holds it is the active one. The first version of this file had the tabs agree among themselves over a BroadcastChannel, with
// a 250 ms silence meaning "nobody is here", and two review rounds each found an interleaving where that guess was wrong (a
// busy tab that never answered in time: two active tabs for good; then the tie-break for that handing an explicit "Use it
// here" back to an older tab). A lock has no such cases, because nothing is inferred. Measured in Chromium, 18 Sept:
//   · asked with `ifAvailable`, a second tab is told at once that the lock is taken, even while the holder's main thread is
//     busy for 1.5 s (no timer, nothing to guess);
//   · `steal` ("Use it here") gives the lock to the asker and rejects the old holder's request with an AbortError;
//   · a tab waiting in the queue is granted the lock by itself when the holder's page closes.
// The same three in Mobile Safari (iOS 18.1 simulator, PR #154's third review, which also checked this file's stand-in lock
// manager in the tests against the real API point by point). Not observed: Safari at the 16.4 floor, and a tab the browser
// has frozen in the background.
//
// No `navigator.locks` (an insecure context, which is what a phone gets from a dev server on a LAN address; or a browser
// below the floor): this tab runs the machine. That is the app as it was before this ticket, with the merge-by-id writes behind it.
import { useEffect, useRef, useState } from 'react';
import type { TabRole } from './activeTab.types';

export type { TabRole } from './activeTab.types';

export const LOCK_NAME = 'gachapon-active-tab';

type LockOptions = { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal };
/** The part of the Web Locks API this file uses: `navigator.locks`, or a stand-in with the same behaviour in a test. */
export type LockManagerLike = { request: (name: string, options: LockOptions, callback: (lock: unknown) => Promise<void> | void) => Promise<unknown> };

const browserLocks = (): LockManagerLike | null => {
  const nav = (globalThis as { navigator?: { locks?: LockManagerLike } }).navigator;
  return nav?.locks && typeof nav.locks.request === 'function' ? nav.locks : null;
};

/** The arrangement, without React: `onRole` hears every change, `takeOver` makes this tab the active one. */
export function watchActiveTab(onRole: (r: TabRole) => void, locks: LockManagerLike | null = browserLocks()) {
  let role: TabRole = 'deciding';
  let stopped = false;
  let letGo: (() => void) | null = null; // settles the promise the lock is held by: the browser then frees it
  let queued: AbortController | null = null; // this tab's place in the queue, while another tab holds the lock
  let latest = 0; // only the newest request of ours may change anything: an older one that is answered late is let go of
  const become = (r: TabRole) => { if (!stopped && r !== role) { role = r; onRole(r); } };

  /** Ask for the lock. `try`: only if it is free right now. `wait`: stand in the queue. `steal`: take it from whoever has it. */
  const ask = (how: 'try' | 'wait' | 'steal') => {
    if (!locks) { become('active'); return; }
    const mine = ++latest;
    queued?.abort(); queued = null; // one request of ours at a time
    let got = false;
    const waiting = how === 'wait' ? new AbortController() : null;
    queued = waiting;
    const options: LockOptions = how === 'try' ? { ifAvailable: true } : how === 'steal' ? { steal: true } : { signal: waiting!.signal };
    locks.request(LOCK_NAME, options, (lock) => {
      if (stopped || mine !== latest) return; // answered after this tab stopped caring, or after it asked again: returning lets the lock go at once
      if (queued === waiting) queued = null;
      if (!lock) { become('other'); ask('wait'); return; } // `try`, and another tab has it: wait for that tab to close or be taken over
      got = true;
      become('active');
      return new Promise<void>((resolve) => { letGo = resolve; }); // held for as long as this promise is pending
    }).catch(() => {
      // Two ways to land here. We held the lock and another tab stole it ("Use it here" over there): step back, and wait for it
      // to come free again. Or our own place in the queue was cancelled (by `stop`, or by a newer request of ours): nothing to do.
      if (!got || stopped) return; // (`got` means this is still the newest request: once a tab holds the lock it asks for nothing more)
      letGo = null;
      become('other');
      ask('wait');
    });
  };

  ask('try');
  return {
    takeOver: () => { if (!stopped && role !== 'active') ask('steal'); },
    stop: () => { stopped = true; queued?.abort(); queued = null; letGo?.(); letGo = null; },
  };
}

export function useActiveTab(): { role: TabRole; takeOver: () => void } {
  const [role, setRole] = useState<TabRole>('deciding');
  const watch = useRef<ReturnType<typeof watchActiveTab> | null>(null);
  useEffect(() => {
    const w = watchActiveTab(setRole);
    watch.current = w;
    return () => { w.stop(); watch.current = null; };
  }, []);
  return { role, takeOver: () => watch.current?.takeOver() };
}
