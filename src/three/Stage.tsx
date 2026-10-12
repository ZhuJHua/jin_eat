/**
 * The 3D stage (lazy chunk). Owns the R3F <Canvas frameloop="never"> driven by the
 * master loop (engine/loop), adaptive quality (initial DPR + perf governor), WebGL context-loss
 * recovery, the shader warm-up behind the poster/gate, and the lazy Post / PhysicsLayer chunks.
 */
import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, advance, useThree, type RootState } from '@react-three/fiber';
import { ACESFilmicToneMapping, HalfFloatType, WebGLRenderTarget } from 'three';
import type { QualityTier } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { bus, EMPTY } from '@/lib/bus';
import { createPerfGovernor, initialDprFor, isMobileDevice, tierParams, type PerfGovernor } from '@/lib/quality';
import { markStageReady } from '@/lib/webgl';
import { onFrameTime, registerRenderer } from '@/engine/loop';
import { getState, useStore } from '@/state/store';
import { rt } from '@/state/runtime';
import { debugStats } from '@/ui/intent';
import { Scene } from './Scene';
import { fontsReady } from './text/canvasText';

const Post = lazy(() => import('./Post'));
const PhysicsLayer = lazy(() => import('./physics/PhysicsLayer'));

/** Phases in which a quality switch (remounting composer / physics) cannot interrupt anything. */
const CALM_PHASES = new Set(['idle', 'reveal', 'gate', 'boot']);
/** Context losses this session (module scope: survives Stage remounts). */
let contextLosses = 0;
const RESTORE_TIMEOUT_MS = 4000;
const SCENE_TEXT = [
  COPY.scene.plaque,
  COPY.scene.plaqueSub,
  COPY.scene.plaqueSubFriday,
  COPY.scene.coupletLeft,
  COPY.scene.coupletRight,
  COPY.scene.cloth,
  COPY.scene.clothMedallion,
  '开炫',
].join('');

/** Registers R3F `advance` with the master loop (seconds clock, clamped delta). */
function LoopBridge() {
  const get = useThree((s) => s.get);
  useEffect(() => {
    // Count every pass of a frame (the composer renders several times), not just the last one.
    get().gl.info.autoReset = false;
    registerRenderer((ts) => {
      const state = get();
      const info = state.gl.info;
      info.reset();
      const t = ts / 1000;
      const clock = state.clock;
      // R3F derives useFrame's delta from elapsedTime in frameloop="never": keep it sane after
      // tab switches / stalls so springs and pendulums never explode.
      if (t - clock.elapsedTime > CFG.loop.maxDt || t < clock.elapsedTime) clock.elapsedTime = t - CFG.loop.maxDt;
      advance(t, true, state);
      // Render stats for the ?debug=1 HUD (DebugHud); plain field writes, no cost when it is unmounted.
      debugStats.calls = info.render.calls;
      debugStats.triangles = info.render.triangles;
      debugStats.textures = info.memory.textures;
      debugStats.geometries = info.memory.geometries;
    });
    return () => registerRenderer(null);
  }, [get]);
  return null;
}

/**
 * Compiles every program (hero, confetti and 掷筊 included, they are mounted but hidden) once the
 * brush font and text textures are ready, so the first draw has no compile hitch. With a composer
 * the scene renders into a half-float target, so compile against one to get matching programs.
 */
function WarmUp({ tier, composerActive, epoch }: { tier: QualityTier; composerActive: boolean; epoch: number }) {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    let cancelled = false;
    const run = async (): Promise<void> => {
      await fontsReady(SCENE_TEXT, 3000);
      // Give lazily built textures (atlas, painted canvases) two loop frames to settle.
      await new Promise((r) => setTimeout(r, 80));
      if (cancelled) return;
      let target: WebGLRenderTarget | null = null;
      try {
        if (composerActive) {
          target = new WebGLRenderTarget(1, 1, { type: HalfFloatType });
          gl.setRenderTarget(target);
        }
        const pending = typeof gl.compileAsync === 'function' ? gl.compileAsync(scene, camera) : null;
        if (!pending) gl.compile(scene, camera);
        gl.setRenderTarget(null);
        if (pending) await pending;
      } catch (err) {
        console.warn('[stage] shader warm-up failed', err);
      } finally {
        gl.setRenderTarget(null);
        target?.dispose();
      }
      if (!cancelled) markStageReady();
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [gl, scene, camera, tier, composerActive, epoch]);
  return null;
}

/**
 * Initial DPR per tier and, for quality 'auto', the perf governor. Governor decisions are applied
 * only in calm phases (never mid-shake or mid-draw) and the governor is not fed while a decision
 * waits, so it cannot pile up steps measured under the old configuration.
 */
