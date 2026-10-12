/**
 * Pure signal-processing helpers for the sensor pipeline. No DOM access here,
 * so everything is unit-tested in node (filters.test.ts).
 */
import type { MotionSensitivity, Vec3 } from '@/types';
import type { CFG } from '@/config';

export type SensorCfg = typeof CFG.sensors;

const G = 9.80665;
const DEG = Math.PI / 180;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export const isFiniteVec = (v: { x: number | null; y: number | null; z: number | null } | null | undefined): boolean =>
  !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

/**
 * Convert a per-sample smoothing factor tuned at `refHz` into the factor for a sample that arrived
 * after `dtSec`, so filters behave the same on 60 Hz iOS and 200 Hz Android sensors.
 */
export function alphaForDt(alpha: number, dtSec: number, refHz = 60): number {
  const a = clamp(alpha, 0, 1);
  if (a >= 1) return 1;
  if (!(dtSec > 0)) return a;
  return 1 - Math.pow(1 - a, Math.min(dtSec * refHz, 30));
}

/**
 * One-pole low-pass on three axes: `y += alpha·(x − y)` where `alpha` is the weight of the NEW sample
 * (so the gravity filter `g = 0.8·g + 0.2·x` is `new LowPass3(0.2)`).
 * The first sample initialises the state, so there is no ramp from zero.
 */
export class LowPass3 {
  readonly alpha: number;
  readonly value: Vec3 = [0, 0, 0];
  private primed = false;

  constructor(alpha: number) {
    this.alpha = clamp(alpha, 0, 1);
  }

  get ready(): boolean {
    return this.primed;
  }

  push(v: Vec3): Vec3 {
    return this.pushWith(v, this.alpha);
  }

  /** Like push(), with alpha rescaled for a sample that arrived `dtSec` after the previous one. */
  pushDt(v: Vec3, dtSec: number, refHz = 60): Vec3 {
    return this.pushWith(v, alphaForDt(this.alpha, dtSec, refHz));
  }

  reset(v?: Vec3): void {
    if (v) {
      this.value[0] = v[0];
      this.value[1] = v[1];
      this.value[2] = v[2];
      this.primed = true;
    } else {
      this.value[0] = this.value[1] = this.value[2] = 0;
      this.primed = false;
    }
  }

  private pushWith(v: Vec3, a: number): Vec3 {
    const y = this.value;
    if (!this.primed) {
      y[0] = v[0];
      y[1] = v[1];
      y[2] = v[2];
      this.primed = true;
      return y;
    }
    y[0] += a * (v[0] - y[0]);
    y[1] += a * (v[1] - y[1]);
    y[2] += a * (v[2] - y[2]);
    return y;
  }
}

/** Scalar one-pole low-pass with the same conventions as LowPass3. */
export class LowPass1 {
  value = 0;
  private primed = false;
  constructor(readonly alpha: number) {}
  push(v: number, dtSec?: number, refHz = 60): number {
    if (!this.primed) {
      this.value = v;
      this.primed = true;
      return v;
    }
    const a = dtSec === undefined ? this.alpha : alphaForDt(this.alpha, dtSec, refHz);
    this.value += a * (v - this.value);
    return this.value;
  }
  reset(v?: number): void {
    this.value = v ?? 0;
    this.primed = v !== undefined;
  }
}

/** Normalise any angle in degrees to the screen rotations 0, 90, 180 or 270 (−90 → 270). */
export function normalizeScreenAngle(angleDeg: number): 0 | 90 | 180 | 270 {
  if (!Number.isFinite(angleDeg)) return 0;
  const a = (((Math.round(angleDeg / 90) * 90) % 360) + 360) % 360;
  return a as 0 | 90 | 180 | 270;
}

/**
 * Rotate a device-frame vector (x right, y toward the top of the phone in its natural portrait
 * orientation, z out of the screen) into the current screen frame (x right, y up as the user sees
 * it). `angleDeg` is `screen.orientation.angle` (or legacy `window.orientation`): the device is
 * rotated that many degrees counter-clockwise, so the device axes rotate by +angle in screen space.
 * angle 90 (top of the phone pointing left): screen = (−y, x, z).
 */
export function remapToScreen(v: Vec3, angleDeg: number): Vec3 {
  return remapToScreenInto(v, angleDeg, [0, 0, 0]);
}

/** Allocation-free `remapToScreen` (for per-event sensor paths); `out` may alias `v`. */
export function remapToScreenInto(v: Vec3, angleDeg: number, out: Vec3): Vec3 {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  switch (normalizeScreenAngle(angleDeg)) {
    case 90:
      out[0] = -y;
      out[1] = x;
      break;
    case 180:
      out[0] = -x;
      out[1] = -y;
      break;
    case 270:
      out[0] = y;
      out[1] = -x;
      break;
    default:
      out[0] = x;
      out[1] = y;
  }
  out[2] = z;
  return out;
}

