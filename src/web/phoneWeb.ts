// Phone-class browsers (gotchapon.fun on a handset). The desktop cabinet stays on the full motion;
// a narrow window or a coarse pointer gets the cheaper loops. Read from an effect or a handler:
// the first server render has no window, and branching the tree on this in render would mismatch.
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function phoneClassWeb(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(max-width: 767px), (pointer: coarse)').matches;
}

/** False while a browser tab is in the background. Native is always "visible". */
export function useTabVisible(): boolean {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const sync = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return visible;
}
