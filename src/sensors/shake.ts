/**
 * Shake integrator. `stepShake(dt, now)` runs first in every master-loop frame and
 * unifies every input source into one pseudo magnitude → `rt.shake`:
 *
 * | source            | pseudo mag                              |
 * |-------------------|-----------------------------------------|
 * | phone             | |lin| (screen frame)                    |
 * | pointer grab      | clamp(|Δv|/dt · 0.25, 0, 25), v in vh/s |
 * | hold (Space/long) | 3.5 + 10/1.4 ≈ 10.64                    |
 * | quick draw        | 3.5 + 10/1.2 ≈ 11.83 until `auto.until` |
 *
 * It also maintains stillness, the latch (+ `meter-full`), the visual energy and auto-arming
 * from physical shaking in idle. The trigger rule itself lives in controller.tick.
 */
import { CFG } from '@/config';
import { bus, EMPTY } from '@/lib/bus';
import { rt } from '@/state/runtime';
import { getState } from '@/state/store';
import { beginShake } from '@/draw/controller';
import { alphaForDt, energyFrom, holdMag, inForwardRange, quickMag, ShakeIntegrator } from '@/sensors/filters';

const C = CFG.sensors;
const HOLD_MAG = holdMag(C);
const QUICK_MAG = quickMag(C);
/** Motion samples older than this are treated as no input (sensor paused or stalled). */
const MOTION_STALE_MS = 200;
/** Pointer moves older than this count as a still hand. */
const POINTER_STALE_MS = 90;

const integrator = new ShakeIntegrator(C);
let magLP = 0;
let physicalSustainMs = 0;

export type ShakeInputKind = 'motion' | 'pointer' | 'auto' | 'none';

export interface ShakeSample {
  mag: number;
  /** Strongest contributor. */
  kind: ShakeInputKind;
  /** Physical motion from phone or pointer grab (not auto-shake). */
  physical: number;
  boost: number;
}

const sample: ShakeSample = { mag: 0, kind: 'none', physical: 0, boost: 1 };

/** Gather the unified pseudo magnitude for this frame (reuses one sample object). */
export function readShakeInput(now: number): ShakeSample {
  const inp = rt.input;
  let mag = 0;
  let kind: ShakeInputKind = 'none';
  let physical = 0;

  const mo = inp.motion;
  if (inp.mode === 'motion' && mo.active && now - mo.lastTs < MOTION_STALE_MS) {
    physical = mo.mag;
    mag = mo.mag;
    kind = 'motion';
  }

  const p = inp.pointer;
  if (p.grabbing) {
    const pm = now - p.lastTs < POINTER_STALE_MS ? p.mag : 0;
    if (pm > physical) physical = pm;
    if (pm > mag) {
      mag = pm;
      kind = 'pointer';
    }
  }

  const a = inp.auto;
  if (a.active) {
    const am = a.kind === 'quick' ? (now < a.until ? QUICK_MAG : 0) : HOLD_MAG;
    if (am > mag) {
      mag = am;
      kind = 'auto';
    }
  }

  // The tilt boost only rewards real phone shaking while leaning forward (never the result).
  const boost = kind === 'motion' && inForwardRange(mo.forward, C.forwardRange) ? C.tiltBoost : 1;
  sample.mag = mag;
  sample.kind = kind;
  sample.physical = physical;
  sample.boost = boost;
  return sample;
}

/** Advance the shake state by one frame. `now` is the rAF / performance.now() timestamp in ms. */
export function stepShake(dt: number, now: number): void {
  const s = getState();
  const sh = rt.shake;
  const phase = s.phase;
  const editing = s.drawer !== null;
  const d = Number.isFinite(dt) && dt > 0 ? Math.min(dt, CFG.loop.maxDt) : 0;
  const inp = readShakeInput(now);
  const counting = !editing && (phase === 'idle' || phase === 'armed');
  const mag = counting ? inp.mag : 0;

  // Visual energy follows the unified magnitude (fast attack, slower release).
  const target = mag;
  const a = alphaForDt(target > magLP ? 0.45 : 0.12, d);
  magLP += a * (target - magLP);
  if (magLP < 1e-4) magLP = 0;
  sh.energy = energyFrom(magLP, C.deadzone);

  // Any real input keeps the armed phase alive.
  if (counting && (mag > C.deadzone || rt.input.pointer.grabbing || rt.input.auto.active)) sh.lastInputTs = now;

  // Stillness: the hand (or phone) has calmed down and no auto-shake is running.
  const pointerish = rt.input.mode === 'pointer' || inp.kind === 'pointer' || rt.input.pointer.grabbing;
  const stillThr = pointerish ? C.stillMagPointer : C.stillMag;
  if (!rt.input.auto.active && inp.mag < stillThr) sh.stillMs += d * 1000;
  else sh.stillMs = 0;

  if (phase === 'armed' && !editing) {
    integrator.meter = sh.meter;
    integrator.latched = sh.fullLatched;
    const r = integrator.step(mag, d, inp.boost);
    sh.meter = r.meter;
    sh.fullLatched = r.latched;
    if (r.justLatched) {
      sh.fullSince = now;
      bus.emit('meter-full', EMPTY);
    }
  } else if (phase === 'idle' && sh.meter > 0 && !sh.fullLatched) {
    sh.meter = Math.max(0, sh.meter - C.decayPerSec * 2 * d);
  }

  // idle → armed from physical shaking (phone, or a wiggled pointer grab): the low-passed energy
  // stays above zero for 150 ms. (Raw |a| crosses zero twice per shake cycle, so it can't be used.)
  const physicalSource =
    !rt.input.auto.active &&
    ((rt.input.mode === 'motion' && rt.input.motion.active && now - rt.input.motion.lastTs < MOTION_STALE_MS) || rt.input.pointer.grabbing);
  if (phase === 'idle' && !editing && !s.gate.needed && physicalSource && sh.energy > 0) {
    physicalSustainMs += d * 1000;
  } else {
    physicalSustainMs = 0;
  }
  sh.armSustainMs = physicalSustainMs;
  if (physicalSustainMs >= C.armSustainMs) {
    physicalSustainMs = 0;
    sh.armSustainMs = 0;
    beginShake(rt.input.pointer.grabbing ? 'pointer' : 'motion');
  }
}