/**
 * Sign calibration. Per the W3C spec, at rest `accelerationIncludingGravity`
 * points "up" in device coordinates: y ≈ g·sin(beta), z ≈ g·cos(beta)·cos(gamma). Some legacy iOS
 * builds report it inverted. Returns −1 when the measured gravity clearly opposes the expectation,
 * otherwise 1 (including when the reading is too weak or ambiguous to decide).
 */
export function signFixFrom(gravity: Vec3, betaDeg: number, gammaDeg = 0): 1 | -1 {
  if (!Number.isFinite(betaDeg) || !gravity.every(Number.isFinite)) return 1;
  const gm = Math.hypot(gravity[0], gravity[1], gravity[2]);
  if (gm < 0.4 * G || gm > 1.6 * G) return 1; // moving too much (or not gravity at all)
  const b = betaDeg * DEG;
  const gmm = Number.isFinite(gammaDeg) ? gammaDeg * DEG : 0;
  const ey = Math.sin(b);
  const ez = Math.cos(b) * Math.cos(gmm);
  const en = Math.hypot(ey, ez);
  if (en < 0.2) return 1;
  const dot = (gravity[1] * ey + gravity[2] * ez) / (gm * en);
  return dot < -0.5 ? -1 : 1;
}

/**
 * Peak detector with a refractory period and hysteresis: fires once when `mag` rises through
 * `threshold`, then re-arms after the signal drops below `rearmRatio·threshold`, or after
 * 4× the refractory period of sustained high signal (continuous violent shaking still ticks).
 */
export class PeakDetector {
  private lastFire = -Infinity;
  private armed = true;
  constructor(
    readonly threshold: number,
    readonly refractoryMs: number,
    readonly rearmRatio = 0.6,
  ) {}

  push(mag: number, tMs: number): boolean {
    if (!Number.isFinite(mag)) return false;
    if (mag < this.threshold * this.rearmRatio) this.armed = true;
    const since = tMs - this.lastFire;
    if (!this.armed && since >= this.refractoryMs * 4) this.armed = true;
    if (mag >= this.threshold && this.armed && since >= this.refractoryMs) {
      this.lastFire = tMs;
      this.armed = false;
      return true;
    }
    return false;
  }

  reset(): void {
    this.lastFire = -Infinity;
    this.armed = true;
  }
}

export interface ShakeStep {
  meter: number;
  latched: boolean;
  justLatched: boolean;
}

/** Meter value treated as full (absorbs float error from e.g. the 1.2 s quick-draw fill). */
export const METER_FULL = 1 - 1e-3;

/**
 * The shake meter: fills with energy above the deadzone, decays when below it unless
 * latched, and latches once full. `meter` and `latched` are public so the caller can sync them
 * with `rt.shake` (the controller may force or clear them).
 */
export class ShakeIntegrator {
  meter = 0;
  latched = false;
  constructor(private readonly cfg: SensorCfg) {}

  step(mag: number, dt: number, boost = 1): ShakeStep {
    const c = this.cfg;
    const m = Number.isFinite(mag) ? Math.max(0, mag) : 0;
    const d = Number.isFinite(dt) && dt > 0 ? dt : 0;
    let justLatched = false;
    if (!this.latched) {
      if (m > c.deadzone) {
        this.meter += ((m - c.deadzone) * d * Math.max(0, boost)) / c.fillDivisor;
      } else {
        this.meter -= c.decayPerSec * d;
      }
      this.meter = clamp(this.meter, 0, 1);
      if (this.meter >= METER_FULL) {
        this.meter = 1;
        this.latched = true;
        justLatched = true;
      }
    } else {
      this.meter = 1;
    }
    return { meter: this.meter, latched: this.latched, justLatched };
  }

  reset(): void {
    this.meter = 0;
    this.latched = false;
  }
}

/** Visual shake energy 0..1 from a low-passed magnitude. */
export function energyFrom(magLP: number, deadzone: number): number {
  return clamp((magLP - deadzone) / 12, 0, 1);
}

/** Pseudo magnitude for a Space/long-press hold: fills the meter in `holdFillSec`. */
export function holdMag(cfg: SensorCfg): number {
  return cfg.deadzone + cfg.fillDivisor / cfg.holdFillSec;
}

/** Pseudo magnitude for a quick draw: fills the meter in `quickDrawSec`. */
export function quickMag(cfg: SensorCfg): number {
  return cfg.deadzone + cfg.fillDivisor / cfg.quickDrawSec;
}

/** Pointer-grab pseudo magnitude from an acceleration in viewport-heights/s². */
export function pointerMag(accelVhPerS2: number, scale: number): number {
  if (!Number.isFinite(accelVhPerS2)) return 0;
  return clamp(Math.abs(accelVhPerS2) * scale, 0, 25);
}

/** Whether a forward lean (degrees) earns the 「微微前倾」 boost. */
export function inForwardRange(forwardDeg: number, range: readonly [number, number]): boolean {
  return forwardDeg >= range[0] && forwardDeg <= range[1];
}

