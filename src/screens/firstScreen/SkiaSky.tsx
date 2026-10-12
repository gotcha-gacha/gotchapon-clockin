// The first screen's motion world on a phone (#211), as one Skia shader: the night gradient, the coral bloom pulsing at
// 1.3 Hz, two light sweeps turning against each other, particles drifting up, film grain and the vignette — everything the
// pack's 2D canvas draws, in a single pass instead of fifty.
//
// This file imports Skia, so it is native-only: the web reaches its own canvas through `HeroSky.web.tsx` and never loads
// this (CLAUDE.md — a static Skia import on the web pins a broken `Skia` for the life of the page, and the bundle budget
// fails the export if it ever appears there).
//
// Compiled on first use and cached, failure included, exactly as the foil's shader is: native Skia throws where CanvasKit
// returns null, and a first screen that cannot compile a shader must fall back to the still poster, not crash the app.
import React from 'react';
import { StyleSheet } from 'react-native';
import { Canvas, Fill, Shader, Skia } from '@shopify/react-native-skia';
import { useDerivedValue, useFrameCallback, useSharedValue } from 'react-native-reanimated';

const SKY_SKSL = `
uniform float2 res; uniform float time; uniform float calm;

float hash(float2 p){ return fract(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
// How far apart two directions are, in radians and never more than pi: the sin/cos round trip does the wrapping, so a
// sweep at 0.05 rad and a pixel at 6.24 read as neighbours instead of a whole turn apart.
float angleTo(float a, float b){ return abs(atan(sin(a - b), cos(a - b))); }

half4 main(float2 xy) {
  float2 uv = xy / res;
  // Distances in units of WIDTH, the way the pack's canvas measures its bloom and its sweeps.
  float2 d = (xy - float2(res.x * 0.5, res.y * 0.42)) / res.x;
  float r = length(d);

  half3 col = mix(half3(0.043, 0.063, 0.141), half3(0.031, 0.043, 0.102), smoothstep(0.0, 0.55, uv.y));
  col = mix(col, half3(0.020, 0.027, 0.059), smoothstep(0.55, 1.0, uv.y));

  float pulse = 0.5 + 0.5 * sin(time * 1.3);
  float coral = 1.0 - smoothstep(0.0, 0.62, r);
  col += half3(1.0, 0.420, 0.357) * (0.22 + 0.14 * pulse) * coral * coral;
  col += half3(1.0, 0.667, 0.235) * (0.07 + 0.05 * pulse) * (1.0 - smoothstep(0.0, 0.45, r));

  float ang = atan(d.y, d.x);
  float reach = 1.0 - smoothstep(0.0, 0.95, r);
  float gold = (1.0 - smoothstep(0.0, 0.47, angleTo(ang, time * 0.5))) * reach;
  float mint = (1.0 - smoothstep(0.0, 0.47, angleTo(ang, time * -0.35 + 2.1))) * reach;
  col += half3(1.0, 0.824, 0.247) * gold * 0.12;
  col += half3(0.561, 0.890, 0.773) * mint * 0.10;

  // One particle per cell of a 6 × 8 grid: 48 of them, and every pixel only ever looks at its own.
  float2 g = float2(6.0, 8.0);
  float2 cell = floor(uv * g);
  float2 f = fract(uv * g);
  float h1 = hash(cell), h2 = hash(cell + 17.3), h3 = hash(cell + 39.1);
  float alive = step(calm * 0.55, h3); // calm thins them to about 22, as the pack's does
  float speed = (0.05 + h2 * 0.13) * (1.0 - calm * 0.4);
  float2 home = float2(0.2 + 0.6 * h3, fract(h1 - time * speed));
  float dist = length((f - home) * (res / g)); // in pixels, so the dot is round whatever the cell's shape
  float radius = 0.8 + 1.6 * h2;
  float twinkle = 0.45 + 0.35 * sin(time * 1.5 + h1 * 6.2832);
  half3 spark = h3 < 0.33 ? half3(1.0, 0.824, 0.247) : (h3 < 0.66 ? half3(1.0, 0.420, 0.357) : half3(0.561, 0.890, 0.773));
  col += spark * (1.0 - smoothstep(0.0, radius, dist)) * twinkle * alive;

  col += (hash(floor(xy) + floor(time * 60.0)) - 0.5) * 0.07; // grain, re-offset every frame

  float vignette = smoothstep(0.25, 0.85, length((xy - res * 0.5) / res.y)) * 0.85;
  col = mix(col, half3(0.012, 0.020, 0.047), vignette);

  return half4(col, 1.0);
}`;

let compiled: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;
function skyShader() {
  if (compiled === undefined) {
    try { compiled = Skia.RuntimeEffect.Make(SKY_SKSL); } catch { compiled = null; }
  }
  return compiled;
}

/** For tests: forget the cached compile, so one file can cover both the shader that works and the one that does not.
 *  (`jest.resetModules()` cannot: re-requiring this file hands the test a second React, whose dispatcher is null.) */
export function resetSkyShaderForTests() { compiled = undefined; }

/** Null when the shader will not compile, which leaves the still poster underneath showing — the design's own fallback. */
export function SkiaSky({ width, height, calm }: { width: number; height: number; calm: boolean }) {
  const effect = skyShader();
  const time = useSharedValue(0);
  // Seconds since this screen's first frame, never since boot: a float32 uniform holding days of uptime quantises.
  useFrameCallback((frame) => { 'worklet'; time.set(frame.timeSinceFirstFrame / 1000); }, !!effect);
  const uniforms = useDerivedValue(() => ({ res: [width, height], time: time.get(), calm: calm ? 1 : 0 }));
  if (!effect) return null;
  return (
    <Canvas style={StyleSheet.absoluteFill} pointerEvents="none" testID="sky-canvas">
      <Fill><Shader source={effect} uniforms={uniforms} /></Fill>
    </Canvas>
  );
}
