// A sheet route's one decision (W2.1, #128): show the sheet only while the app beneath it is on screen (appGate.ts). Otherwise
// the route steps back, and a sheet that was never shown and is only waiting (a cold load before sign-in) is left to be pushed
// again when the app is up. A sheet that WAS shown and loses its place (another tab took the machine, sign-out) just goes.
// `leave` is the route's only way out and it is guarded: exactly one Back, whoever calls it and however often (a second Back
// would pop the app itself). `onLeave` runs first, so whatever marks the sheet open is cleared before the Back.
import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { useAppGate } from './appGate';
import { deferSheet, type SheetHref } from './sheetRoutes';

export function useSheetGate(href: SheetHref, onLeave?: () => void): { shown: boolean; leave: () => void } {
  const gate = useAppGate();
  const router = useRouter();
  const wasShown = useRef(false);
  const left = useRef(false);
  const live = useRef({ href, onLeave, router });
  useEffect(() => { live.current = { href, onLeave, router }; });
  const leave = useCallback(() => {
    if (left.current) return;
    left.current = true;
    live.current.onLeave?.();
    live.current.router.back();
  }, []);
  useEffect(() => {
    if (gate === 'show') { wasShown.current = true; return; }
    if (gate === 'wait' && !wasShown.current) deferSheet(live.current.href);
    leave();
  }, [gate, leave]);
  return { shown: gate === 'show', leave };
}
