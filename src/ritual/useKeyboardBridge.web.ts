// The keyboard bridge (W1.2, #124; plan §4.3). MONEY PATH: a press on space or enter can cost $1, so every rule here is one of
// "this press sends nothing". It maps keys to the same calls a hand makes and owns no pull logic: the turn is the crank's
// (`autoCrank`, which goes through the hand's own delta path), the gates are `canCrank`'s, the phases are the reducer's.
//
//   space / enter   off the Pull page → go to Pull, and no phase acts on that press (the pager is free between turns, so a
//                   capsule or a pile can be waiting there). On Pull: idle or coined, and canCrank → autoCrank · capsule → open
//                   it · batchcaps → open the pile · anything else, `sealed` above all → NOTHING (a key never retries a failed
//                   commit; Try again is a button with its own focus)
//   ← →             the page, unless the pager is locked or the odds sleeve is open
//   O               nothing (#332): v0 has no odds sleeve, so the key must not open one
//   esc             NOT HERE for Modals: react-native-web closes its own Modals on Escape, topmost first. Handling it here too
//                   would close two surfaces with one press. `useEscapeToClose` is for what is not a Modal (album detail).
//
// Every key is ignored: with ⌘ / ctrl / alt / shift held, in a text field, before sign-in and onboarding are done, and while any Modal
// is open. space / enter are also ignored while focus is on a control (a button, a link, a tab: anything focusable), because
// the browser already presses that control with the same key: "press Deposit with the keyboard" must not also be a $1 pull.
// A held key (`event.repeat`) never acts.
import { useEffect, useRef } from 'react';
import { PAGE, type PageIndex } from '@/state/session';
import { noteKeyUsed } from '@/web/keyHints';
import type { KeyboardBridge } from './useKeyboardBridge';

const isTextField = (el: EventTarget | null) => {
  const e = el as HTMLElement | null;
  return !!e && (e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' || e.tagName === 'SELECT' || e.isContentEditable === true);
};
/** Focus is on something the browser will press with space / enter. By focusability, not by role: react-native-web renders a
 *  Pressable as whatever role it was given (the rail's are `tab`), always with a tabindex. */
const onAControl = () => {
  const el = document.activeElement as HTMLElement | null;
  return !!el && el !== document.body && el !== document.documentElement && el.tabIndex >= 0;
};
const aModalIsOpen = () => document.querySelector('[aria-modal="true"]') !== null;

export function useKeyboardBridge(bridge: KeyboardBridge): void {
  const live = useRef(bridge);
  useEffect(() => { live.current = bridge; });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const b = live.current;
      if (!b.enabled || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || isTextField(e.target) || aModalIsOpen()) return; // shift+space is the browser's page-up
      if (e.key === ' ' || e.key === 'Enter') {
        if (onAControl()) return; // the control's own press
        e.preventDefault(); // or space scrolls whatever is under the cabinet
        if (e.repeat) return;
        noteKeyUsed();
        if (b.page !== PAGE.pull) { b.setPage(PAGE.pull); return; }
        if ((b.phase === 'idle' || b.phase === 'coined') && b.canCrank) b.autoCrank();
        else if (b.phase === 'capsule') b.openCapsule();
        else if (b.phase === 'batchcaps') b.openPile();
        // rolling, stopping, dropping, committing, sealed, and the rest: a key does nothing.
        return;
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        if (b.pagerLocked || b.oddsOpen) return;
        const next = b.page + (e.key === 'ArrowLeft' ? -1 : 1);
        if (next < 0 || next > 2) return;
        e.preventDefault();
        noteKeyUsed();
        b.setPage(next as PageIndex);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function useEscapeToClose(open: boolean, close: () => void): void {
  const live = useRef(close);
  useEffect(() => { live.current = close; });
  useEffect(() => {
    if (!open) return;
    // keydown, while a Modal on top is still open (RNW closes its Modals on keyup): then this is not the topmost surface, and
    // the press is the Modal's. One press, one surface.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.repeat && !aModalIsOpen() && !isTextField(e.target)) live.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
}
