// Text inputs on the web (W0.3, #121). iOS Safari zooms the page in when an input whose text is under 16 px takes focus,
// whatever the viewport tag says, and does not zoom back out: the design's 13 / 14 px fields become 16 there. Native keeps
// the design's size. Not in tokens.ts: that file is also read by +html.tsx in Node and stays free of react-native.
import { Platform } from 'react-native';

export const WEB_INPUT_FLOOR = 16;
export const inputFontSize = (designPx: number): number => (Platform.OS === 'web' ? Math.max(WEB_INPUT_FLOOR, designPx) : designPx);
