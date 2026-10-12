// The first screen's sky on a phone (#211): the still poster, with the Skia motion world over it once the screen has been
// measured. Reduced motion, or a shader that will not compile, leaves the poster alone — which is what the brief asks for
// ("reduced motion still reads as Gachapon") and what a device with no working shader should show anyway.
//
// The web resolves `HeroSky.web.tsx` instead and never loads the Skia half.
import React, { useState } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { SkiaSky } from '@/screens/firstScreen/SkiaSky';
import { StillSky } from '@/screens/firstScreen/StillSky';

export function HeroSky({ reduced, calm, tilt }: { reduced: boolean; calm: boolean; tilt: { x: SharedValue<number>; y: SharedValue<number> }; paused?: boolean }) {
  const [box, setBox] = useState({ width: 0, height: 0 });
  // The sky slides the other way from the hero, which is what makes the hero look nearer (the pack's ∓5 px, ∓3 px at 1.04).
  const drift = useAnimatedStyle(() => ({
    transform: [{ translateX: tilt.x.get() * -10 }, { translateY: tilt.y.get() * -6 }, { scale: 1.04 }],
  }));
  const onLayout = (e: LayoutChangeEvent) => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="hero-sky" onLayout={onLayout}>
      <StillSky />
      {reduced || box.width === 0 ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, drift]}>
          <SkiaSky width={box.width} height={box.height} calm={calm} />
        </Animated.View>
      )}
    </View>
  );
}
