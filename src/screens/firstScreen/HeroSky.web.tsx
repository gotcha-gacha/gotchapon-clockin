// The first screen's motion world in a browser (#211): the design pack's own 2D canvas, ported from the v4 canvas's draw
// loop — the night gradient, a coral bloom pulsing at 1.3 Hz, two light sweeps turning in opposite directions, particles
// drifting up, film grain and the vignette.
//
// A real `<canvas>`, not Skia: Skia on the web is an 8 MB WebAssembly download that the first screen must never wait for
// (CLAUDE.md), and this is 2D work a browser has done natively for fifteen years. Reduced motion draws no loop at all — it
// renders the still poster instead, which is the same picture a phone falls back to.
//
// The three things the pack learned the hard way and this keeps: a canvas that measures 0×0 at first (its box arrives a
// frame later) refits rather than giving up; a loop killed by a backgrounded tab is restarted by a watchdog and by
// `visibilitychange`; and the canvas is inset so the parallax in slice C can never drag its edge into view.
//
// Phone browsers were redrawing this full-viewport, at devicePixelRatio 2, every frame: a layout read, five full-canvas
// fills, film grain, and 48 dots. That is the cold open of gotchapon.fun. A phone paints a cached sky, skips the grain,
// thins the dots, and steps at 30fps. A hidden tab or the auth sheet stops the loop; the watchdog must not restart it
// while the tab is hidden (rAF is already paused, and kicking it again fights the browser).
import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { StillSky } from '@/screens/firstScreen/StillSky';
import { phoneClassWeb } from '@/web/phoneWeb';

const FULL_PARTICLES = 48;
const CALM_PARTICLES = 22;
/** Phone: the calm count even on a first visit, and fewer still once this device has been onboarded. */
const PHONE_PARTICLES = 22;
const PHONE_CALM_PARTICLES = 12;
/** The pack's `calm`: fewer particles and time itself at 0.6×, for a collector who has seen the app before. */
const CALM_TIME = 0.6;
const NOISE = 128;
const WATCHDOG_MS = 350;
const STALE_MS = 400;
/** ~30fps. The bloom is 1.3 Hz; a phone does not need a new sky 60 times a second. */
const PHONE_FRAME_MS = 32;

type Particle = { x: number; y: number; s: number; v: number; p: number; c: number };
const COLOURS = ['255,210,63', '255,107,91', '143,227,197'];

