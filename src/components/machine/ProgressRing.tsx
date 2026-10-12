// Mint conic progress ring around the crank socket (design: conic-gradient #8FE3C5 0→angle).
// Drawn as an SVG arc so the sweep is exact; driven by a shared value so the crank updates it on the UI thread.
import React from 'react';
import Animated, { useAnimatedProps, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';
import { color } from '@/theme/tokens';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export function ProgressRing({ size, thickness, progress }: { size: number; thickness: number; progress: SharedValue<number> }) {
  const r = size / 2 - thickness / 2;
  const c = 2 * Math.PI * r;
  const props = useAnimatedProps(() => ({ strokeDashoffset: c * (1 - Math.min(1, Math.max(0, progress.get()))) }));
  return (
    <Svg width={size} height={size} style={{ position: 'absolute', left: 0, top: 0 }} pointerEvents="none">
      <AnimatedCircle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color.mint}
        strokeWidth={thickness}
        strokeDasharray={`${c} ${c}`}
        animatedProps={props}
        strokeLinecap="butt"
        fill="none"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
    </Svg>
  );
}
