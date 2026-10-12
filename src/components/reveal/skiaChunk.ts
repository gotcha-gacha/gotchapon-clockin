// Everything Skia on the web, as ONE async chunk (W3.5, #142). Only ever reached through `import('./skiaChunk')`, from
// skiaWeb.web.ts (to load CanvasKit) and from the two lazy parts (ScratchCapsule.web.tsx, Foil.web.tsx).
//
// Why one module. Each separate `import()` became its own chunk, and Metro hoists the code two chunks share into `__common`,
// which the page loads WITH the entry: when the loader, the capsule and the foil were three imports, all of Skia's JS (506 KB,
// react-reconciler included) arrived on the sign-in screen of every visitor, phone or not. In one chunk nothing is shared.
//
// Why `require` for the parts. Skia's web entry builds its `Skia` object from `global.CanvasKit` when it is EVALUATED
// (skiaWeb.web.ts has the long form), so the parts must not run before `LoadSkiaWeb` has finished. Metro evaluates a module on
// its first `require`, and this chunk's `require` is only called by the lazy parts, which only render once CanvasKit is ready.
export { LoadSkiaWeb } from '@shopify/react-native-skia/lib/module/web';

// eslint-disable-next-line @typescript-eslint/no-require-imports
export const skiaParts = (): typeof import('./skiaParts') => require('./skiaParts');
