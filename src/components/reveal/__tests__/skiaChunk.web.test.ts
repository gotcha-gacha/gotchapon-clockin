/**
 * The Skia chunk's order (W3.5, #142). Skia's web entry builds its `Skia` object from `global.CanvasKit` when it is EVALUATED, so
 * loading the chunk (which CanvasKit's loader does first) must evaluate nothing Skia draws with: only `skiaParts()` may, and
 * only the lazy capsule and foil call it, once CanvasKit is ready. Evaluated early, the parts would hold a broken `Skia` and
 * every capsule would quietly fall back to the tap one (PR #170's review saw exactly that in a browser, with 0 page errors).
 */
import { expect, jest, test } from '@jest/globals';

const mockParts = { evaluated: 0 };
jest.mock('../skiaParts', () => { mockParts.evaluated++; return { SkiaFoil: () => null, SkiaScratchCapsule: () => null }; });
jest.mock('@shopify/react-native-skia/lib/module/web', () => ({ LoadSkiaWeb: async () => {} }));

test('loading the Skia chunk evaluates none of the parts; skiaParts() does, once', async () => {
  const chunk = await import('../skiaChunk');
  expect(typeof chunk.LoadSkiaWeb).toBe('function'); // the chunk really loaded
  expect(mockParts.evaluated).toBe(0);
  const parts = chunk.skiaParts();
  expect(typeof parts.SkiaScratchCapsule).toBe('function');
  chunk.skiaParts();
  expect(mockParts.evaluated).toBe(1);
});
