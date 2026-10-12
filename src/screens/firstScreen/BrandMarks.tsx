// The marks on Continue with Apple / Continue with Google.
//
// The pack leaves an empty span where Apple's logo goes, and paints Google as a gradient clipped to the letter G
// (`design/Pocket Binder v4.dc.html`). Neither is a mark this app can draw: the private-use "" exists only in SF, so
// web and Android showed a bare white pill, and a background-clip gradient is not something React Native paints, which
// is why the button said a blue "G". These are the marks themselves. Apple's is the bitten-apple silhouette, filled with
// the same ink as the label (Sign in with Apple: a white button carries a black logo and black text; the label is
// already `color.room`). Google's is the published four-colour G — the mark only, not a wordmark — in the colours from
// Google's own `logo_googleg_48dp` artwork.
import React from 'react';
import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { color } from '@/theme/tokens';

/** Decorative: the button's words are the accessible name. A view carries `aria-hidden`, which native
 *  turns into accessibilityElementsHidden and the web writes as the attribute. */
const quiet = { pointerEvents: 'none' as const };
function Mark({ children }: { children: React.ReactNode }) {
  return <View aria-hidden style={quiet}>{children}</View>;
}

/** 14×17, the proportions of Apple's Sign in with Apple artwork (the silhouette is 814×1000). */
export function AppleMark() {
  return (
    <Mark>
      <Svg testID="apple-mark" width={14} height={17} viewBox="0 0 814 1000">
        <Path
          fill={color.room}
          d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76.5 0-103.7 40.8-165.9 40.8s-105.6-57-155.5-127C46.7 790.7 0 663 0 541.8c0-194.4 126.4-297.5 250.8-297.5 66.1 0 121.2 43.4 162.7 43.4 39.5 0 101.1-46 176.3-46 28.5 0 130.9 2.6 198.3 99.2zm-234-181.5c31.1-36.9 53.1-88.1 53.1-139.3 0-7.1-.6-14.3-1.9-20.1-50.6 1.9-110.8 33.7-147.1 75.8-28.5 32.4-55.1 83.6-55.1 135.5 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 45.4 0 102.5-30.4 135.5-71.3z"
        />
      </Svg>
    </Mark>
  );
}

/** Google's published G colours. Not app-palette tokens: changing one of these changes the mark. */
const GOOGLE = {
  blue: '#4285F4',
  green: '#34A853',
  yellow: '#FBBC05',
  red: '#EA4335',
} as const;

/** Square box; the artwork's viewBox is 118×120, so the height keeps that ratio at an 18 px width. */
export function GoogleMark() {
  return (
    <Mark>
      <Svg testID="google-mark" width={18} height={18.3} viewBox="0 0 118 120">
        <Path fill={GOOGLE.blue} d="M117.6,61.3636364 C117.6,57.1090909 117.218182,53.0181818 116.509091,49.0909091 L60,49.0909091 L60,72.3 L92.2909091,72.3 C90.9,79.8 86.6727273,86.1545455 80.3181818,90.4090909 L80.3181818,105.463636 L99.7090909,105.463636 C111.054545,95.0181818 117.6,79.6363636 117.6,61.3636364 L117.6,61.3636364 Z" />
        <Path fill={GOOGLE.green} d="M60,120 C76.2,120 89.7818182,114.627273 99.7090909,105.463636 L80.3181818,90.4090909 C74.9454545,94.0090909 68.0727273,96.1363636 60,96.1363636 C44.3727273,96.1363636 31.1454545,85.5818182 26.4272727,71.4 L6.38181818,71.4 L6.38181818,86.9454545 C16.2545455,106.554545 36.5454545,120 60,120 L60,120 Z" />
        <Path fill={GOOGLE.yellow} d="M26.4272727,71.4 C25.2272727,67.8 24.5454545,63.9545455 24.5454545,60 C24.5454545,56.0454545 25.2272727,52.2 26.4272727,48.6 L26.4272727,33.0545455 L6.38181818,33.0545455 C2.31818182,41.1545455 0,50.3181818 0,60 C0,69.6818182 2.31818182,78.8454545 6.38181818,86.9454545 L26.4272727,71.4 L26.4272727,71.4 Z" />
        <Path fill={GOOGLE.red} d="M60,23.8636364 C68.8090909,23.8636364 76.7181818,26.8909091 82.9363636,32.8363636 L100.145455,15.6272727 C89.7545455,5.94545455 76.1727273,0 60,0 C36.5454545,0 16.2545455,13.4454545 6.38181818,33.0545455 L26.4272727,48.6 C31.1454545,34.4181818 44.3727273,23.8636364 60,23.8636364 L60,23.8636364 Z" />
      </Svg>
    </Mark>
  );
}
