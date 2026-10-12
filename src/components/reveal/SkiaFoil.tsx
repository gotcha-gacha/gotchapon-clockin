// Tilt-reactive foil (design "Foil": rainbow bands driven by tilt + time, specular streak, sparkle
// noise; intensity 0 / 0 / .75 / .9 / 1 by tier). Ported from the handoff scaffold's HoloCard shader.
// Tilt comes from the gyroscope; the simulator has none, so the bands still drift with time.
//
// This file imports Skia, so on the web it may only be loaded once CanvasKit is (W0.2d, #138): native reaches it through
// Foil.tsx, the web through Foil.web.tsx (no foil until CanvasKit is ready, which is the design's own "no foil" fallback).
import React, { useEffect } from 'react';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { watchTilt } from '@/sensors/motion';
import { useDerivedValue, useFrameCallback, useReducedMotion, useSharedValue } from 'react-native-reanimated';

// Compiled on first use, not at import: every screen imports this file through the Pull page. A shader that
// fails to compile must degrade to "no foil", not crash the reveal: native Skia throws (only CanvasKit returns
// null), so the failure is caught and cached as null — it is not retried every render.
let foilEffect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;
const foil = () => {
  if (foilEffect === undefined) {
    try { foilEffect = Skia.RuntimeEffect.Make(FOIL_SKSL); } catch { foilEffect = null; }
  }
  return foilEffect;
};
const FOIL_SKSL = `
uniform float2 res; uniform float2 tilt; uniform float time; uniform float lvl;
float h(float2 p){ return fract(sin(dot(p, float2(127.1,311.7))) * 43758.5453); }
half3 rb(float x){ return half3(0.5 + 0.5 * cos(6.2832 * (x + float3(0.0, 0.33, 0.67)))); }
half4 main(float2 xy){
  float2 uv = xy / res;
  float ang = uv.x * 0.8 + uv.y * 0.6;
  float band = sin((ang + tilt.x * 1.4 + tilt.y * 0.9) * 14.0 + time * 0.3);
  half3 c = rb(band * 0.18 + tilt.x * 0.5 + uv.y * 0.3);
  float spec = pow(max(0.0, 1.0 - abs(uv.x - 0.5 - tilt.x * 0.6 + (uv.y - 0.5) * 0.4) * 2.4), 3.0);
  float g = h(floor(uv * 160.0));
  float spark = step(0.985, g) * pow(max(0.0, sin(time * 6.0 + g * 60.0 + tilt.x * 10.0)), 8.0);
  float a = (0.35 + 0.4 * spec) * lvl;
  return half4(c * a + half3(spec * 0.5 + spark * 1.5), a + spec * 0.4 + spark);
}`;

/** `still`: one fixed frame, tilted as if held (F2.11's share card). A capture freezes a frame anyway, so it takes no
 *  gyroscope and no frame callback — the reveal's own foil keeps both. */
export function SkiaFoil({ width, height, intensity, radius = 16, still = false }: { width: number; height: number; intensity: number; radius?: number; still?: boolean }) {
  const tx = useSharedValue(still ? 0.35 : 0), ty = useSharedValue(still ? -0.15 : 0), time = useSharedValue(0);
  const effect = intensity > 0 ? foil() : null;
  const drawing = Boolean(effect); // no tier foil, or no compiled shader: no sensor and no frame work
  const live = drawing && !still;
  useEffect(() => {
    if (!live) return;
    const sub = watchTilt(({ x, y }) => {
      tx.set(Math.max(-1, Math.min(1, tx.get() * 0.92 + y * 0.08)));
      ty.set(Math.max(-1, Math.min(1, ty.get() * 0.92 + x * 0.08)));
    });
    return () => sub.remove();
  }, [live, tx, ty]);
  // Seconds since the reveal started, not since boot: a float32 uniform holding days of uptime quantises and stutters.
  // Reduced motion (the system setting, F6.2): the foil holds still; tilting the phone still moves it.
  const reduced = useReducedMotion();
  useFrameCallback((f) => { 'worklet'; time.set(f.timeSinceFirstFrame / 1000); }, live && !reduced);
  const uniforms = useDerivedValue(() => ({ res: [width, height], tilt: [tx.get(), ty.get()], time: time.get(), lvl: intensity }));
  if (!effect) return null;
  return (
    <Canvas style={{ position: 'absolute', left: 0, top: 0, width, height, borderRadius: radius }} pointerEvents="none">
      <Fill><Shader source={effect} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}