export function HeroSky({ reduced, calm, tilt, paused = false }: { reduced: boolean; calm: boolean; tilt: { x: SharedValue<number>; y: SharedValue<number> }; paused?: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  // The sky slides the other way from the hero, which is what makes the hero look nearer (the pack's ∓5 px, ∓3 px at 1.04).
  // The canvas is inset by 12 px on every side, so this can never drag an edge into the frame.
  const drift = useAnimatedStyle(() => ({
    transform: [{ translateX: tilt.x.get() * -10 }, { translateY: tilt.y.get() * -6 }, { scale: 1.04 }],
  }));

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || reduced || paused) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return; // a browser that will not give a 2d context keeps the poster under this canvas
    const lite = phoneClassWeb();
    const dpr = lite ? 1 : Math.min(2, window.devicePixelRatio || 1);
    const wedges = lite ? 2 : 4;

    const fit = () => {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
    };

    // One grey noise tile, re-offset every frame on a desktop. A phone skips it: the pattern fill is a full-canvas
    // composite and the grain is invisible on a handset.
    let nctx: CanvasRenderingContext2D | null = null;
    if (!lite) {
      const noise = document.createElement('canvas');
      noise.width = noise.height = NOISE;
      nctx = noise.getContext('2d');
      if (nctx) {
        const img = nctx.createImageData(NOISE, NOISE);
        for (let i = 0; i < img.data.length; i += 4) {
          const v = Math.random() * 255;
          img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
          img.data[i + 3] = 255;
        }
        nctx.putImageData(img, 0, 0);
      }
    }

    const count = lite ? (calm ? PHONE_CALM_PARTICLES : PHONE_PARTICLES) : (calm ? CALM_PARTICLES : FULL_PARTICLES);
    const pts: Particle[] = Array.from({ length: count }, (_, i) => ({
      x: Math.random(), y: Math.random(), s: 0.6 + Math.random() * 1.8,
      v: (0.00025 + Math.random() * 0.0006) * (calm ? CALM_TIME : 1),
      p: Math.random() * Math.PI * 2, c: i % 3,
    }));

    // Sky and vignette do not move. A phone blits them instead of rebuilding the gradients every frame.
    let skyLayer: HTMLCanvasElement | null = null;
    let vignetteLayer: HTMLCanvasElement | null = null;
    const cacheStill = (W: number, H: number) => {
      if (skyLayer && skyLayer.width === W && skyLayer.height === H) return;
      skyLayer = document.createElement('canvas');
      skyLayer.width = W;
      skyLayer.height = H;
      const skyCtx = skyLayer.getContext('2d');
      if (skyCtx) {
        const sky = skyCtx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0B1024');
        sky.addColorStop(0.55, '#080B1A');
        sky.addColorStop(1, '#05070F');
        skyCtx.fillStyle = sky;
        skyCtx.fillRect(0, 0, W, H);
      }
      vignetteLayer = document.createElement('canvas');
      vignetteLayer.width = W;
      vignetteLayer.height = H;
      const vigCtx = vignetteLayer.getContext('2d');
      if (vigCtx) {
        const vignette = vigCtx.createRadialGradient(W / 2, H * 0.5, H * 0.25, W / 2, H * 0.5, H * 0.85);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(3,5,12,0.85)');
        vigCtx.fillStyle = vignette;
        vigCtx.fillRect(0, 0, W, H);
      }
    };

    let raf = 0;
    let last = 0;
    let sized = false;
    const t0 = performance.now();

    const ensureSize = () => {
      if (sized && canvas.width) return true;
      const box = canvas.getBoundingClientRect();
      if (!canvas.width || Math.abs(canvas.width - box.width * dpr) > 2 || Math.abs(canvas.height - box.height * dpr) > 2) fit();
      sized = canvas.width > 0;
      return sized;
    };

    const draw = (now: number) => {
      // A backgrounded tab already drops rAF. Returning without scheduling leaves the loop dead until the tab is back;
      // the watchdog used to start it again while hidden.
      if (document.visibilityState === 'hidden') return;
      if (lite && last && now - last < PHONE_FRAME_MS) { raf = requestAnimationFrame(draw); return; }
      if (!ensureSize()) { raf = requestAnimationFrame(draw); return; }
      const W = canvas.width, H = canvas.height;
      const t = ((now - t0) / 1000) * (calm ? CALM_TIME : 1);
      const cx = W / 2, cy = H * 0.42;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.3);

      if (lite) {
        cacheStill(W, H);
        ctx.clearRect(0, 0, W, H);
        if (skyLayer) ctx.drawImage(skyLayer, 0, 0);
      } else {
        ctx.clearRect(0, 0, W, H);
        const sky = ctx.createLinearGradient(0, 0, 0, H);
        sky.addColorStop(0, '#0B1024');
        sky.addColorStop(0.55, '#080B1A');
        sky.addColorStop(1, '#05070F');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);
      }

      const bloom = ctx.createRadialGradient(cx, cy, 0, cx, cy, W * 0.62);
      bloom.addColorStop(0, `rgba(255,107,91,${0.22 + 0.14 * pulse})`);
      bloom.addColorStop(0.45, `rgba(255,170,60,${0.07 + 0.05 * pulse})`);
      bloom.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = bloom;
      ctx.fillRect(0, 0, W, H);

      // Two sweeps, each nested wedges so its edges are soft without a blur filter. A phone uses two wedges, not four.
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < 2; k++) {
        const a = t * (k ? -0.35 : 0.5) + k * 2.1;
        const sx = cx + Math.cos(a) * W * 0.55, sy = cy + Math.sin(a) * H * 0.35;
        const sweep = ctx.createLinearGradient(cx, cy, sx, sy);
        sweep.addColorStop(0, 'rgba(0,0,0,0)');
        sweep.addColorStop(0.6, k ? 'rgba(143,227,197,0.10)' : 'rgba(255,210,63,0.12)');
        sweep.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = sweep;
        ctx.globalAlpha = 0.3;
        for (let j = 0; j < wedges; j++) {
          const w = 0.14 + j * 0.11;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, W * 0.95, a - w, a + w);
          ctx.closePath();
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of pts) {
        p.y -= p.v;
        p.x += Math.sin(t * 0.7 + p.p) * 0.0004;
        if (p.y < -0.05) { p.y = 1.05; p.x = Math.random(); }
        const r = p.s * dpr * (1 + 0.4 * Math.sin(t * 2 + p.p));
        ctx.fillStyle = `rgba(${COLOURS[p.c]},${0.35 + 0.2 * Math.sin(t * 1.5 + p.p) + 0.2})`;
        ctx.beginPath();
        ctx.arc(p.x * W, p.y * H, r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (nctx) {
        ctx.save();
        ctx.globalAlpha = 0.07;
        ctx.globalCompositeOperation = 'overlay';
        const pattern = ctx.createPattern(nctx.canvas, 'repeat');
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.translate(Math.random() * NOISE, Math.random() * NOISE);
          ctx.fillRect(-NOISE, -NOISE, W + NOISE * 2, H + NOISE * 2);
        }
        ctx.restore();
      }

      if (lite && vignetteLayer) {
        ctx.drawImage(vignetteLayer, 0, 0);
      } else {
        ctx.save();
        const vignette = ctx.createRadialGradient(cx, H * 0.5, H * 0.25, cx, H * 0.5, H * 0.85);
        vignette.addColorStop(0, 'rgba(0,0,0,0)');
        vignette.addColorStop(1, 'rgba(3,5,12,0.85)');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
      }

      last = now;
      raf = requestAnimationFrame(draw);
    };

    const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); };
    kick();

    // A tab that was backgrounded comes back with its loop dead: both of these start it again, and neither runs while hidden.
    const watchdog = setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (!canvas.width || !last || performance.now() - last > STALE_MS) kick();
    }, WATCHDOG_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') kick(); };
    document.addEventListener('visibilitychange', onVisible);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { sized = false; }) : null;
    observer?.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(watchdog);
      document.removeEventListener('visibilitychange', onVisible);
      observer?.disconnect();
    };
  }, [reduced, calm, paused]);

  // The poster stays under the canvas: it is what shows while the first frame is still coming, and all there is under
  // reduced motion or without a 2D context.
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="hero-sky">
      <StillSky />
      {reduced ? null : (
        <Animated.View style={[StyleSheet.absoluteFill, drift]} pointerEvents="none">
          <canvas ref={ref} style={CANVAS_STYLE} data-testid="sky-canvas" />
        </Animated.View>
      )}
    </View>
  );
}

/** Inset by 12 px on every side, so the parallax that slice C gives it can never drag an edge into the frame. */
const CANVAS_STYLE: React.CSSProperties = {
  position: 'absolute', left: -12, top: -12, width: 'calc(100% + 24px)', height: 'calc(100% + 24px)',
  pointerEvents: 'none',
};
