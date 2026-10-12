/**
 * One active tab (W0.2b, #136), on the Web Locks API. Tabs here are calls to the production `watchActiveTab`, each with its
 * own lock manager onto one `Browser`: a stand-in that does what Chromium was measured doing (18 Sept; the probe is in PR #154):
 * `ifAvailable` answers at once even when the holder is busy, `steal` moves the lock and rejects the old holder's request with
 * an AbortError, a queued request is granted when the holder lets go or its page closes, and a busy tab hears nothing (neither
 * a grant nor a rejection) until its main thread is free. The browser's side happens at once; a tab's side waits for the tab.
 */
import { afterEach, expect, test } from '@jest/globals';
import { LOCK_NAME, watchActiveTab, type LockManagerLike, type TabRole } from '../activeTab.web';

type Req = { tab: Tab; callback: (lock: unknown) => Promise<void> | void; resolve: (v: unknown) => void; reject: (e: unknown) => void };
const abortError = () => Object.assign(new Error('The lock was stolen, or the request was aborted'), { name: 'AbortError' });

class Tab {
  busy = false; closed = false;
  asked = 0; // how many times this tab has asked the browser for the lock
  private inbox: (() => void)[] = [];
  constructor(private browser: Browser) {}
  /** Something for this tab's main thread to run: now, or when it stops being busy. A closed tab runs nothing. */
  post(task: () => void) { if (this.closed) return; if (this.busy) this.inbox.push(task); else queueMicrotask(() => { if (!this.closed) task(); }); }
  wake() { this.busy = false; for (const t of this.inbox.splice(0)) this.post(t); }
  close() { this.closed = true; this.inbox = []; this.browser.tabClosed(this); }
  readonly locks: LockManagerLike = {
    request: (name, options, callback) => new Promise((resolve, reject) => {
      expect(name).toBe(LOCK_NAME);
      this.asked++;
      this.browser.request({ tab: this, callback, resolve, reject }, options);
    }),
  };
}

class Browser {
  holder: Req | null = null;
  queue: Req[] = [];
  tab() { return new Tab(this); }
  private grant(r: Req) {
    this.holder = r; // the browser's side: at once
    r.tab.post(() => { // the tab's side: when it gets to it
      Promise.resolve(r.callback({ name: LOCK_NAME })).then((v) => { if (this.holder === r) { this.holder = null; this.next(); } r.resolve(v); }, r.reject);
    });
  }
  private next() { const r = this.queue.shift(); if (r) this.grant(r); }
  request(r: Req, o: { ifAvailable?: boolean; steal?: boolean; signal?: AbortSignal }) {
    if (o.steal) {
      const old = this.holder;
      this.grant(r);
      if (old) old.tab.post(() => old.reject(abortError())); // the old holder learns when its thread is free
      return;
    }
    if (o.ifAvailable) {
      if (this.holder || this.queue.length) r.tab.post(() => { Promise.resolve(r.callback(null)).then(r.resolve, r.reject); });
      else this.grant(r);
      return;
    }
    o.signal?.addEventListener('abort', () => { const i = this.queue.indexOf(r); if (i >= 0) { this.queue.splice(i, 1); r.tab.post(() => r.reject(abortError())); } });
    if (this.holder) this.queue.push(r); else this.grant(r);
  }
  tabClosed(t: Tab) { this.queue = this.queue.filter((r) => r.tab !== t); if (this.holder?.tab === t) { this.holder = null; this.next(); } }
}

const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const watchers: { stop: () => void }[] = [];
const open = (browser: Browser) => {
  const tab = browser.tab(); const roles: TabRole[] = [];
  const w = watchActiveTab((r) => roles.push(r), tab.locks); watchers.push(w);
  return { tab, roles, ...w, role: () => roles[roles.length - 1] ?? 'deciding' };
};
afterEach(() => { for (const w of watchers.splice(0)) w.stop(); });

