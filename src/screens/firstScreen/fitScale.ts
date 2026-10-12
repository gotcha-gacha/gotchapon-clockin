// How the first screen's in-flow column fits the dark panel (#325). Pure: no DOM, no React.
//
// The panel clips (`overflow: hidden`). A column that is already inside it stays at 1. One that is taller
// scales down from the top, so the call to action stays on the panel instead of opening a scrollbar.

/** 1px of subpixel rounding is not overflow. More than that, the column is actually taller than the panel. */
const SLOP = 1;

/**
 * Scale that fits `content` into `panel`. 1 when it already fits, or when either side has not been measured.
 * Floored to three places so rounding never leaves the column a fraction past the clip.
 */
export function fitScale(panel: number, content: number): number {
  if (!(panel > 0) || !(content > 0) || content <= panel + SLOP) return 1;
  return Math.floor((panel / content) * 1000) / 1000;
}

/** The column's in-flow height: its children's border boxes. The sky is not one of them. */
export function columnHeight(children: readonly { offsetHeight: number }[]): number {
  let h = 0;
  for (const child of children) h += child.offsetHeight;
  return h;
}
