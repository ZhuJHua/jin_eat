/**
 * Tube driving. Turns the unified input state into the 签筒's world pose:
 *
 *   input → target offset → spring-damper (k 180, c 22) → offset + velocity-lean (+ device tilt)
 *
 * Under the hard inputs (pointer grab, phone shake) the lean pivots about a raised point
 * (CFG.tube.leanPivotY), like a hand holding the tube; the auto-shake and the scripted draw tilt
 * pivot about the base, as the draw timeline assumes.
 *
 * Writes `rt.tube.target` (and `rt.tube.actual`, which the physics step may then overwrite),
 * `rt.tube.vel`, `rt.fx.smokeBend` and `rt.fx.lanternDrive`.
 * While the draw timeline owns the tilt (`rt.tube.scriptedTilt !== null`) the offset springs back to
 * rest and the rotation follows the scripted forward tilt, catching up on any leftover shake lean at
 * a bounded rate (the hero path is computed against a resting tube, so any leftover offset is
 * reported to the Director via `tubeOffset`).
 *
 * Allocation-free: all state lives in module-level scalars.
 */
import type { Pose } from '@/types';
import { CFG } from '@/config';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';

const T = CFG.tube;
const DEG = Math.PI / 180;
const MAX_TILT = T.maxTiltDeg * DEG;
const DEVICE_TILT = T.deviceTiltDeg * DEG;
const MAX_TILT_RATE = T.maxTiltRate;
const LEAN_PER_SPEED = 0.9;
const PIVOT_Y = T.leanPivotY;
const SUBSTEP = 1 / 120;
/** Under the scripted draw tilt: catch-up time constant and max catch-up rate (rad/s) for the
 * leftover shake lean, and the time (s) over which the raised lean pivot fades back to the base.
 * All three settle well within the timeline's 0.4 s tilt step, before the hero path needs them. */
const SCRIPT_CATCHUP_TAU = 0.04;
const SCRIPT_CATCHUP_RATE = 2.5;
const PIVOT_SCRIPT_FADE = 0.25;

// Spring state (tube offset from rest, metres) and its velocity.
let ox = 0;
let oy = 0;
let oz = 0;
let vx = 0;
let vy = 0;
let vz = 0;
// Smoothed rotation (radians): pitch about X (top toward camera = +), roll about Z.
let pitch = 0;
let roll = 0;
// Smoothed device tilt contribution.
let devPitch = 0;
let devRoll = 0;
// Weight of the raised lean pivot: 1 while the tube is grabbed or shaken by the phone, 0 for the
// gentle auto-shake and under the scripted draw tilt (whose hero path assumes a base-pivoted tube).
let pivotW = 0;
// Scripted tilt of the previous frame (null when the timeline did not own the tilt).
let prevScripted: number | null = null;
// Pointer grab anchor.
let wasGrabbing = false;
let grabX = 0;
let grabY = 0;
// Smoothed fx outputs.
let bendX = 0;
let bendZ = 0;

const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
const TAU = Math.PI * 2;

function copyPoseInto(a: Pose, b: Pose): void {
  b.p[0] = a.p[0];
  b.p[1] = a.p[1];
  b.p[2] = a.p[2];
  b.q[0] = a.q[0];
  b.q[1] = a.q[1];
  b.q[2] = a.q[2];
  b.q[3] = a.q[3];
}

/** Small deterministic "jitter" for the auto-shake: a few incommensurate sines. */
function jitter(t: number, phase: number): number {
  return Math.sin(t * 23.7 + phase) * 0.5 + Math.sin(t * 37.1 + phase * 1.7) * 0.3 + Math.sin(t * 51.3 + phase * 2.3) * 0.2;
}

/** Current world offset of the tube from its rest pose (read by the Director for hero continuity). */
export const tubeOffset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

