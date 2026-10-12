// The first screen's sky, held still (#211; design/README.md "First screen (cold open)"): the vertical night gradient, the
// coral bloom behind the hero, and the vignette that closes the frame.
//
// This is the poster the brief asks for under reduced motion ("no information only in motion"), and it is what a phone falls
// back to if the sky's shader will not compile. Drawn with react-native-svg on both platforms because nothing in it moves, so
// nothing needs a frame loop. What does move is `HeroSky` beside it: a 2D canvas on the web, a Skia shader on a phone.
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, RadialGradient, Rect, Stop } from 'react-native-svg';

export function StillSky() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="still-sky">
      <Svg width="100%" height="100%">
        <Defs>
          <LinearGradient id="ga-sky" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor="#0B1024" />
            <Stop offset="0.55" stopColor="#080B1A" />
            <Stop offset="1" stopColor="#05070F" />
          </LinearGradient>
          {/* Centred at 42% of the height, where the capsule sits. The alphas are the canvas's pulse held at its midpoint
              (.22 + .14 × .5 coral, .07 + .05 × .5 amber), which is exactly what its reduced-motion branch draws.
              The radius is not the canvas's 62% though: a percentage radius in SVG is measured against the normalised
              DIAGONAL, so 62% of a 390×844 frame is 420 px where the canvas means 62% of the width, 242. Ran at 62% first
              and the pool came out half as bright and twice as wide; 37% is the same 242 px back. */}
          <RadialGradient id="ga-bloom" cx="50%" cy="42%" r="37%">
            <Stop offset="0" stopColor="#FF6B5B" stopOpacity="0.29" />
            <Stop offset="0.45" stopColor="#FFAA3C" stopOpacity="0.095" />
            <Stop offset="1" stopColor="#FF6B5B" stopOpacity="0" />
          </RadialGradient>
          {/* The canvas's vignette runs from a radius of .25 H to .85 H about the middle: the same ratio, 0.29 of the outer. */}
          <RadialGradient id="ga-vignette" cx="50%" cy="50%" r="85%">
            <Stop offset="0.29" stopColor="#03050C" stopOpacity="0" />
            <Stop offset="1" stopColor="#03050C" stopOpacity="0.85" />
          </RadialGradient>
          {/* The bottom scrim the copy sits on, so the headline never fights the bloom. */}
          <RadialGradient id="ga-scrim" cx="50%" cy="100%" rx="75%" ry="55%">
            <Stop offset="0" stopColor="#05070F" stopOpacity="0.9" />
            <Stop offset="1" stopColor="#05070F" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ga-sky)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ga-bloom)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ga-vignette)" />
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#ga-scrim)" />
      </Svg>
    </View>
  );
}
