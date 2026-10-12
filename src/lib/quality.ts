/**
 * Adaptive quality: initial tier heuristic, per-tier parameters and the perf governor.
 * Entry-chunk safe (no three.js). The governor is fed by engine/loop `onFrameTime` with trusted
 * full-rate frames only, so the idle throttle can never fool it.
 */
import type { QualityPref, QualityTier } from '@/types';
import { CFG } from '@/config';
import { webglInfo } from '@/lib/webgl';

export interface TierParams {
  dpr: [number, number];
  physics: boolean;
  composer: 'none' | 'lite' | 'full';
  clearcoat: boolean;
  pointLights: 0 | 1 | 2;
  shadows: boolean;
  smoke: 'billboard' | 'ribbon';
  dust: number;
  confetti: number;
  godray: boolean;
  atlas: 1024 | 2048;
  idleFps: number;
  envRes: number;
}

const STRONG_GPU = /Apple (GPU|M\d)|RTX|Radeon RX|Adreno \(TM\) (7[3-9]\d|[89]\d\d)|Mali-G(7[1-9]|6[1-9]0|71[05]|720)|Immortalis/;
const WEAK_GPU = /Adreno \(TM\) [1-5]\d\d|Mali-[GT][0-6]\d\b|PowerVR|SwiftShader|llvmpipe|HD Graphics [2-5]\d{2,3}/;

interface NavigatorExtras {
  deviceMemory?: number;
  connection?: { saveData?: boolean };
}

function mq(query: string): boolean {
  try {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  } catch {
    return false;
  }
}

let mobileCache: boolean | null = null;

/** Phones and tablets: coarse primary pointer, or a mobile UA as a fallback. */
export function isMobileDevice(): boolean {
  if (mobileCache !== null) return mobileCache;
  if (typeof navigator === 'undefined') return (mobileCache = false);
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|HarmonyOS/i.test(ua);
  // iPadOS reports a desktop UA; touch points give it away.
  const ipad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  mobileCache = mq('(pointer: coarse)') || uaMobile || ipad;
  return mobileCache;
}

/** Device pixel ratio (1 outside the browser). */
export function deviceDpr(): number {
  const d = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(d) && d > 0 ? d : 1;
}

/** Score-based initial-tier heuristic. Pure core so it can be unit-tested. */
export function scoreTier(sig: { cores?: number; memory?: number; renderer: string; saveData?: boolean; coarse: boolean }): QualityTier {
  let score = 0;
  if ((sig.cores ?? 0) >= 8) score += 1;
  if (sig.memory === undefined) score += 0.5;
  else if (sig.memory >= 6) score += 1;
  if (STRONG_GPU.test(sig.renderer)) score += 1;
  if (WEAK_GPU.test(sig.renderer)) score -= 2;
  if (sig.saveData) score -= 1;
  // iOS hides core count and memory; every WebGL2-era iPhone GPU handles the full shrine, and the
  // perf governor drops quickly if one can't.
  if (sig.coarse && /Apple GPU/.test(sig.renderer)) score += 0.5;
  return score >= 2 ? 2 : score >= 0.5 ? 1 : 0;
}

let initialTierCache: QualityTier | null = null;

/** Initial tier for `quality: 'auto'` (cached; deterministic for a session). */
export function detectInitialTier(): QualityTier {
  if (initialTierCache !== null) return initialTierCache;
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & NavigatorExtras) | undefined;
  const info = webglInfo();
  initialTierCache = scoreTier({
    cores: nav?.hardwareConcurrency,
    memory: nav?.deviceMemory,
    renderer: info.renderer,
    saveData: nav?.connection?.saveData === true,
    coarse: isMobileDevice(),
  });
  return initialTierCache;
}

/** Fixed tier for an explicit user preference; null for 'auto' (and 'flat', which skips 3D). */
export function tierForPref(pref: QualityPref): QualityTier | null {
  switch (pref) {
    case 'low':
      return 0;
    case 'mid':
      return 1;
    case 'high':
      return 2;
    default:
      return null;
  }
}

