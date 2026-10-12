/**
 * Master rAF loop. R3F runs with frameloop="never"; this loop runs logic every
 * animation frame (sensors → controller) and calls the registered renderer at full rate during
 * action, or throttled to 30 fps (24 on tier 0) when idle. It stops while the tab is hidden.
 */
import { CFG } from '@/config';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { stepShake } from '@/sensors/shake';
import { tick } from '@/draw/controller';
import { audio } from '@/audio/synth';

export type RenderFn = (timestampMs: number) => void;
type FrameListener = (dtMs: number, fullRate: boolean) => void;

let renderer: RenderFn | null = null;
const frameListeners = new Set<FrameListener>();
let holdUntil = 0;

let raf = 0;
let running = false;
let started = false;
let lastTs = 0;
let lastRender = 0;
let prevRenderFull = false;
let errorLogged = false;

const ACTIVE_PHASES = new Set(['boot', 'armed', 'drawing', 'jiaobei', 'resetting']);

/** Whether this frame should render at the display rate. */
export function isFullRate(now: number): boolean {
  const s = getState();
  if (ACTIVE_PHASES.has(s.phase)) return true;
  if (s.phase === 'reveal' && now - s.phaseSince < CFG.loop.revealFullRateMs) return true;
  if (now < holdUntil) return true;
  if (rt.input.pointer.grabbing || rt.input.auto.active) return true;
  if (rt.shake.meter > 0.001 || rt.shake.energy > 0.01) return true;
  if (rt.fx.flash > 0.001 || rt.fx.dustBurst > 0.001) return true;
  return false;
}

function frame(ts: number): void {
  if (!running) return;
  raf = requestAnimationFrame(frame);
  const dt = lastTs > 0 ? Math.min(Math.max(0, (ts - lastTs) / 1000), CFG.loop.maxDt) : 1 / 60;
  lastTs = ts;
  try {
    stepShake(dt, ts);
    tick(dt, ts);
    if (!renderer) return;
    const full = isFullRate(ts);
    const idleFps = getState().tier === 0 ? CFG.loop.idleFpsTier0 : CFG.loop.idleFps;
    // 2 ms of slack so a 60 Hz display hits 30 fps exactly instead of drifting to 20.
    if (!full && ts - lastRender < 1000 / idleFps - 2) return;
    const dtMs = lastRender > 0 ? ts - lastRender : 1000 / 60;
    renderer(ts);
    // The governor only trusts consecutive full-rate frames.
    const trusted = full && prevRenderFull;
    prevRenderFull = full;
    lastRender = ts;
    for (const fn of frameListeners) fn(dtMs, trusted);
  } catch (err) {
    if (!errorLogged) {
      errorLogged = true;
      console.error('[loop] frame failed', err);
    }
  }
}

function resume(): void {
  if (running) return;
  running = true;
  lastTs = 0;
  prevRenderFull = false;
  raf = requestAnimationFrame(frame);
}

function pause(): void {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
}

function onVisibility(): void {
  if (document.visibilityState === 'hidden') {
    pause();
    audio.suspend();
  } else {
    audio.resume();
    resume();
  }
}

function onPageHide(): void {
  pause();
  audio.suspend();
}

function onPageShow(): void {
  if (document.visibilityState !== 'hidden') {
    audio.resume();
    resume();
  }
}

/** Start the master loop (idempotent). Returns a stop function. */
export function startLoop(): () => void {
  if (started) return stopLoop;
  started = true;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  if (document.visibilityState !== 'hidden') resume();
  return stopLoop;
}

function stopLoop(): void {
  if (!started) return;
  started = false;
  pause();
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('pagehide', onPageHide);
  window.removeEventListener('pageshow', onPageShow);
}

/** Stage registers R3F `advance`; Fallback2D may register its own painter. Pass null to unregister. */
export function registerRenderer(fn: RenderFn | null): void {
  renderer = fn;
  lastRender = 0;
  prevRenderFull = false;
}

/** Keep rendering at full rate for `ms` (pointer move, toasts, drawer animations…). */
export function holdFullRate(ms: number): void {
  const until = (typeof performance !== 'undefined' ? performance.now() : 0) + ms;
  if (until > holdUntil) holdUntil = until;
}

/** Perf-governor feed: render-frame interval and whether it was a trusted full-rate frame. */
export function onFrameTime(fn: FrameListener): () => void {
  frameListeners.add(fn);
  return () => {
    frameListeners.delete(fn);
  };
}
