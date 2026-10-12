// The first screen's column, scaled to the dark panel on the web (#325).
//
// The panel is `overflow: hidden`, so it never grows a scrollbar. The viewport is the clip; the column is what
// scales. Measuring the column's own box would chase itself once a height is applied, so the panel height is the
// viewport's and the content height is the brand, the stage and the copy — the sky is not one of them, and its
// 12px canvas inset must not count or the column would shrink on every screen.
import { useLayoutEffect, useState, type RefObject } from 'react';
import type { View } from 'react-native';
import { columnHeight, fitScale } from '@/screens/firstScreen/fitScale';

export type Fit = { scale: number; content: number };

const FITS: Fit = { scale: 1, content: 0 };

function host(ref: RefObject<View | null>): HTMLElement | null {
  const n = ref.current as unknown as HTMLElement | null;
  if (!n || typeof n.clientHeight !== 'number') return null;
  return n;
}

export function useFitScale(viewportRef: RefObject<View | null>, columnRef: RefObject<View | null>): Fit {
  const [fit, setFit] = useState<Fit>(FITS);
  useLayoutEffect(() => {
    const viewport = host(viewportRef);
    const column = host(columnRef);
    if (!viewport || !column) return;
    const measure = () => {
      const content = columnHeight(Array.from(column.children) as HTMLElement[]);
      const scale = fitScale(viewport.clientHeight, content);
      setFit((prev) => (prev.scale === scale && prev.content === content ? prev : { scale, content }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(column);
    for (const child of Array.from(column.children)) ro.observe(child);
    return () => ro.disconnect();
  }, [viewportRef, columnRef]);
  return fit;
}
