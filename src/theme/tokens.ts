// Design tokens — design/README.md "Design tokens". Single source; never inline a hex in a screen.
export const color = {
  room: '#0B0E1A',
  roomDeep: '#060812',
  roomMid: '#121A33',
  rimCoral: '#FF6B5B',
  machineRed: '#F2565C',
  machineRedMid: '#D9333B',
  machineRedDeep: '#A81F29',
  cream: '#F1EDE6',
  creamDeep: '#CFC9BF',
  gunmetal: '#2C3148',
  gunmetalDeep: '#171B2B',
  neonCyan: '#5BE0FF',
  goldTrim: '#C9A44C',
  marqueeInk: '#FFE9A3',
  tickerAmber: '#FFB03F',
  // tier
  tierCommon: '#FF9A5B',
  tierReverse: '#8FE3C5',
  tierHolo: '#5BB8FF',
  tierUltra: '#FFD23F',
  tierGraded: '#FF6B5B',
  // text
  text: '#EAF0FF',
  text2: '#9FB0D8',
  text3: '#7487B0',
  inkOnYellow: '#1F2D4D',
  inkOnMint: '#0B1E2A',
  // Gotchapon wordmark (#336). Header caps, and "pon" on a light ground. Dark "Gotcha" is `text`; coral "pon" is `rimCoral`.
  brandHeaderGotcha: '#C9D3EE',
  brandHeaderPon: '#FF8A7A',
  brandPonLight: '#E8443A',
  // action
  yellow: '#FFD23F',
  yellowShadow: '#B8930C',
  mint: '#8FE3C5',
  mintShadow: '#3DAF88',
  danger: '#FF6B5B',
  // glass
  glassBg: 'rgba(18,24,45,0.94)',
  glassBorder: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(255,255,255,0.12)',
} as const;

export const radius = { pill: 99, button: 12, card: 14, cardLg: 18, sheet: 24, machine: 24, cardFrame: 6 } as const;
export const space = { gutter: 16, xs: 8, sm: 10, md: 12, hit: 44 } as const;
export const type = {
  body: 13,
  bodySm: 12,
  label: 11,
  title: 18,
  titleLg: 20,
} as const;

export type Tier = 'common' | 'reverse' | 'holo' | 'ultra' | 'graded';
export const tierColor: Record<Tier, string> = {
  common: color.tierCommon,
  reverse: color.tierReverse,
  holo: color.tierHolo,
  ultra: color.tierUltra,
  graded: color.tierGraded,
};
