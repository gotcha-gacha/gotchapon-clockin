// Android's Back (the key, or the system's back gesture) inside the signed-in app (11 Oct 2026, for the judging build). The pages
// and the open binder are session state, not screens on a stack, so with nothing listening every Back left the app, an open
// binder included. Now, in order: a binder open on the Albums page closes; any page but Pull goes to Pull; on Pull the system
// has it, as before (the app goes to the background).
//
// A sheet is not handled here and is never reached: every sheet over the app is a Modal, which on Android is a dialog window
// with its own Back (its `onRequestClose`), so this listener on the activity does not hear that press. iOS has no Back key;
// the web's Back is the browser's (useHardwareBack.web.ts, and useUrlState).
import { useEffect } from 'react';
import { BackHandler } from 'react-native';
import { PAGE, type PageIndex } from '@/state/session';

export type BackStep = 'closeBinder' | 'toPull' | null;

/** What one Back does, or null to let the system have it. A binder left open behind another page is not in front of anyone:
 *  Back there goes to Pull, not to a binder nobody is looking at. */
export function backStep(page: PageIndex, albumOpen: string | null): BackStep {
  if (page === PAGE.albums && albumOpen !== null) return 'closeBinder';
  if (page !== PAGE.pull) return 'toPull';
  return null;
}

/** Listens only while `enabled`: the pages are what is on screen (signed in, past onboarding, not geo-blocked). */
export function useHardwareBack({ enabled, page, albumOpen, closeAlbum, setPage }: {
  enabled: boolean;
  page: PageIndex;
  albumOpen: string | null;
  closeAlbum: () => void;
  setPage: (p: PageIndex) => void;
}): void {
  useEffect(() => {
    if (!enabled) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      const step = backStep(page, albumOpen);
      if (step === 'closeBinder') closeAlbum();
      else if (step === 'toPull') setPage(PAGE.pull);
      return step !== null;
    });
    return () => sub.remove();
  }, [enabled, page, albumOpen, closeAlbum, setPage]);
}
