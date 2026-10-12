/**
 * Device orientation → tube tilt. Writes `rt.input.motion.tilt` (radians,
 * relative to the calibrated pose, screen frame: x > 0 = right edge dipped (gamma up), y > 0 = top
 * edge tipped back toward the user (beta up)), clamped to ±35°, and `rt.input.motion.forward`
 * (degrees the top edge is tipped away from the user, i.e. −tilt.y in degrees).
 *
 * `tilt` is the VISUAL tilt: lean relative to a neutral that re-centres in ~tiltRecenterSec, through a
 * radial soft deadzone and the 体感灵敏度 preset gain (CFG.sensors.feel), so hand drift and held
 * posture changes never park the tube / camera / lanterns off-centre. `forward` keeps the fixed
 * calibrated baseline (前倾 boost). Consumers still apply their own gain (e.g. 0.3× in reduced motion).
 */
import { CFG } from '@/config';
import { rt } from '@/state/runtime';
import { getState } from '@/state/store';
import { alphaForDt, angleDiff, clamp, feelPreset, normalizeScreenAngle, remapToScreen, TiltConditioner } from '@/sensors/filters';
import type { SensorHandle } from '@/sensors/motion';

const DEG = Math.PI / 180;

export interface OrientationSample {
  beta: number;
  gamma: number;
  /** performance.now() ms. */
  ts: number;
}

let latest: OrientationSample | null = null;

/** The most recent raw beta/gamma (used by motion.ts for sign calibration). */
export function latestOrientation(): OrientationSample | null {
  return latest;
}

/** Current screen rotation in degrees (0/90/180/270). */
export function screenAngle(): number {
  if (typeof window === 'undefined') return 0;
  try {
    const a = window.screen?.orientation?.angle;
    if (typeof a === 'number' && Number.isFinite(a)) return a;
  } catch {
    // ignore
  }
  const legacy = (window as unknown as { orientation?: unknown }).orientation;
  return typeof legacy === 'number' && Number.isFinite(legacy) ? legacy : 0;
}

const nowMs = (): number => performance.now();

/** After a screen rotation, wait this long for the hand to settle before taking the new baseline. */
const ROTATE_SETTLE_MS = 450;

/**
 * Device lean (dGamma, dBeta) → screen-frame lean (x > 0: screen-right edge dipped, y > 0: screen-top
 * edge tipped toward the user). Lean is a rotation pseudo-vector with swapped axes (gamma turns about
 * device y, beta about device x), so it rotates by −angle rather than +angle like an ordinary vector.
 * At 90° (phone top to the left) the screen-right edge is the device bottom: dipping it raises beta.
 */
export function leanToScreen(dGamma: number, dBeta: number, angleDeg: number): [number, number] {
  const v = remapToScreen([dGamma, dBeta, 0], -angleDeg);
  return [v[0], v[1]];
}

export type OrientationHandle = SensorHandle & {
  calibrate(): void;
  /** Detach listeners while the page is hidden (keeps the baseline). */
  pause(): void;
  resume(): void;
};

