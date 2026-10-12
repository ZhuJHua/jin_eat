/**
 * Device motion → `rt.input.motion` and the sensor bring-up / fallback flow.
 * Listeners only write into the runtime object; nothing touches React per event.
 *
 * Per event:
 *  1. linear acceleration from `e.acceleration`, or high-passed `accelerationIncludingGravity`;
 *  2. sign calibration against deviceorientation during the first 300 ms;
 *  3. rotation into the screen frame;
 *  4. |lin| and a display low-pass;
 *  5. peak counting for visual kicks;
 *  6. the intent gate: `lin` (the tube's visual drive) only carries deliberate shaking — `mag`
 *     (meter, arming, clacks) stays raw. See CFG.sensors.feel.
 */
import type { SensorStatus, Vec3 } from '@/types';
import { CFG } from '@/config';
import { COPY } from '@/data/copy';
import { rt } from '@/state/runtime';
import { getState } from '@/state/store';
import { feelPreset, IntentGate, isFiniteVec, LowPass3, PeakDetector, remapToScreenInto, signFixFrom } from '@/sensors/filters';
import { latestOrientation, screenAngle, startOrientation, type OrientationHandle } from '@/sensors/orientation';
import { motionCapability, requestMotionPermission, type MotionPermission } from '@/sensors/permission';

export interface SensorHandle {
  stop(): void;
  waitForFirstEvent(ms: number): Promise<boolean>;
}

export type MotionHandle = SensorHandle & {
  /** Detach listeners while the page is hidden. */
  pause(): void;
  resume(): void;
};

const nowMs = (): number => performance.now();

/** How long gravity/orientation samples are compared before the sign is fixed. */
const CALIB_MAX_MS = 1500;