export function tierParams(t: QualityTier, isMobile: boolean): TierParams {
  switch (t) {
    case 0:
      return {
        dpr: [1, 1],
        physics: false,
        composer: 'none',
        clearcoat: false,
        pointLights: 0,
        shadows: false,
        smoke: 'billboard',
        dust: 80,
        confetti: 60,
        godray: false,
        atlas: 1024,
        idleFps: CFG.loop.idleFpsTier0,
        envRes: 32,
      };
    case 1:
      return {
        dpr: [1, 1.5],
        physics: true,
        composer: 'lite',
        clearcoat: false,
        pointLights: 1,
        shadows: false,
        smoke: 'ribbon',
        dust: 160,
        confetti: 120,
        godray: false,
        atlas: 2048,
        idleFps: CFG.loop.idleFps,
        envRes: 64,
      };
    default:
      return {
        dpr: isMobile ? [1, 1.75] : [1, 2],
        physics: true,
        composer: 'full',
        clearcoat: true,
        pointLights: 2,
        shadows: true,
        smoke: 'ribbon',
        dust: 300,
        confetti: 300,
        godray: true,
        atlas: 2048,
        idleFps: CFG.loop.idleFps,
        envRes: 128,
      };
  }
}

const DPR_STEP = 0.25;

function snapDpr(d: number): number {
  return Math.round(d / DPR_STEP) * DPR_STEP;
}

/** Highest DPR worth rendering at for a tier on this device (never above the screen's own DPR). */
export function maxDprFor(t: QualityTier, isMobile: boolean, device: number = deviceDpr()): number {
  const [lo, hi] = tierParams(t, isMobile).dpr;
  // Round the device DPR up to the ladder so e.g. 2.625 (Android) can still use 2.
  const dev = Math.max(1, Math.ceil(device / DPR_STEP - 1e-6) * DPR_STEP);
  return Math.max(lo, Math.min(hi, dev));
}

/** Starting DPR for a tier: the top of its range, clamped to the device. */
export function initialDprFor(t: QualityTier, isMobile: boolean, device: number = deviceDpr()): number {
  return maxDprFor(t, isMobile, device);
}

// ───────────────────────────── perf governor ─────────────────────────────

export interface PerfGovernor {
  feed(dtMs: number, fullRate: boolean): void;
  lock(): void;
  dispose(): void;
  /** Current decision (for the debug HUD). */
  readonly state: { tier: QualityTier; dpr: number; locked: boolean; fps: number; hz: number };
}

export interface PerfGovernorOptions {
  isMobile: boolean;
  onChange(t: QualityTier, dpr: number): void;
  /** Starting point; defaults to tier 1 at its initial DPR. */
  tier?: QualityTier;
  dpr?: number;
  /** Device DPR override (tests). */
  device?: number;
  /** Highest tier the governor may climb to (default 2). */
  maxTier?: QualityTier;
}

const WINDOW_MS = 2000;
const UP_MS = 4000;
const MAX_FLIPS = 3;
const SAMPLE_CAP = 1024;

function snapHz(hz: number): number {
  if (hz < 75) return 60;
  if (hz < 105) return 90;
  if (hz < 132) return 120;
  return 144;
}

