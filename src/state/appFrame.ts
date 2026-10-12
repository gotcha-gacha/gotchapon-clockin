// The box the app is drawn in (W1.1, #123). On a phone that is the window. In a desktop browser the app sits inside the
// arcade cabinet's 390×844 screen while the window is 1440 wide, so anything that sizes itself from "the window" (the odds
// sleeve's width, the album-complete takeover, the burn's gather) would be laid out for the wrong box. The web shell provides
// the frame; with no provider (native, and the frameless mobile web) it is the window, as before. Not in src/web/: the apps import it.
import { createContext, useContext } from 'react';
import { useWindowDimensions } from 'react-native';

/** `scale`: how much smaller than drawn the frame is on the glass (the cabinet is CSS-scaled to fit the window); 1 everywhere else. */
export type AppFrame = { width: number; height: number; scale: number };
const Ctx = createContext<AppFrame | null>(null);
export const AppFrameProvider = Ctx.Provider;

export function useAppFrame(): AppFrame {
  const win = useWindowDimensions();
  const frame = useContext(Ctx);
  return frame ?? { width: win.width, height: win.height, scale: 1 };
}

/**
 * What a gesture multiplies its positions and distances by to get the app's own points. gesture-handler's web build measures a
 * touch against the view's box ON THE GLASS (`clientX − getBoundingClientRect().left`), so inside a cabinet scaled to 0.446 a
 * touch on the crank's centre arrives as (19.6, 19.6) while the crank knows its centre as (44, 44): measured 18 Sept, a full
 * 1008° circle of the pointer turned the knob 99° and no pull started. 1 on a phone and on the frameless mobile web.
 * Every `Gesture.Pan()` that reads `e.x` / `e.y` / a translation uses it (there is a test that says so).
 */
export function useGestureScale(): number {
  return 1 / useAppFrame().scale;
}
