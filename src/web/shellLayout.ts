// The arcade shell's arithmetic (W1.1, #123), lifted from the design canvas (`design/Web Arcade.dc.html`) and then
// adjusted so the play surface survives a window the canvas was not drawn at (#325).
//
// The canvas sizes the cabinet as min(available height / 1000, available width / 466, 1) and floors that at 0.32.
// On a laptop it also reserves 250px under the cabinet for the marketing copy before it measures. At a common
// 1024×768 window that left the machine about 160px wide, and on a short window the 0.32 floor made the stage
// taller than the viewport: the shell clips overflow, the cabinet scales from its top, and the crank and tray
// were the part that disappeared. The cabinet now fits the viewport. The copy column is drawn only in space
// the fitted cabinet does not need (beside it on a desktop, under it on a tall laptop).
// Pure: no DOM, no React.
export type Tier = 'mobile' | 'tablet' | 'laptop' | 'desktop';

/** The cabinet as drawn, and the screen cut into it: the app always renders at SCREEN size and the whole cabinet is scaled. */
export const CABINET = { width: 466, height: 1000 } as const;
export const SCREEN = { left: 38, top: 70, width: 390, height: 844, radius: 20 } as const;
export const FOOTER_H = 44;

/** Vertical padding of the grid, which is also the height the scale formula subtracts. One source, so the stage cannot be a pixel taller than the window. */
const PAD = {
  desktop: { top: 40, x: 40, bottom: 84 },
  laptop: { top: 30, x: 24, bottom: 74 },
  tablet: { top: 24, x: 24, bottom: 68 },
} as const;

const LAPTOP_GAP = 28;
/** A copy band under a full-size cabinet. Shorter than this, the column is hidden and the machine keeps the height. */
const LAPTOP_COPY_MIN = 120;

export const tierOf = (vw: number): Tier => (vw < 768 ? 'mobile' : vw < 1024 ? 'tablet' : vw < 1280 ? 'laptop' : 'desktop');

const chromeOf = (tier: Exclude<Tier, 'mobile'>): number => PAD[tier].top + PAD[tier].bottom;

/**
 * min(available height / 1000, available width / 466, 1), to three places.
 * No floor: a short window gets a smaller whole machine, never a cropped one.
 */
export function cabinetScale(vw: number, vh: number): number {
  const tier = tierOf(vw);
  if (tier === 'mobile') return 1;
  const availH = vh - chromeOf(tier);
  const availW = tier === 'desktop' ? Math.min(vw * 0.5, 620) : vw - 80;
  const s = Math.min(availH / CABINET.height, availW / CABINET.width, 1);
  return Math.max(0, Math.round(s * 1000) / 1000);
}

/** Height left under a fitted laptop cabinet, after the grid's padding. The gap comes out of this when the copy is shown. */
function laptopRoom(vh: number, scale: number): number {
  return vh - Math.round(CABINET.height * scale) - chromeOf('laptop');
}

export type ShellLayout = {
  tier: Tier; scale: number; stageW: number; stageH: number;
  cols: string; rows: string; gap: number; pagePad: string;
  /** Copy column: not at all (mobile, tablet, a laptop with no room under the cabinet), under the cabinet (tall laptop), to its right (desktop). */
  copy: 'none' | 'below' | 'right';
  roomOpacity: number; dust: boolean; footer: boolean;
};

export function shellLayout(vw: number, vh: number): ShellLayout {
  const tier = tierOf(vw); const scale = cabinetScale(vw, vh);
  const desk = tier === 'desktop', lap = tier === 'laptop', tab = tier === 'tablet';
  // The copy sits under the cabinet only once the cabinet is already as large as it gets (scale 1) and a band remains.
  // Reserving that band first is what used to shrink the machine on every laptop-height window.
  const copyBelow = lap && laptopRoom(vh, scale) >= LAPTOP_GAP + LAPTOP_COPY_MIN;
  const pad = tier === 'mobile' ? null : PAD[tier];
  return {
    tier, scale, stageW: Math.round(CABINET.width * scale), stageH: Math.round(CABINET.height * scale),
    cols: desk ? 'minmax(0,1fr) auto minmax(0,1fr)' : 'minmax(0,1fr)',
    rows: copyBelow ? 'auto minmax(0,250px)' : '1fr',
    gap: desk ? 48 : copyBelow ? LAPTOP_GAP : 0,
    pagePad: pad ? `${pad.top}px ${pad.x}px ${pad.bottom}px` : '0',
    copy: desk ? 'right' : copyBelow ? 'below' : 'none',
    roomOpacity: tab ? 0.35 : 0.6, dust: !tab && tier !== 'mobile', footer: tier !== 'mobile',
  };
}

/** The box the shell fills. The visual viewport, when the browser has one, so mobile chrome does not cover the rail. */
export function viewportBox(win: {
  innerWidth: number; innerHeight: number;
  visualViewport?: { width: number; height: number; offsetTop: number; offsetLeft: number } | null;
}): { w: number; h: number; top: number; left: number } {
  const vv = win.visualViewport;
  if (vv && vv.width > 0 && vv.height > 0) return { w: vv.width, h: vv.height, top: vv.offsetTop || 0, left: vv.offsetLeft || 0 };
  return { w: win.innerWidth, h: win.innerHeight, top: 0, left: 0 };
}