export function createPerfGovernor(opts: PerfGovernorOptions): PerfGovernor {
  const device = opts.device ?? deviceDpr();
  const maxTier: QualityTier = opts.maxTier ?? 2;
  let tier: QualityTier = opts.tier ?? 1;
  let dpr = snapDpr(opts.dpr ?? initialDprFor(tier, opts.isMobile, device));
  let locked = false;
  let disposed = false;

  const samples = new Float32Array(SAMPLE_CAP);
  const sorted = new Float32Array(SAMPLE_CAP);
  let n = 0;
  let acc = 0;
  let goodMs = 0;
  let lastDir: -1 | 0 | 1 = 0;
  let flips = 0;
  let hz = 60;
  let lastFps = 0;

  const resetWindow = (): void => {
    n = 0;
    acc = 0;
  };

  const turn = (dir: -1 | 1): void => {
    if (lastDir !== 0 && lastDir !== dir) {
      flips++;
      if (flips >= MAX_FLIPS) locked = true;
    }
    lastDir = dir;
  };

  const minDpr = (t: QualityTier): number => tierParams(t, opts.isMobile).dpr[0];

  const stepDown = (): boolean => {
    if (dpr - DPR_STEP >= minDpr(tier) - 1e-6) {
      dpr = snapDpr(dpr - DPR_STEP);
    } else if (tier > 0) {
      tier = (tier - 1) as QualityTier;
      dpr = Math.min(Math.max(dpr, minDpr(tier)), maxDprFor(tier, opts.isMobile, device));
    } else {
      return false;
    }
    turn(-1);
    return true;
  };

  const stepUp = (): boolean => {
    const cap = maxDprFor(tier, opts.isMobile, device);
    if (dpr + DPR_STEP <= cap + 1e-6) {
      dpr = snapDpr(dpr + DPR_STEP);
    } else if (tier < maxTier) {
      tier = (tier + 1) as QualityTier;
      dpr = Math.min(Math.max(dpr, minDpr(tier)), maxDprFor(tier, opts.isMobile, device));
    } else {
      return false;
    }
    turn(1);
    return true;
  };

  const estimateHz = (): void => {
    // 10th percentile frame interval ≈ the display's vsync interval.
    sorted.set(samples.subarray(0, n));
    const view = sorted.subarray(0, n);
    view.sort();
    const p10 = view[Math.floor(n * 0.1)] ?? 16.7;
    if (p10 > 0) hz = Math.max(hz, snapHz(1000 / p10));
  };

  const evaluate = (): void => {
    estimateHz();
    const fps = (n * 1000) / acc;
    lastFps = fps;
    const scale = hz / 60;
    const low = (opts.isMobile ? 45 : 52) * scale;
    const high = 58 * scale;
    resetWindow();
    if (fps < low) {
      goodMs = 0;
      // Far below budget (e.g. a phone that started on 极致 but can't hold it): drop a whole tier
      // at once instead of crawling down the DPR ladder for several seconds of stutter.
      if (fps < low * 0.7 && tier > 0) {
        tier = (tier - 1) as QualityTier;
        dpr = Math.min(Math.max(dpr, minDpr(tier)), maxDprFor(tier, opts.isMobile, device));
        turn(-1);
        opts.onChange(tier, dpr);
      } else if (stepDown()) opts.onChange(tier, dpr);
      return;
    }
    if (fps >= high) {
      goodMs += WINDOW_MS;
      const atDprCap = dpr + DPR_STEP > maxDprFor(tier, opts.isMobile, device) + 1e-6;
      // Climbing a whole tier needs twice the evidence.
      const need = atDprCap ? UP_MS * 2 : UP_MS;
      if (goodMs >= need) {
        goodMs = 0;
        if (stepUp()) opts.onChange(tier, dpr);
      }
      return;
    }
    goodMs = 0;
  };

  return {
    feed(dtMs, fullRate) {
      if (disposed || locked || !fullRate) return;
      // Ignore stalls (tab switches, shader compiles, GC) and nonsense.
      if (!(dtMs > 0) || dtMs > 250) return;
      if (n < SAMPLE_CAP) samples[n++] = dtMs;
      acc += dtMs;
      if (acc >= WINDOW_MS) evaluate();
    },
    lock() {
      locked = true;
    },
    dispose() {
      disposed = true;
    },
    get state() {
      return { tier, dpr, locked, fps: lastFps, hz };
    },
  };
}