/** Shortest signed difference a − b for angles in degrees, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

// ───────────────────────── 体感手感 (visual feel) conditioning ─────────────────────────

export type FeelCfg = SensorCfg['feel'];
export type FeelPreset = FeelCfg['presets'][MotionSensitivity];

/** Preset for a (possibly unsanitized) Settings.motionSensitivity value; anything unknown → 'mid'. */
export function feelPreset(cfg: FeelCfg, key: unknown): FeelPreset {
  return key === 'low' || key === 'high' ? cfg.presets[key] : cfg.presets.mid;
}

const kTau = (dtSec: number, tau: number): number => (tau > 0 ? 1 - Math.exp(-Math.max(0, dtSec) / tau) : 1);

/**
 * "Is the user deliberately shaking?" gate for the visual drive (never the meter). Amplitude-based on
 * an RMS envelope of |lin| (tremor ≲ 1.4, walking ≲ 2.9, light shake ≥ 4, vigorous 10–16 m/s²):
 *
 *  env   = √LP(|lin|², envTau)
 *  floor = noise floor (falls with floorFallTau, rises with floorRiseTau), updated only while closed
 *  on    = clamp(onMin + floorK·floor, onMin, onMax), off = offRatio·on   (hysteresis)
 *  open  ← env > on; closed ← env < off for holdMs
 *  want  = open ? smoothstep((env − off)/(on + kneeSpan − off)) : 0     (soft knee)
 *  gain  → want with attackTau / releaseTau
 *
 * Thresholds come from the preset passed to every push, so a settings change applies immediately.
 */
export class IntentGate {
  env = 0;
  floor: number;
  open = false;
  gain = 0;
  private msq = 0;
  private belowMs = 0;
  constructor(private readonly cfg: FeelCfg) {
    this.floor = cfg.floorInit;
  }

  /** Push one |lin| sample (m/s²) that arrived `dtSec` after the previous one; returns the gain 0..1. */
  push(mag: number, dtSec: number, p: FeelPreset): number {
    const c = this.cfg;
    const m = Number.isFinite(mag) ? mag : 0;
    const d = Number.isFinite(dtSec) && dtSec > 0 ? Math.min(dtSec, 0.25) : 0;
    this.msq += kTau(d, c.envTau) * (m * m - this.msq);
    const env = (this.env = Math.sqrt(Math.max(0, this.msq)));
    if (!this.open) this.floor += kTau(d, env < this.floor ? c.floorFallTau : c.floorRiseTau) * (env - this.floor);
    const on = clamp(p.onMin + c.floorK * this.floor, p.onMin, p.onMax);
    const off = on * c.offRatio;
    if (!this.open) {
      if (env > on) {
        this.open = true;
        this.belowMs = 0;
      }
    } else if (env < off) {
      this.belowMs += d * 1000;
      if (this.belowMs >= c.holdMs) this.open = false;
    } else {
      this.belowMs = 0;
    }
    let want = 0;
    if (this.open) {
      const u = clamp((env - off) / Math.max(1e-6, on + p.kneeSpan - off), 0, 1);
      want = u * u * (3 - 2 * u);
    }
    this.gain += kTau(d, want > this.gain ? c.attackTau : c.releaseTau) * (want - this.gain);
    if (this.gain < 1e-4) this.gain = 0;
    return this.gain;
  }

  reset(): void {
    this.msq = this.env = this.gain = this.belowMs = 0;
    this.open = false;
    this.floor = this.cfg.floorInit;
  }
}

/** Cubic-onset soft deadzone: ≈ x³/(3D²) for |x| ≪ D, x − D·sign(x) for |x| ≫ D. */
export function softDeadzone(x: number, d: number): number {
  return d > 0 ? x - d * Math.tanh(x / d) : x;
}

/**
 * Visual tilt (degrees in, degrees out): lean relative to a neutral that re-centres with τ
 * `tiltRecenterSec` (first-order ⇒ monotonic return, no overshoot), through a RADIAL soft deadzone
 * (diagonal tilts are treated like axis-aligned ones), times `tiltGain`. Allocation-free: the result
 * is written to `x`/`y`.
 */
export class TiltConditioner {
  x = 0;
  y = 0;
  private nx = 0;
  private ny = 0;

  push(lx: number, ly: number, dtSec: number, p: FeelPreset): void {
    const d = Number.isFinite(dtSec) && dtSec > 0 ? Math.min(dtSec, 0.25) : 0;
    const k = kTau(d, p.tiltRecenterSec);
    this.nx += k * (lx - this.nx);
    this.ny += k * (ly - this.ny);
    const rx = lx - this.nx;
    const ry = ly - this.ny;
    const r = Math.hypot(rx, ry);
    const s = r > 1e-9 ? (softDeadzone(r, p.tiltDeadzoneDeg) / r) * p.tiltGain : 0;
    this.x = rx * s;
    this.y = ry * s;
  }

  /** New neutral = current lean (call whenever the orientation baseline is re-taken). */
  reset(lx = 0, ly = 0): void {
    this.nx = lx;
    this.ny = ly;
    this.x = this.y = 0;
  }
}