test('the only tab runs the machine, as soon as the browser says the lock is free: no timer', async () => {
  const a = open(new Browser());
  expect(a.role()).toBe('deciding');
  await settle();
  expect(a.roles).toEqual(['active']);
});

test('a second tab steps back at once and runs nothing; "Use it here" takes the machine and the first tab goes inert', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  expect(b.roles).toEqual(['other']); // never active, not even for a moment
  expect(a.role()).toBe('active');
  b.takeOver(); await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
  const c = open(br); await settle(); // a third tab is told no by the browser, whoever holds it
  expect([a.role(), b.role(), c.role()]).toEqual(['other', 'active', 'other']);
});

test('an active tab too busy to answer anything: a newcomer still steps back (round 1 of the old protocol made both active, for good)', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  a.tab.busy = true; // a long render, a wasm compile: nothing in this tab runs
  const b = open(br); await settle();
  expect(b.role()).toBe('other'); // the browser answers for the lock; the busy tab does not have to
  a.tab.wake(); await settle();
  expect([a.role(), b.role()]).toEqual(['active', 'other']);
});

test('an explicit "Use it here" is never handed back: the older tab, looked at again, stays on the card (round 2 of the old protocol undid it)', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  b.takeOver(); await settle();
  b.tab.busy = true; // the chosen tab is mid-something and answers nobody
  // (the old protocol re-asked when the older tab was looked at, heard silence and took the machine back; nothing listens for that now)
  await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
  b.tab.wake(); await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
});

test('two tabs press "Use it here" at the same moment: one ends up with the machine, never both and never neither', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); const c = open(br); await settle();
  b.takeOver(); c.takeOver(); await settle();
  expect([a.role(), b.role(), c.role()]).toEqual(['other', 'other', 'active']); // the later press, as the browser ordered them
});

test('the active tab closes: a tab that was waiting gets the machine by itself, and only one of them', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); const c = open(br); await settle();
  a.tab.close(); await settle();
  expect([b.role(), c.role()]).toEqual(['active', 'other']);
  b.tab.close(); await settle();
  expect(c.role()).toBe('active');
});

test('a tab whose machine was taken waits its turn again: when the taker closes, it is back without being asked', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  b.takeOver(); await settle();
  expect(a.roles).toEqual(['active', 'other']);
  b.tab.close(); await settle();
  expect(a.roles).toEqual(['active', 'other', 'active']);
});

test('taken over while busy: the old tab learns when its thread is free, and steps back then', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  a.tab.busy = true;
  b.takeOver(); await settle();
  expect(b.role()).toBe('active');
  expect(a.role()).toBe('active'); // it cannot know yet, and cannot act either: nothing in it runs. The merge-by-id writes are for this window
  a.tab.wake(); await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
});

test('stop lets the lock go (a React effect torn down and run again), says nothing more, and leaves no place in the queue', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  a.stop(); await settle();
  expect(br.holder).toBeNull();
  const again = open(br); await settle(); // the second run of the effect, same page
  expect(again.role()).toBe('active');
  const b = open(br); await settle();
  b.stop(); await settle();
  expect(br.queue).toHaveLength(0);
  again.stop(); await settle();
  expect(br.holder).toBeNull(); // b's cancelled place did not inherit it
  expect(a.roles).toEqual(['active']); expect(b.roles).toEqual(['other']);
  a.takeOver(); await settle(); // a stopped tab takes nothing
  expect(br.holder).toBeNull();
});

test('a tab that stops in the very tick the browser hands it the lock lets it go: or every other tab would sit on the card for good', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); const c = open(br); await settle(); // both waiting behind a
  a.tab.close(); // the browser grants b's queued request...
  b.stop(); // ...and b unmounts before it has heard (a route change, a React effect torn down)
  await settle();
  expect(br.holder?.tab).toBe(c.tab); // b did not keep a lock it no longer watches
  expect(c.role()).toBe('active');
  expect(b.roles).toEqual(['other']);
});

