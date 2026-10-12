// Logo mark 3a, the capsule-crank G (Logo Explorations #3a). Geometry matches assets/brand/mark-3a*.svg.
import React, { useId } from 'react';
import { View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, Line, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { MARK_ARC, MARK_STROKE, markDetail, type MarkDetail } from './markDetail';

const OUTLINE = '#0B1024';
const CORAL = '#FF5A47';
const CREAM = '#F1F3F9';
const GOLD = '#FFD23F';
const FLAT = '#1C2748';

/** Decorative. The wordmark next to it carries the name. `cornerPx` is the tile radius in the rendered size (the splash icon is 10). */
export function Mark({ size, cornerPx }: { size: number; cornerPx?: number }) {
  const detail = markDetail(size);
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const stroke = MARK_STROKE[detail];
  const rx = cornerPx == null ? 27 : (cornerPx / size) * 120;
  return (
    <View testID={`brand-mark-${detail}`} aria-hidden style={{ pointerEvents: 'none' }}>
      <Svg width={size} height={size} viewBox="0 0 120 120">
        <MarkBody detail={detail} id={raw} stroke={stroke} rx={rx} />
      </Svg>
    </View>
  );
}

function MarkBody({ detail, id, stroke, rx }: { detail: MarkDetail; id: string; stroke: (typeof MARK_STROKE)[MarkDetail]; rx: number }) {
  const top = `${id}t`;
  const bottom = `${id}b`;
  const tile = `${id}g`;
  return (
    <>
      <Defs>
        {detail === 'full' ? (
          <RadialGradient id={tile} cx="0.5" cy="0.35" r="0.8">
            <Stop offset="0" stopColor="#2A3A66" />
            <Stop offset="1" stopColor="#141D35" />
          </RadialGradient>
        ) : null}
        <ClipPath id={top}><Rect x="0" y="0" width="120" height="60" /></ClipPath>
        <ClipPath id={bottom}><Rect x="0" y="60" width="120" height="60" /></ClipPath>
      </Defs>
      <Rect width="120" height="120" rx={rx} fill={detail === 'full' ? `url(#${tile})` : FLAT} />
      <Path d={MARK_ARC} stroke={OUTLINE} strokeWidth={stroke.outline} strokeLinecap="round" fill="none" />
      <Path d={MARK_ARC} stroke={CORAL} strokeWidth={stroke.fill} strokeLinecap="round" fill="none" clipPath={`url(#${top})`} />
      <Path d={MARK_ARC} stroke={CREAM} strokeWidth={stroke.fill} strokeLinecap="round" fill="none" clipPath={`url(#${bottom})`} />
      {detail === 'full' ? <Path d="M44 36 A24 24 0 0 1 56 31.5" stroke="#fff" strokeWidth={4} strokeLinecap="round" fill="none" opacity={0.45} /> : null}
      {detail === 'full' ? <Line x1="22" y1="60" x2="40" y2="60" stroke={OUTLINE} strokeWidth={5} /> : null}
      <Line x1="89" y1="60" x2="62" y2="60" stroke={OUTLINE} strokeWidth={stroke.crank} strokeLinecap="round" />
      {detail === 'tiny' ? null : <Circle cx="89" cy="60" r={detail === 'full' ? 6.5 : 7} fill={GOLD} stroke={OUTLINE} strokeWidth={3} />}
      <Circle cx="60" cy="60" r={stroke.button} fill={CREAM} stroke={OUTLINE} strokeWidth={stroke.buttonStroke} />
      {detail === 'full' ? <Circle cx="60" cy="60" r="4" fill="#fff" stroke={OUTLINE} strokeWidth={2} /> : null}
    </>
  );
}
