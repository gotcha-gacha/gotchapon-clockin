// The tier foil on the web (W0.2d, #138): nothing until CanvasKit is ready, which is the design's own "no foil" fallback, then
// the Skia shader, imported dynamically (see skiaWeb.web.ts for why no Skia import may be static here). Decided when the card
// mounts; a foil that throws while rendering is dropped, never the card.
import React, { Suspense, useState } from 'react';
import { skiaWebState } from './skiaWeb';

type Props = { width: number; height: number; intensity: number; radius?: number; still?: boolean };
const LazySkiaFoil = React.lazy(async () => ({ default: (await import('./skiaChunk')).skiaParts().SkiaFoil }));

class NoFoilOnError extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

export function Foil(props: Props) {
  const [skia] = useState(() => skiaWebState() === 'ready');
  if (!skia || props.intensity <= 0) return null;
  return <NoFoilOnError><Suspense fallback={null}><LazySkiaFoil {...props} /></Suspense></NoFoilOnError>;
}
