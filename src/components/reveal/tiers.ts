// Rarity escalation (design/README.md "Motion & feedback timing sheet" + v4 TIER table).
import * as Haptics from 'expo-haptics';
import type { Tier } from '@/api/contract';
import { tierColor } from '@/theme/tokens';

export type TierSpec = { glow: string; chip: string; lvl: 0 | 1 | 2 | 3 | 4; tag: string; buzz: number[]; dur: number; foil: number; scratchNeed: number };

export const TIER: Record<Tier, TierSpec> = {
  common: { glow: tierColor.common, chip: 'NEW', lvl: 0, tag: 'Common', buzz: [30], dur: 0.5, foil: 0, scratchNeed: 0.28 },
  reverse: { glow: tierColor.reverse, chip: 'REVERSE', lvl: 1, tag: 'Reverse holo', buzz: [40, 60, 40], dur: 0.6, foil: 0, scratchNeed: 0.34 },
  holo: { glow: tierColor.holo, chip: 'HOLO', lvl: 2, tag: 'Holo rare', buzz: [60, 80, 120], dur: 0.9, foil: 0.75, scratchNeed: 0.42 },
  ultra: { glow: tierColor.ultra, chip: 'ULTRA', lvl: 3, tag: 'Ultra rare', buzz: [80, 60, 80, 60, 200], dur: 1.4, foil: 0.9, scratchNeed: 0.5 },
  graded: { glow: tierColor.graded, chip: 'GRADED', lvl: 4, tag: 'Graded slab', buzz: [120, 80, 120, 80, 120, 80, 400], dur: 2, foil: 1, scratchNeed: 0.55 },
};

/** `#RRGGBB` → 40 % alpha glow, as the design's hexGlow. */
export const hexGlow = (hex: string) => (hex === '#ffffff' ? 'rgba(255,255,255,0.4)' : hex.startsWith('#') ? `${hex}66` : 'rgba(255,255,255,0.12)');

/** Play a Web-Vibration-style pattern (on, off, on, …) as a sequence of impacts, heavier for longer beats. */
export function playPattern(pattern: number[]) {
  let t = 0;
  pattern.forEach((ms, i) => {
    if (i % 2 === 0) {
      const style = ms >= 150 ? Haptics.ImpactFeedbackStyle.Heavy : ms >= 60 ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light;
      setTimeout(() => { void Haptics.impactAsync(style); }, t);
    }
    t += ms;
  });
}