/** input → spring → rt.tube.target. `now` is performance.now() ms. */
export function stepTubeDriver(dt: number, now: number): void {
  const s = getState();
  const phase = s.phase;
  const reduced = s.reducedMotion;
  const scripted = rt.tube.scriptedTilt;
  const interactive =
    scripted === null && s.drawer === null && (phase === 'idle' || phase === 'armed' || phase === 'boot' || phase === 'gate');

  // ── target offset ──
  let tx = 0;
  let ty = 0;
  let tz = 0;
  const ptr = rt.input.pointer;
  const auto = rt.input.auto;
  const motion = rt.input.motion;
  const grabbing = interactive && ptr.grabbing;
  if (grabbing && !wasGrabbing) {
    grabX = ptr.ndc[0];
    grabY = ptr.ndc[1];
  }
  wasGrabbing = grabbing;

  if (interactive) {
    if (grabbing) {
      tx = (ptr.ndc[0] - grabX) * 0.5;
      ty = (ptr.ndc[1] - grabY) * 0.35;
    } else if (auto.active) {
      const ramp = clamp((now - auto.t0) / 200, 0, 1);
      const amp = T.autoAmp * ramp;
      const tt = now / 1000;
      tx = amp * (0.62 * Math.sin(TAU * 6.7 * tt) + 0.38 * Math.sin(TAU * 7.3 * tt + 1.3) + 0.15 * jitter(tt, 0.4));
      tz = amp * 0.6 * (0.7 * Math.sin(TAU * 7.3 * tt + 0.4) + 0.3 * Math.sin(TAU * 6.7 * tt + 2.1) + 0.15 * jitter(tt, 2.2));
      ty = amp * 0.25 * Math.sin(TAU * 13.4 * tt + 0.9);
    } else if (rt.input.mode === 'motion' && motion.active) {
      const g = T.motionGain * (reduced ? 0.3 : 1);
      tx = -motion.lin[0] * g;
      ty = -motion.lin[1] * g;
      tz = -motion.lin[2] * g;
    }
  }
  const mo = T.maxOffset;
  tx = clamp(tx, -mo[0], mo[0]);
  ty = clamp(ty, -mo[1], mo[1]);
  tz = clamp(tz, -mo[2], mo[2]);

  // ── spring-damper, sub-stepped for stability at low frame rates ──
  const steps = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / steps;
  const k = T.k;
  const c = scripted !== null ? T.c * 1.25 : T.c;
  for (let i = 0; i < steps; i++) {
    vx += (k * (tx - ox) - c * vx) * h;
    vy += (k * (ty - oy) - c * vy) * h;
    vz += (k * (tz - oz) - c * vz) * h;
    ox += vx * h;
    oy += vy * h;
    oz += vz * h;
  }
  if (ox > mo[0] || ox < -mo[0]) {
    ox = clamp(ox, -mo[0], mo[0]);
    vx = 0;
  }
  if (oy > mo[1] || oy < -mo[1]) {
    oy = clamp(oy, -mo[1], mo[1]);
    vy = 0;
  }
  if (oz > mo[2] || oz < -mo[2]) {
    oz = clamp(oz, -mo[2], mo[2]);
    vz = 0;
  }
  if (!Number.isFinite(ox + oy + oz + vx + vy + vz)) {
    ox = oy = oz = vx = vy = vz = 0;
  }

  // ── rotation: velocity lean + device tilt, or the scripted tilt ──
  const tilt = motion.tilt;
  const devGain = reduced ? 0.3 : 1;
  // tilt.y > 0: the phone's top edge tipped toward the user → the tube top tips toward the camera (+Rx).
  // tilt.x > 0: the right edge dipped → the tube leans right (+Rz moves the top toward −X, hence −).
  const wantDevPitch = interactive && motion.active ? clamp(tilt.y, -DEVICE_TILT, DEVICE_TILT) * devGain : 0;
  const wantDevRoll = interactive && motion.active ? clamp(-tilt.x, -DEVICE_TILT, DEVICE_TILT) * devGain : 0;
  const kDev = 1 - Math.exp(-dt / 0.12);
  devPitch += (wantDevPitch - devPitch) * kDev;
  devRoll += (wantDevRoll - devRoll) * kDev;

  const leanGain = reduced ? 0.4 : 1;
  const wantPitch = clamp(-vz * LEAN_PER_SPEED * leanGain + devPitch, -MAX_TILT, MAX_TILT);
  const wantRoll = clamp(vx * LEAN_PER_SPEED * leanGain + devRoll, -MAX_TILT, MAX_TILT);
  const kRot = 1 - Math.exp(-dt / 0.04);
  let dPitch: number;
  let dRoll: number;
  if (scripted !== null) {
    // The timeline's hero path assumes a pure forward tilt. Follow the script's own motion exactly
    // (feed-forward) and catch up on the leftover shake lean at a bounded rate, so the hand-over at
    // the start of a draw is a smooth glide even when that frame is a long one (no snap).
    const ff = prevScripted === null ? 0 : scripted - prevScripted;
    const kS = 1 - Math.exp(-dt / SCRIPT_CATCHUP_TAU);
    let cPitch = (scripted - pitch - ff) * kS;
    let cRoll = (0 - roll) * kS;
    const cMax = SCRIPT_CATCHUP_RATE * dt;
    const cLen = Math.hypot(cPitch, cRoll);
    if (cLen > cMax) {
      cPitch *= cMax / cLen;
      cRoll *= cMax / cLen;
    }
    dPitch = ff + cPitch;
    dRoll = cRoll;
  } else {
    dPitch = (wantPitch - pitch) * kRot;
    dRoll = (wantRoll - roll) * kRot;
  }
  // Rate limit: a lean that flips at 15+ rad/s (pointer wiggle, phone shake) sweeps the walls through
  // the sticks faster than the simulation can resolve. The auto-shake peaks below the cap.
  const dMax = MAX_TILT_RATE * dt;
  const dLen = Math.hypot(dPitch, dRoll);
  if (dLen > dMax) {
    dPitch *= dMax / dLen;
    dRoll *= dMax / dLen;
  }
  pitch += dPitch;
  roll += dRoll;
  if (!Number.isFinite(pitch + roll)) pitch = roll = 0;

  // ── write rt.tube.target (q = Rz(roll) · Rx(pitch)) ──
  const tgt = rt.tube.target;
  const hp = pitch / 2;
  const hr = roll / 2;
  const sp = Math.sin(hp);
  const cp = Math.cos(hp);
  const sr = Math.sin(hr);
  const cr = Math.cos(hr);
  // Rz(roll) * Rx(pitch) = (cr*sp, sr*sp, sr*cp, cr*cp)
  tgt.q[0] = cr * sp;
  tgt.q[1] = sr * sp;
  tgt.q[2] = sr * cp;
  tgt.q[3] = cr * cp;
  // Lean about the pivot (0, PIVOT_Y, 0) instead of the base: p = offset + pivot − R·pivot. Blends
  // smoothly between the two pivots, and over a fixed 0.25 s when the timeline takes over the tilt.
  const wantW = scripted === null && (grabbing || (interactive && !auto.active && rt.input.mode === 'motion' && motion.active)) ? 1 : 0;
  if (scripted !== null) {
    // Linear fade over a fixed time: a long frame cannot compress it into one visible jump.
    pivotW = Math.max(0, pivotW - dt / PIVOT_SCRIPT_FADE);
  } else pivotW += (wantW - pivotW) * (1 - Math.exp(-dt / 0.25));
  prevScripted = scripted;
  const pv = PIVOT_Y * pivotW;
  const qx = tgt.q[0];
  const qy = tgt.q[1];
  const qz = tgt.q[2];
  const qw = tgt.q[3];
  tgt.p[0] = ox - pv * 2 * (qx * qy - qw * qz);
  tgt.p[1] = oy + pv * 2 * (qx * qx + qz * qz);
  tgt.p[2] = oz - pv * 2 * (qy * qz + qw * qx);
  // Without physics the tube is exactly where the driver puts it; the simulation (if it runs this
  // frame) overwrites `actual` with its kinematic pose.
  copyPoseInto(tgt, rt.tube.actual);
  rt.tube.vel[0] = vx;
  rt.tube.vel[1] = vy;
  rt.tube.vel[2] = vz;
  // The base's offset from rest (the timeline composes the hero against a base-pivoted tube).
  tubeOffset.x = tgt.p[0];
  tubeOffset.y = tgt.p[1];
  tubeOffset.z = tgt.p[2];

  // ── fx: smoke leans away from motion; lanterns get a gentle push ──
  const kFx = 1 - Math.exp(-dt / 0.25);
  bendX += (clamp(-vx * 0.9, -1, 1) - bendX) * kFx;
  bendZ += (clamp(-vz * 0.9, -1, 1) - bendZ) * kFx;
  rt.fx.smokeBend[0] = bendX;
  rt.fx.smokeBend[1] = bendZ;
  const pointerX = ptr.over || ptr.grabbing ? ptr.ndc[0] : 0;
  rt.fx.lanternDrive[0] = clamp(vx * 1.4 + roll * 0.8 + pointerX * 0.15, -1, 1);
  rt.fx.lanternDrive[1] = clamp(vz * 1.4 - pitch * 0.8, -1, 1);
}

/** Speed of the tube (m/s), handy for visual energy when no sensor energy is available. */
export function tubeSpeed(): number {
  return Math.hypot(vx, vy, vz);
}

/** Snap the driver back to rest (clears module state; used by the sensor tests). */
export function resetTubeDriver(): void {
  ox = oy = oz = vx = vy = vz = 0;
  pitch = roll = devPitch = devRoll = 0;
  pivotW = 0;
  prevScripted = null;
  bendX = bendZ = 0;
  wasGrabbing = false;
  const tgt = rt.tube.target;
  tgt.p[0] = tgt.p[1] = tgt.p[2] = 0;
  tgt.q[0] = tgt.q[1] = tgt.q[2] = 0;
  tgt.q[3] = 1;
  copyPoseInto(tgt, rt.tube.actual);
  rt.tube.vel[0] = rt.tube.vel[1] = rt.tube.vel[2] = 0;
  tubeOffset.x = tubeOffset.y = tubeOffset.z = 0;
}
