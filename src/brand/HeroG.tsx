// The first-screen hero (#345): logo 3a’s G, with no tile and no ghost card.
// The ring stays open on the upper right and the crank stays — that is what keeps it off a Poké Ball.
// Strokes and the hero gradients are the locked brand section (outline 23, fill 16, crank, gold knob, white hub).
import React, { useId } from 'react';
import Svg, { Circle, ClipPath, Defs, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { HERO_STROKE, MARK_ARC, MARK_HIGHLIGHT } from './markDetail';

const OUTLINE = '#0B1024';

/** Open ring + crank at `size` px. Decorative; the lockup carries the name. */
export function HeroG({ size }: { size: number }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const top = `${raw}t`;
  const bottom = `${raw}b`;
  const coral = `${raw}c`;
  const cream = `${raw}w`;
  const knob = `${raw}k`;
  return (
    <Svg testID="hero-g-mark" width={size} height={size} viewBox="0 0 120 120" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Defs>
        <ClipPath id={top}><Rect x="0" y="0" width="120" height="60" /></ClipPath>
        <ClipPath id={bottom}><Rect x="0" y="60" width="120" height="60" /></ClipPath>
        <LinearGradient id={coral} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FF8573" />
          <Stop offset="1" stopColor="#F0483A" />
        </LinearGradient>
        <LinearGradient id={cream} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="1" stopColor="#D3D9E8" />
        </LinearGradient>
        <RadialGradient id={knob} cx="50%" cy="40%" r="60%">
          <Stop offset="0" stopColor="#FFE680" />
          <Stop offset="0.55" stopColor="#FFD23F" />
          <Stop offset="1" stopColor="#C99A12" />
        </RadialGradient>
      </Defs>
      <Path d={MARK_ARC} stroke={OUTLINE} strokeWidth={HERO_STROKE.outline} strokeLinecap="round" fill="none" />
      <Path d={MARK_ARC} stroke={`url(#${coral})`} strokeWidth={HERO_STROKE.fill} strokeLinecap="round" fill="none" clipPath={`url(#${top})`} />
      <Path d={MARK_ARC} stroke={`url(#${cream})`} strokeWidth={HERO_STROKE.fill} strokeLinecap="round" fill="none" clipPath={`url(#${bottom})`} />
      <Path d={MARK_HIGHLIGHT} stroke="#fff" strokeWidth={HERO_STROKE.highlight} strokeLinecap="round" fill="none" opacity={0.55} />
      <Path d="M89 60 L62 60" stroke={OUTLINE} strokeWidth={HERO_STROKE.crank} strokeLinecap="round" fill="none" />
      <Circle cx="89" cy="60" r={HERO_STROKE.knob} fill={`url(#${knob})`} stroke={OUTLINE} strokeWidth={HERO_STROKE.knobStroke} />
      <Circle cx="60" cy="60" r={HERO_STROKE.hub} fill="#FFFFFF" stroke={OUTLINE} strokeWidth={HERO_STROKE.hubStroke} />
    </Svg>
  );
}