/** Attach the devicemotion listener and start writing `rt.input.motion`. */
export function startMotion(): MotionHandle {
  const c = CFG.sensors;
  const m = rt.input.motion;
  const gravity = new LowPass3(1 - c.gravityAlpha);
  const display = new LowPass3(0.5);
  const peaks = new PeakDetector(c.clackPeak, c.clackRefractoryMs);
  const intent = new IntentGate(c.feel);
  let signFix: 1 | -1 = 1;
  let calibStart = -1;
  let calibDone = false;
  let votes = 0;
  let lastTs = 0;
  let got = false;
  let attached = false;
  let stopped = false;
  const waiters = new Set<() => void>();
  const lin: Vec3 = [0, 0, 0];
  const aig: Vec3 = [0, 0, 0];
  // Scratch for the per-event path (devicemotion fires at 60–200 Hz).
  const signed: Vec3 = [0, 0, 0];
  const screenV: Vec3 = [0, 0, 0];
  const magV: Vec3 = [0, 0, 0];

  const calibrate = (t: number): void => {
    if (calibDone) return;
    if (calibStart < 0) calibStart = t;
    const o = latestOrientation();
    if (o && t - o.ts < 250 && gravity.ready) {
      votes += signFixFrom(gravity.value, o.beta, o.gamma);
    }
    const elapsed = t - calibStart;
    // Decide after the calibration window once there is evidence, or give up (keep +1).
    if ((elapsed >= c.signCalibMs && votes !== 0) || elapsed >= CALIB_MAX_MS) {
      signFix = votes < 0 ? -1 : 1;
      calibDone = true;
    }
  };

  const onEvent = (e: DeviceMotionEvent): void => {
    const acc = e.acceleration;
    const inc = e.accelerationIncludingGravity;
    const hasAcc = isFiniteVec(acc);
    const hasInc = isFiniteVec(inc);
    if (!hasAcc && !hasInc) return;
    const t = nowMs();
    const dt = lastTs > 0 ? Math.min(0.25, (t - lastTs) / 1000) : 1 / 60;
    lastTs = t;

    if (hasInc && inc) {
      aig[0] = inc.x as number;
      aig[1] = inc.y as number;
      aig[2] = inc.z as number;
      gravity.pushDt(aig, dt);
    }
    if (hasAcc && acc) {
      lin[0] = acc.x as number;
      lin[1] = acc.y as number;
      lin[2] = acc.z as number;
    } else {
      const g = gravity.value;
      lin[0] = aig[0] - g[0];
      lin[1] = aig[1] - g[1];
      lin[2] = aig[2] - g[2];
    }
    if (hasInc) calibrate(t);

    const s = signFix;
    signed[0] = lin[0] * s;
    signed[1] = lin[1] * s;
    signed[2] = lin[2] * s;
    const screen = remapToScreenInto(signed, screenAngle(), screenV);
    const mag = Math.hypot(screen[0], screen[1], screen[2]);
    magV[0] = mag;
    const lp = display.pushDt(magV, dt);

    // Visual drive only: tremor / walking never reach the tube. `mag` (meter, arming, clacks) stays raw.
    const preset = feelPreset(c.feel, getState().settings.motionSensitivity);
    const gain = intent.push(mag, dt, preset);
    const drive = gain * preset.driveGain;
    m.lin[0] = screen[0] * drive;
    m.lin[1] = screen[1] * drive;
    m.lin[2] = screen[2] * drive;
    m.intent = gain;
    m.mag = mag;
    m.magLP = lp[0];
    m.lastTs = t;
    m.active = true;
    if (peaks.push(mag, t)) m.peaks++;

    if (!got) {
      got = true;
      for (const w of waiters) w();
      waiters.clear();
    }
  };

  const clearRt = (): void => {
    m.lin[0] = m.lin[1] = m.lin[2] = 0;
    m.mag = 0;
    m.magLP = 0;
    m.intent = 0;
    m.active = false;
  };

  const attach = (): void => {
    if (attached || stopped || typeof window === 'undefined') return;
    attached = true;
    window.addEventListener('devicemotion', onEvent);
  };
  const detach = (): void => {
    if (!attached) return;
    attached = false;
    window.removeEventListener('devicemotion', onEvent);
  };

  attach();

  return {
    pause(): void {
      detach();
      clearRt();
    },
    resume(): void {
      if (stopped) return;
      // The gravity estimate is stale after a pause; re-prime it from the next sample.
      gravity.reset();
      display.reset();
      peaks.reset();
      intent.reset();
      lastTs = 0;
      attach();
    },
    stop(): void {
      stopped = true;
      detach();
      clearRt();
      for (const w of waiters) w();
      waiters.clear();
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
  };
}

// ───────────────────────────── bring-up / lifecycle ─────────────────────────────

let motion: MotionHandle | null = null;
let orientation: OrientationHandle | null = null;
let generation = 0;
let lifecycleBound = false;

function onVisibility(): void {
  if (document.visibilityState === 'hidden') pauseSensors();
  else resumeSensors();
}

function onPageHide(): void {
  pauseSensors();
}

function onPageShow(): void {
  if (document.visibilityState !== 'hidden') resumeSensors();
}

function bindLifecycle(): void {
  if (lifecycleBound || typeof document === 'undefined') return;
  lifecycleBound = true;
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
}

function pauseSensors(): void {
  motion?.pause();
  orientation?.pause();
}

function resumeSensors(): void {
  motion?.resume();
  orientation?.resume();
}

function persistStatus(status: SensorStatus): void {
  try {
    const s = getState();
    if (s.settings.motionStatus !== status) s.updateSettings({ motionStatus: status });
  } catch {
    // Persisting is best effort (private mode, quota).
  }
}

function enterPointerMode(status: SensorStatus, hint: string | null): void {
  rt.input.mode = 'pointer';
  getState().setGate({ status, inputMode: 'pointer', hint });
  persistStatus(status);
}

function enterMotionMode(): void {
  rt.input.mode = 'motion';
  getState().setGate({ status: 'granted', inputMode: 'motion', hint: null });
  persistStatus('granted');
}

/**
 * Start motion + orientation after a permission result and settle the input mode.
 * Never rejects. Re-entrant: a newer call supersedes an older one still waiting.
 */
export async function startSensorsOrFallback(perm: MotionPermission): Promise<void> {
  const gen = ++generation;
  try {
    if (perm === 'granted' || perm === 'not-required') {
      motion?.stop();
      orientation?.stop();
      motion = startMotion();
      orientation = startOrientation();
      bindLifecycle();
      const ok = await motion.waitForFirstEvent(CFG.sensors.noEventTimeoutMs);
      if (gen !== generation) return;
      if (ok) {
        enterMotionMode();
        return;
      }
      // Silent sensors (desktop browsers, some webviews): fall back, but keep listening so a late
      // first event still upgrades to motion mode.
      enterPointerMode('silent', COPY.hint.fallback);
      const late = motion;
      void late.waitForFirstEvent(8000).then((arrived) => {
        if (arrived && gen === generation && motion === late) enterMotionMode();
      });
      return;
    }
    if (perm === 'denied') {
      enterPointerMode('denied', COPY.hint.fallback);
      getState().showToast(COPY.toast.denied);
      return;
    }
    enterPointerMode(perm, COPY.hint.fallback);
  } catch (err) {
    console.error('[sensors] start failed', err);
    if (gen === generation) enterPointerMode('unsupported', COPY.hint.fallback);
  }
}

/**
 * 「重新授权体感」 in Settings. Call synchronously from the click handler: the iOS prompt is
 * requested in this tick.
 */
export function retryMotionPermission(): Promise<void> {
  const perm = requestMotionPermission();
  return perm.then((p) => startSensorsOrFallback(p));
}

/** 「重新校准」: the current pose becomes the neutral tilt. Returns false when no sensor is running. */
export function recalibrateTilt(): boolean {
  if (!orientation) return false;
  orientation.calibrate();
  return true;
}

/** Whether the 「重新授权体感」 button makes sense on this device (iOS-style permission). */
export function canRetryPermission(): boolean {
  const cap = motionCapability();
  return cap.secure && cap.hasMotion && cap.needsPermission;
}