function useAdaptiveQuality(isMobile: boolean): void {
  const pref = useStore((s) => s.settings.quality);
  useEffect(() => {
    let gov: PerfGovernor | null = null;
    let pending: { tier: QualityTier; dpr: number } | null = null;
    let applying = false;

    const start = (): void => {
      gov?.dispose();
      gov = null;
      pending = null;
      const s = getState();
      const dpr = initialDprFor(s.tier, isMobile);
      s.setDpr(dpr);
      if (s.settings.quality !== 'auto') return;
      gov = createPerfGovernor({
        isMobile,
        tier: s.tier,
        dpr,
        onChange: (tier, d) => {
          pending = { tier, dpr: d };
          tryApply();
        },
      });
    };

    const tryApply = (): void => {
      const p = pending;
      if (!p) return;
      const s = getState();
      if (!CALM_PHASES.has(s.phase) || rt.input.pointer.grabbing) return;
      pending = null;
      applying = true;
      try {
        s.setTier(p.tier);
        s.setDpr(p.dpr);
      } finally {
        applying = false;
      }
    };

    const offStore = useStore.subscribe((s, prev) => {
      if (s.tier !== prev.tier) {
        bus.emit('quality-changed', { tier: s.tier });
        // A tier change from outside (settings / App) restarts from that tier's initial DPR.
        if (!applying) start();
        return;
      }
      if (pending && s.phase !== prev.phase) tryApply();
    });
    const offFeed = onFrameTime((dtMs, fullRate) => {
      if (gov && !pending) gov.feed(dtMs, fullRate);
    });
    start();
    return () => {
      gov?.dispose();
      offStore();
      offFeed();
    };
  }, [pref, isMobile]);
}

function useContextLoss(onRestored: () => void): (state: RootState) => () => void {
  return useCallback(
    (state: RootState) => {
      const canvas = state.gl.domElement;
      let timer: ReturnType<typeof setTimeout> | null = null;
      const lost = (e: Event): void => {
        e.preventDefault();
        contextLosses++;
        bus.emit('context-lost', EMPTY);
        if (contextLosses >= 2) {
          getState().setWebgl('lost');
          return;
        }
        if (timer) clearTimeout(timer);
        // Never restored → give up on 3D (App shows the 2D fallback).
        timer = setTimeout(() => getState().setWebgl('lost'), RESTORE_TIMEOUT_MS);
      };
      const restored = (): void => {
        if (timer) clearTimeout(timer);
        timer = null;
        onRestored();
      };
      canvas.addEventListener('webglcontextlost', lost, false);
      canvas.addEventListener('webglcontextrestored', restored, false);
      return () => {
        if (timer) clearTimeout(timer);
        canvas.removeEventListener('webglcontextlost', lost, false);
        canvas.removeEventListener('webglcontextrestored', restored, false);
      };
    },
    [onRestored],
  );
}

const GL_PROPS = {
  antialias: false,
  powerPreference: 'high-performance',
  alpha: false,
  stencil: false,
  depth: true,
  preserveDrawingBuffer: false,
} as const;

const CAMERA_PROPS = { fov: 35, near: 0.1, far: 40, position: [0, 1.25, 3.6] as [number, number, number] };

export default function Stage(): React.JSX.Element {
  const tier = useStore((s) => s.tier);
  const dpr = useStore((s) => s.dpr);
  const phase = useStore((s) => s.phase);
  const count = useStore((s) => s.restaurants.length);
  const isMobile = useMemo(isMobileDevice, []);
  const params = tierParams(tier, isMobile);
  // Remount scene + composer after a context restore (render targets and PMREM are gone).
  const [epoch, setEpoch] = useState(0);
  const [postReady, setPostReady] = useState(false);
  const detach = useRef<(() => void) | null>(null);

  useAdaptiveQuality(isMobile);

  const bumpEpoch = useCallback(() => {
    setPostReady(false);
    setEpoch((e) => e + 1);
  }, []);
  const attachContextLoss = useContextLoss(bumpEpoch);

  const onCreated = useCallback(
    (state: RootState) => {
      state.gl.toneMapping = ACESFilmicToneMapping;
      state.gl.toneMappingExposure = 1.0;
      detach.current?.();
      detach.current = attachContextLoss(state);
    },
    [attachContextLoss],
  );
  useEffect(() => () => detach.current?.(), []);

  const composer = params.composer !== 'none';
  useEffect(() => {
    if (!composer) setPostReady(false);
  }, [composer]);
  const onPostReady = useCallback(() => setPostReady(true), []);

  // Physics is lazy and only after the gate (its chunk is preloaded while the gate is up).
  const physicsAllowed = params.physics && phase !== 'boot' && phase !== 'gate';

  return (
    <Canvas
      className="stage-canvas"
      frameloop="never"
      dpr={dpr}
      gl={GL_PROPS}
      shadows="percentage"
      camera={CAMERA_PROPS}
      onCreated={onCreated}
      aria-hidden="true"
      style={{ position: 'absolute', inset: 0, touchAction: 'none' }}
    >
      <LoopBridge />
      <Scene key={epoch} tier={tier} />
      {composer && (
        <Suspense fallback={null}>
          <Post key={`${tier}-${epoch}`} tier={tier} isMobile={isMobile} onReady={onPostReady} />
        </Suspense>
      )}
      {physicsAllowed && (
        <Suspense fallback={null}>
          <PhysicsLayer count={count} />
        </Suspense>
      )}
      {/* Without a composer warm up right away; with one, once it exists (or after a grace period). */}
      <WarmUpGate tier={tier} composer={composer} postReady={postReady} epoch={epoch} />
    </Canvas>
  );
}

function WarmUpGate({ tier, composer, postReady, epoch }: { tier: QualityTier; composer: boolean; postReady: boolean; epoch: number }) {
  const [graceOver, setGraceOver] = useState(false);
  useEffect(() => {
    if (!composer || postReady) return;
    setGraceOver(false);
    const id = setTimeout(() => setGraceOver(true), 4000);
    return () => clearTimeout(id);
  }, [composer, postReady, epoch]);
  if (composer && !postReady && !graceOver) return null;
  return <WarmUp tier={tier} composerActive={composer && postReady} epoch={epoch} />;
}
