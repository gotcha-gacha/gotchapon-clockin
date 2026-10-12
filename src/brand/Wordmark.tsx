// Gotchapon wordmark (#336). "Gotcha" in ink, "pon" in coral. The in-app header is the caps
// treatment: 12px / 900, 2.5 tracking, GOTCHA #C9D3EE + PON #FF8A7A. No ® or ™ — clearance is pending.
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { color } from '@/theme/tokens';
import { font } from '@/theme/fonts';
import { Mark } from './Mark';
import { PRODUCT_NAME } from './name';

export type WordmarkVariant = 'header' | 'lockup' | 'light';

const PARTS: Record<WordmarkVariant, { left: string; right: string; leftColor: string; rightColor: string; weight: string; size: number; track: number }> = {
  header: { left: 'GOTCHA', right: 'PON', leftColor: color.brandHeaderGotcha, rightColor: color.brandHeaderPon, weight: font.black, size: 12, track: 2.5 },
  lockup: { left: 'Gotcha', right: 'pon', leftColor: color.text, rightColor: color.rimCoral, weight: font.extrabold, size: 20, track: -0.75 },
  light: { left: 'Gotcha', right: 'pon', leftColor: color.inkOnYellow, rightColor: color.brandPonLight, weight: font.extrabold, size: 20, track: -0.75 },
};

/** Two-tone product name. `size` overrides the variant's default and scales its tracking with it. */
export function Wordmark({ variant, size }: { variant: WordmarkVariant; size?: number }) {
  const part = PARTS[variant];
  const px = size ?? part.size;
  const track = part.track * (px / part.size);
  const base: StyleProp<TextStyle> = { fontFamily: part.weight, fontSize: px, letterSpacing: track, lineHeight: Math.round(px * 1.2) };
  return (
    <Text accessibilityRole="text" accessibilityLabel={PRODUCT_NAME} style={base}>
      <Text style={{ color: part.leftColor }}>{part.left}</Text>
      <Text style={{ color: part.rightColor }}>{part.right}</Text>
    </Text>
  );
}

/** Mark plus wordmark, the lockup the marquee and shell use. The cold open uses `SplashLockup`. */
export function BrandLockup({ variant, size, mark }: { variant: WordmarkVariant; size?: number; mark: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: Math.max(4, Math.round(mark * 0.28)) }}>
      <Mark size={mark} />
      <Wordmark variant={variant} size={size} />
    </View>
  );
}

/** Cold-open lockup (#345): 38px icon, 10px gap, 25px wordmark, 8.5px tagline. Not a control. */
export const SPLASH_ICON = 38;
export const SPLASH_WORD = 25;
export const SPLASH_TAG = 8.5;
export const TAGLINE = 'REAL CARDS · $1 A PULL';

export function SplashLockup() {
  return (
    <View testID="splash-lockup" style={splash.wrap}>
      <View style={splash.icon}>
        <Mark size={SPLASH_ICON} cornerPx={10} />
      </View>
      <View style={splash.copy}>
        <Wordmark variant="lockup" size={SPLASH_WORD} />
        <Text style={splash.tag}>{TAGLINE}</Text>
      </View>
    </View>
  );
}

const splash = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  icon: {
    width: SPLASH_ICON,
    height: SPLASH_ICON,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  copy: { alignItems: 'center', gap: 2 },
  tag: { fontFamily: font.black, fontSize: SPLASH_TAG, letterSpacing: SPLASH_TAG * 0.26, color: color.text2 },
});