/** Attach the deviceorientation listener. The first event after start becomes the baseline. */
export function startOrientation(): OrientationHandle {
  const c = CFG.sensors;
  let baseline: { beta: number; gamma: number } | null = null;
  let baseAngle = 0;
  /** performance.now() when a rotation was noticed (re-baseline once it settles), else null. */
  let rotatedAt: number | null = null;
  let wantCalibrate = true;
  let prevRaw: { beta: number; gamma: number } | null = null;
  let lastTs = 0;
  // Smoothed screen-frame lean in degrees.
  let sx = 0;
  let sy = 0;
  let sf = 0;
  // Visual tilt conditioning (re-centring neutral + radial soft deadzone + preset gain).
  const vis = new TiltConditioner();
  let attached = false;
  const waiters = new Set<() => void>();
  let got = false;

  const m = rt.input.motion;

  const onEvent = (e: DeviceOrientationEvent): void => {
    const beta = e.beta;
    const gamma = e.gamma;
    if (beta === null || gamma === null || !Number.isFinite(beta) || !Number.isFinite(gamma)) return;
    const t = nowMs();
    latest = { beta, gamma, ts: t };
    if (!got) {
      got = true;
      for (const w of waiters) w();
      waiters.clear();
    }
    // Near vertical (gimbal lock) some browsers flip gamma by ~180° in one sample. Drop the
    // discontinuous sample; the low-pass and clamp absorb the rest.
    const jump = prevRaw !== null && Math.abs(gamma - prevRaw.gamma) > 120;
    prevRaw = { beta, gamma };
    if (jump && baseline) return;

    const angle = normalizeScreenAngle(screenAngle());
    if (baseline && angle !== baseAngle) {
      // Portrait ↔ landscape: the old baseline is meaningless. Hold neutral, then re-baseline.
      if (rotatedAt === null) rotatedAt = t;
      sx = sy = sf = 0;
      vis.reset();
      m.tilt.x = m.tilt.y = 0;
      m.forward = 0;
      if (t - rotatedAt < ROTATE_SETTLE_MS) return;
      rotatedAt = null;
      wantCalibrate = true;
    }
    if (wantCalibrate || !baseline) {
      baseline = { beta, gamma };
      baseAngle = angle;
      rotatedAt = null;
      wantCalibrate = false;
      sx = sy = sf = 0;
      vis.reset();
      lastTs = t;
    }
    const dBeta = angleDiff(beta, baseline.beta);
    const dGamma = angleDiff(gamma, baseline.gamma);
    const [lx, ly] = leanToScreen(dGamma, dBeta, angle);
    const dt = lastTs > 0 ? (t - lastTs) / 1000 : 1 / 60;
    lastTs = t;
    const a = alphaForDt(c.tiltAlpha, dt);
    const lim = c.tiltClampDeg;
    sx += a * (clamp(lx, -lim, lim) - sx);
    sy += a * (clamp(ly, -lim, lim) - sy);
    // forward = baseline beta − current beta, in the screen frame (−ly).
    sf += a * (-ly - sf);
    vis.push(sx, sy, dt, feelPreset(c.feel, getState().settings.motionSensitivity));
    m.tilt.x = vis.x * DEG;
    m.tilt.y = vis.y * DEG;
    m.forward = sf;
  };

  const attach = (): void => {
    if (attached || typeof window === 'undefined') return;
    attached = true;
    window.addEventListener('deviceorientation', onEvent);
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    window.removeEventListener('deviceorientation', onEvent);
  };

  // Rotation is also noticed by onEvent itself; the events just make it immediate.
  const onRotate = (): void => {
    if (baseline && rotatedAt === null) rotatedAt = nowMs();
  };
  const so = typeof window !== 'undefined' ? window.screen?.orientation : undefined;
  if (so && typeof so.addEventListener === 'function') so.addEventListener('change', onRotate);
  else if (typeof window !== 'undefined') window.addEventListener('orientationchange', onRotate);

  attach();

  let stopped = false;

  return {
    pause(): void {
      detach();
    },
    resume(): void {
      if (stopped) return;
      lastTs = 0;
      attach();
    },
    stop(): void {
      stopped = true;
      detach();
      if (so && typeof so.removeEventListener === 'function') so.removeEventListener('change', onRotate);
      else if (typeof window !== 'undefined') window.removeEventListener('orientationchange', onRotate);
      for (const w of waiters) w();
      waiters.clear();
      m.tilt.x = 0;
      m.tilt.y = 0;
      m.forward = 0;
    },
    waitForFirstEvent(ms: number): Promise<boolean> {
      if (got) return Promise.resolve(true);
      return new Promise<boolean>((resolve) => {
        const done = (): void => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(got);
        };
        const timer = setTimeout(done, ms);
        waiters.add(done);
      });
    },
    calibrate(): void {
      wantCalibrate = true;
      if (latest && nowMs() - latest.ts < 500) {
        baseline = { beta: latest.beta, gamma: latest.gamma };
        baseAngle = normalizeScreenAngle(screenAngle());
        rotatedAt = null;
        wantCalibrate = false;
        sx = sy = sf = 0;
        vis.reset();
        m.tilt.x = m.tilt.y = 0;
        m.forward = 0;
      }
    },
  };
}
