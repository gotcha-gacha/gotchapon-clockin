// CanvasKit on the web (W0.2d, #138): a WebAssembly download (about 2.9 MB gzipped by the vendor's number) that Skia on the web
// cannot draw without. It is fetched once, lazily, and never on the way to first paint or sign-in: the Pull page asks for it
// when the browser is idle after it mounts (at most IDLE_START_MS) or at the first turn, whichever is first (W3.5, #142). Until
// it is ready, and for good if it fails (blocked, offline, an old browser), the capsule is the tap-to-open one and cards have
// no foil; nothing waits on it.
//
// Why everything Skia is behind a dynamic import: @shopify/react-native-skia's web entry builds its `Skia` object from
// `global.CanvasKit` AT IMPORT (`Skia.web.js`: `export const Skia = JsiSkApi(global.CanvasKit)`). A static import anywhere in
// the startup graph would evaluate that before CanvasKit exists and leave it broken for the life of the page. So on the web
// SkiaScratchCapsule and SkiaFoil are only ever reached through skiaChunk.ts's `skiaParts()`, after `loadSkiaWeb()` resolved true.
export type SkiaWebState = 'idle' | 'loading' | 'ready' | 'failed';

let state: SkiaWebState = 'idle';
let loading: Promise<boolean> | null = null;

/** Start (or join) the one CanvasKit load. Resolves true when Skia can draw, false when it cannot; never rejects. */
export function loadSkiaWeb(): Promise<boolean> {
  if (loading) return loading;
  state = 'loading';
  loading = fetchWasm()
    .then(async (bytes) => {
      const web = await import('./skiaChunk');
      // The only thing this CanvasKit build reads from its options is `locateFile` (PR #152's review: `wasmBinary` does not
      // occur in canvaskit-wasm 0.41's loader, so handing it the bytes did nothing and it downloaded the 8 MB a second time).
      // So it is pointed at the bytes already here: one download, nothing kept once it has compiled them.
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
      try { await web.LoadSkiaWeb({ locateFile: () => url }); } finally { URL.revokeObjectURL(url); }
    })
    .then(() => { state = 'ready'; return true; }, () => { state = 'failed'; return false; });
  return loading;
}

const WASM_MAGIC = 0x0061736d; // "\0asm"

/** public/canvaskit.wasm, copied there by `pnpm skia:web`. Fetched and looked at here rather than left to CanvasKit's own
 *  loader: when that cannot get the file (blocked, offline, a 404), or gets something that is not WebAssembly (a captive
 *  portal's page, a CDN's error body with a 200), its runtime aborts with an unhandled rejection nobody can catch, which is a
 *  page error on the way to a paid pull's capsule (seen 17 Sept; the 200-with-garbage case by PR #152's review). Anything wrong
 *  here is just "no Skia". The absolute path matters too: CanvasKit's own default is relative to the page, a 404 on any deep route. */
async function fetchWasm(): Promise<ArrayBuffer> {
  const res = await fetch('/canvaskit.wasm');
  if (!res.ok) throw new Error(`canvaskit.wasm: ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (new DataView(bytes).getUint32(0) !== WASM_MAGIC) throw new Error('canvaskit.wasm: not WebAssembly'); // a body under 4 bytes throws here by itself: the same "no Skia"
  return bytes;
}

/** How long an idle callback may wait before it runs anyway, and the plain delay where the browser has none (Safari). */
export const IDLE_START_MS = 2000;

/** Start the load once the page has nothing better to do (W3.5, #142): the Pull page asks at mount, so the machine is on screen
 *  and working first and the 8 MB (3.2 MB on the wire) does not compete with it, and a capsule is still a crank turn and a
 *  commit away. At most IDLE_START_MS late. Returns the cancel for a page that goes away first; joining a load is free. */
export function loadSkiaWebWhenIdle(): () => void {
  if (loading) return () => {};
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function' && typeof w.cancelIdleCallback === 'function') {
    const id = w.requestIdleCallback(() => { void loadSkiaWeb(); }, { timeout: IDLE_START_MS });
    return () => w.cancelIdleCallback!(id);
  }
  const t = setTimeout(() => { void loadSkiaWeb(); }, IDLE_START_MS);
  return () => clearTimeout(t);
}

export function skiaWebState(): SkiaWebState { return state; }

/** Tests only: a fresh page. */
export function resetSkiaWebForTests(): void { state = 'idle'; loading = null; }