test('pressing "Use it here" while already active asks the browser for nothing; taking over leaves no stale place in the queue', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  expect(br.queue.map((r) => r.tab)).toEqual([b.tab]); // b waits its turn
  b.takeOver(); await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
  expect(br.queue.map((r) => r.tab)).toEqual([a.tab]); // a waits now, and b's old place is gone: it would be granted to a tab that is not waiting
  const asked = b.tab.asked;
  b.takeOver(); await settle();
  expect(b.tab.asked).toBe(asked);
  expect(b.roles).toEqual(['other', 'active']);
});

test('the holder closes and the waiting tab presses "Use it here" in the same instant: it has the machine, not the card', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  a.tab.close(); // the browser hands b's queued request the lock: b has not heard yet
  b.takeOver(); // and b's own steal takes the lock from b's own older request, which is then told "stolen"
  await settle();
  expect(b.role()).toBe('active'); // reading that as another tab's takeover would leave every tab on the card, holding the lock
  expect(br.holder?.tab).toBe(b.tab);
  const c = open(br); await settle();
  c.takeOver(); await settle();
  expect([b.role(), c.role()]).toEqual(['other', 'active']); // and it still steps back for a real one
});

test('"Use it here" before the browser has answered the first question: the late "taken" answer changes nothing, and a later takeover is still obeyed', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); // asked, not yet answered
  b.takeOver(); await settle();
  expect([a.role(), b.role()]).toEqual(['other', 'active']);
  a.takeOver(); await settle();
  expect([a.role(), b.role()]).toEqual(['active', 'other']); // b's steal is still the request that counts, so its loss is heard
});

test('a stopped tab asks for nothing: pressing its button cannot take the machine from the tab that has it', async () => {
  const br = new Browser();
  const a = open(br); await settle();
  const b = open(br); await settle();
  b.stop(); await settle();
  const asked = b.tab.asked;
  b.takeOver(); await settle();
  expect(b.tab.asked).toBe(asked);
  expect(a.roles).toEqual(['active']); // never interrupted
});

test('no Web Locks at all (an insecure context, an old browser): this tab runs the machine', () => {
  const roles: TabRole[] = [];
  const w = watchActiveTab((r) => roles.push(r), null); watchers.push(w);
  expect(roles).toEqual(['active']);
});

test('4000 random histories (open, close, take over, go busy, wake): once every tab has caught up, exactly one open tab has the machine', async () => {
  let seed = 20260918; const rnd = (n: number) => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed % n; };
  for (let run = 0; run < 4000; run++) {
    const br = new Browser(); const tabs = [open(br)];
    for (let step = 0; step < 12; step++) {
      const live = tabs.filter((t) => !t.tab.closed); const t = live[rnd(Math.max(1, live.length))];
      const what = rnd(6);
      if (what === 0 || !t) { if (tabs.length < 5) tabs.push(open(br)); }
      else if (what === 1) { t.stop(); t.tab.close(); }
      else if (what === 2) t.takeOver();
      else if (what === 3) t.tab.busy = true;
      else if (what === 4) t.tab.wake();
      if (rnd(2)) await settle(); // and sometimes the next thing happens before anyone has caught up
      const awake = tabs.filter((x) => !x.tab.closed && !x.tab.busy && x.role() === 'active');
      if (awake.length > 1) throw new Error(`run ${run} step ${step}: ${awake.length} awake tabs think they are active`);
    }
    for (const t of tabs) if (!t.tab.closed) t.tab.wake();
    await settle();
    const live = tabs.filter((t) => !t.tab.closed);
    const active = live.filter((t) => t.role() === 'active').length;
    if (live.length && active !== 1) throw new Error(`run ${run}: ${live.length} open tabs, ${active} active: ${live.map((t) => t.role()).join(',')}`);
    for (const t of live) t.stop();
  }
});
