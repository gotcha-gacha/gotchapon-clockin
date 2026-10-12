// CanvasKit on the web (W0.2d, #138). Native has Skia built in: nothing to load, always ready.
export type SkiaWebState = 'idle' | 'loading' | 'ready' | 'failed';
/** Start loading CanvasKit (web). Native: nothing to do. */
export function loadSkiaWeb(): Promise<boolean> { return Promise.resolve(true); }
/** Start loading CanvasKit when the page is idle (web). Native: nothing to do. */
export function loadSkiaWebWhenIdle(): () => void { return () => {}; }
export function skiaWebState(): SkiaWebState { return 'ready'; }
