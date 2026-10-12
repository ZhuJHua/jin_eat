/**
 * Tier-0 sticks: no WASM, just a procedural rattle composed with the tube pose. Each stick pivots on
 * its foot by its base lean plus a lean shared by the whole bundle and its own `noise(t·(5+i·0.37))`
 * wobble on two axes, and bobs by `energy·0.01`; the leans are pushed apart where two sticks would
 * pass through each other and clamped so no stick ever crosses the rim. Synthetic clacks follow a
 * Poisson process at `25·energy` per second. Also used on tiers 1–2 until the physics chunk is ready,
 * so sticks are never frozen.
 *
 * `initialStickPosesLocal` / `restSlotLocal` define the shared resting layout (also used to place
 * physics bodies and as the hero's return slot).
 */
import { Quaternion, Vector3 } from 'three';
import type { Pose } from '@/types';
import { CFG } from '@/config';
import { bus } from '@/lib/bus';
import { rt } from '@/state/runtime';
import { isOwnedStick } from '@/three/physics/bridge';
import { tubeSpeed } from '@/three/TubeDriver';
import { STRIDE } from './poseBuffer';

const HALF = CFG.stick.size[1] / 2;
const REST_Y = CFG.tube.floorY + HALF + 0.01;
/** Height above the floor where a stick crosses the rim. */
const RIM_SPAN = CFG.tube.rimY - CFG.tube.floorY;
/** Max radius of a stick's axis at rim height (inner wall minus half the stick width and a margin). */
const RIM_R = CFG.tube.innerR - 0.035;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const DROP_FROM = 1.4;
/** Rattle lean amplitudes (per metre of height, at full energy): shared by the bundle, per stick. */
const JIT_SHARED = 0.11;
const JIT_OWN = 0.06;

function rng(seed: number): () => number {
  let a = seed >>> 0 || 0x9e3779b9;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _up = new Vector3(0, 1, 0);
const _dir = new Vector3();
const _qa = new Quaternion();
const _qb = new Quaternion();
const _v = new Vector3();
const _tv = new Vector3();
const _tq = new Quaternion();

/**
 * Lean vector (tx, tz) = horizontal displacement per metre of height. Clamp so the stick's axis at rim
 * height stays within RIM_R of the tube axis. Writes back into `out`.
 */
function clampLean(bx: number, bz: number, tx: number, tz: number, out: { x: number; z: number }): void {
  let rx = bx + tx * RIM_SPAN;
  let rz = bz + tz * RIM_SPAN;
  const r = Math.hypot(rx, rz);
  if (r > RIM_R) {
    rx *= RIM_R / r;
    rz *= RIM_R / r;
  }
  out.x = (rx - bx) / RIM_SPAN;
  out.z = (rz - bz) / RIM_SPAN;
}

const _lean = { x: 0, z: 0 };

/** q = fromUnitVectors(up, normalize(tx, 1, tz)) · Ry(yaw) */
function leanQuat(tx: number, tz: number, yaw: number, out: Quaternion): Quaternion {
  _dir.set(tx, 1, tz).normalize();
  _qa.setFromUnitVectors(_up, _dir);
  _qb.setFromAxisAngle(_up, yaw);
  return out.multiplyQuaternions(_qa, _qb);
}

/** Resting layout in tube-local space: a jittered sunflower inside r < 0.17, upright ±4° lean. */
export function initialStickPosesLocal(count: number, seed: number): Pose[] {
  const n = Math.max(0, Math.floor(count));
  const rand = rng(seed);
  const out: Pose[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.min(0.17, 0.155 * Math.sqrt((i + 0.5) / Math.max(1, n)) + (rand() - 0.5) * 0.012);
    const a = i * GOLDEN + (rand() - 0.5) * 0.25;
    const bx = Math.cos(a) * r;
    const bz = Math.sin(a) * r;
    // Outward lean up to ~6° plus some random wander (clamped at the rim below).
    const lean = Math.tan(((6 * Math.PI) / 180) * (r / 0.17));
    let tx = Math.cos(a) * lean + (rand() - 0.5) * 0.09;
    let tz = Math.sin(a) * lean + (rand() - 0.5) * 0.09;
    clampLean(bx, bz, tx, tz, _lean);
    tx = _lean.x;
    tz = _lean.z;
    const yaw = (rand() - 0.5) * 1.6;
    leanQuat(tx, tz, yaw, _tq);
    // Pivot on the foot: centre = foot + dir·HALF.
    const footY = REST_Y - HALF;
    _dir.set(tx, 1, tz).normalize();
    out.push({
      p: [bx + _dir.x * HALF, footY + _dir.y * HALF, bz + _dir.z * HALF],
      q: [_tq.x, _tq.y, _tq.z, _tq.w],
    });
  }
  return out;
}

// ───────────────────────────── jitter state ─────────────────────────────

const LAYOUT_SEED = 0x51ab;
let layoutCount = -1;
/** Per stick: foot x, foot z, base lean x, base lean z, yaw, phase. */
let layout = new Float32Array(0);
/** performance.now() when a newly added stick started dropping in (0 = settled). */
let dropStart = new Float64Array(0);
let lastVersion = -1;
let prevCount = 0;

function rebuildLayout(count: number): void {
  const poses = initialStickPosesLocal(count, LAYOUT_SEED);
  layout = new Float32Array(count * 6);
  const ds = new Float64Array(count);
  ds.set(dropStart.subarray(0, Math.min(count, dropStart.length)));
  dropStart = ds;
  for (let i = 0; i < count; i++) {
    const p = poses[i]!;
    _tq.set(p.q[0], p.q[1], p.q[2], p.q[3]);
    _v.set(0, 1, 0).applyQuaternion(_tq);
    const foot = [p.p[0] - _v.x * HALF, p.p[2] - _v.z * HALF];
    const o = i * 6;
    layout[o] = foot[0]!;
    layout[o + 1] = foot[1]!;
    layout[o + 2] = _v.x / _v.y;
    layout[o + 3] = _v.z / _v.y;
    // Recover yaw: remove the lean and read the rotation about Y.
    _dir.set(_v.x, _v.y, _v.z);
    _qa.setFromUnitVectors(_up, _dir).invert();
    _qb.multiplyQuaternions(_qa, _tq);
    layout[o + 4] = 2 * Math.atan2(_qb.y, _qb.w);
    layout[o + 5] = i * 1.618 + 0.3;
  }
  layoutCount = count;
}

const MAX_STICKS = CFG.limits.maxRestaurants;
/** Per-stick lean (x, z) of this frame, before the rim clamp; and whether it takes part in separation. */
const leanBuf = new Float32Array(MAX_STICKS * 2);
const sepOn = new Uint8Array(MAX_STICKS);
/**
 * Min horizontal distance between two stick axes at equal height: the visual cross-section's
 * half-diagonal (≈0.0233) twice, plus a little margin. A capsule bound, so it holds for any yaw.
 */
const SEP_D = Math.hypot(CFG.stick.size[0], CFG.stick.size[2]) + 0.004;
/** Height (above the feet) of the axes' vertical extent used for the separation test. */
const SEP_H = CFG.stick.size[1] * 0.98;

/**
 * Tier 0 has no collisions, so push apart any two sticks whose axes come closer than SEP_D: each
 * axis is foot + (lx, 1, lz)·y, so their horizontal gap at height y is linear in y; find the closest
 * height and tilt both leans apart there. A few Gauss-Seidel passes, each followed by the rim clamp;
 * deterministic and continuous in the input leans, so the rattle stays smooth.
 */
function separateLeans(n: number): void {
  for (let pass = 0; pass < 5; pass++) {
    let any = false;
    for (let i = 0; i < n; i++) {
      if (!sepOn[i]) continue;
      const oi = i * 6;
      for (let j = i + 1; j < n; j++) {
        if (!sepOn[j]) continue;
        const oj = j * 6;
        const d0x = layout[oi]! - layout[oj]!;
        const d0z = layout[oi + 1]! - layout[oj + 1]!;
        const dlx = leanBuf[i * 2]! - leanBuf[j * 2]!;
        const dlz = leanBuf[i * 2 + 1]! - leanBuf[j * 2 + 1]!;
        const dl2 = dlx * dlx + dlz * dlz;
        let y = dl2 > 1e-12 ? -(d0x * dlx + d0z * dlz) / dl2 : SEP_H;
        y = y < 0 ? 0 : y > SEP_H ? SEP_H : y;
        if (y < 0.05) continue;
        let gx = d0x + dlx * y;
        let gz = d0z + dlz * y;
        const g = Math.hypot(gx, gz);
        if (g >= SEP_D) continue;
        if (g < 1e-6) {
          // Axes cross exactly: separate along the feet's offset.
          const f = Math.hypot(d0x, d0z) || 1;
          gx = d0x / f;
          gz = d0z / f;
        } else {
          gx /= g;
          gz /= g;
        }
        const k = Math.min(0.15, (SEP_D - g) / (2 * y));
        leanBuf[i * 2] = leanBuf[i * 2]! + gx * k;
        leanBuf[i * 2 + 1] = leanBuf[i * 2 + 1]! + gz * k;
        leanBuf[j * 2] = leanBuf[j * 2]! - gx * k;
        leanBuf[j * 2 + 1] = leanBuf[j * 2 + 1]! - gz * k;
        any = true;
      }
    }
    if (!any) break;
    // Keep the rim limit inside the iteration, so it cannot squeeze separated sticks back together.
    for (let i = 0; i < n; i++) clampLeanAt(i);
  }
}

/** clampLean on leanBuf[i] in place. */
function clampLeanAt(i: number): void {
  const o = i * 6;
  clampLean(layout[o]!, layout[o + 1]!, leanBuf[i * 2]!, leanBuf[i * 2 + 1]!, _lean);
  leanBuf[i * 2] = _lean.x;
  leanBuf[i * 2 + 1] = _lean.z;
}

/** Smooth noise in roughly [−1, 1]. */
function noise(t: number, ph: number): number {
  return Math.sin(t + ph) * 0.55 + Math.sin(t * 2.17 + ph * 1.9 + 1.3) * 0.3 + Math.sin(t * 4.03 + ph * 3.1 + 2.9) * 0.15;
}

/** Reused bus payload (handlers read it synchronously). */
const clack = { force: 0 };

/** Tube-local resting pose of stick `i` (used as the hero's return slot). */
export function restSlotLocal(i: number, out: Pose): Pose {
  const count = rt.sticks.count;
  if (layoutCount !== count) rebuildLayout(count);
  const o = i * 6;
  const fx = layout[o] ?? 0;
  const fz = layout[o + 1] ?? 0;
  const lx = layout[o + 2] ?? 0;
  const lz = layout[o + 3] ?? 0;
  leanQuat(lx, lz, layout[o + 4] ?? 0, _tq);
  _dir.set(lx, 1, lz).normalize();
  out.p[0] = fx + _dir.x * HALF;
  out.p[1] = REST_Y - HALF + _dir.y * HALF;
  out.p[2] = fz + _dir.z * HALF;
  out.q[0] = _tq.x;
  out.q[1] = _tq.y;
  out.q[2] = _tq.z;
  out.q[3] = _tq.w;
  return out;
}

/** Tier-0 rattle: writes world poses of all non-owned sticks into rt.sticks.poses. */
export function stepSticksJitter(dt: number, now: number): void {
  const s = rt.sticks;
  const count = s.count;
  if (s.version !== lastVersion) {
    if (count > prevCount && lastVersion !== -1) {
      if (layoutCount !== count) rebuildLayout(count);
      for (let i = prevCount; i < count; i++) dropStart[i] = now;
    }
    lastVersion = s.version;
    prevCount = count;
  }
  if (layoutCount !== count) rebuildLayout(count);

  const energy = Math.min(1, Math.max(rt.shake.energy, tubeSpeed() * 1.6));
  const t = now / 1000;
  const tube = rt.tube.actual;
  _tv.set(tube.p[0], tube.p[1], tube.p[2]);
  _tq.set(tube.q[0], tube.q[1], tube.q[2], tube.q[3]);
  const buf = s.poses;
  const dec = rt.decoy;

  // The bundle sloshes together (a shared lean) with a smaller per-stick wobble on top: fully
  // independent leans would swing neighbouring sticks through each other (there are no collisions).
  const shX = energy * JIT_SHARED * noise(t * 5.6, 0.7);
  const shZ = energy * JIT_SHARED * noise(t * 6.1, 3.1);
  const n = Math.min(count, MAX_STICKS);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const ph = layout[o + 5]!;
    const f = 5 + i * 0.37;
    leanBuf[i * 2] = layout[o + 2]! + shX + energy * JIT_OWN * noise(t * f, ph);
    leanBuf[i * 2 + 1] = layout[o + 3]! + shZ + energy * JIT_OWN * noise(t * f * 1.09, ph + 2.4);
    // Owned (scripted) and dropping sticks are not part of the bundle.
    sepOn[i] = isOwnedStick(i, s.hidden, dec.active, dec.index) || (dropStart[i] ?? 0) > 0 ? 0 : 1;
    clampLeanAt(i);
  }
  separateLeans(n);

  for (let i = 0; i < n; i++) {
    if (isOwnedStick(i, s.hidden, dec.active, dec.index)) continue;
    const o = i * 6;
    const fx = layout[o]!;
    const fz = layout[o + 1]!;
    const ph = layout[o + 5]!;
    const f = 5 + i * 0.37;
    // Already within the rim limit (clamped by the separation passes).
    const lx = leanBuf[i * 2]!;
    const lz = leanBuf[i * 2 + 1]!;
    let bob = energy * 0.01 * (0.5 + 0.5 * noise(t * f * 1.7, ph + 5.1));

    // New sticks drop in from above with a small bounce.
    const d0 = dropStart[i] ?? 0;
    if (d0 > 0) {
      const tt = (now - d0) / 1000;
      const fall = DROP_FROM - REST_Y;
      const tHit = Math.sqrt((2 * fall) / 9.81);
      if (tt < tHit) bob += fall - 0.5 * 9.81 * tt * tt;
      else if (tt < tHit + 0.22) {
        const u = tt - tHit;
        bob += Math.max(0, 1.1 * u - 0.5 * 9.81 * u * u);
      } else dropStart[i] = 0;
    }

    leanQuat(lx, lz, layout[o + 4]!, _qb);
    _dir.set(lx, 1, lz).normalize();
    _v.set(fx + _dir.x * HALF, REST_Y - HALF + _dir.y * HALF + bob, fz + _dir.z * HALF);
    // World = tube ∘ local.
    _v.applyQuaternion(_tq).add(_tv);
    _qb.premultiply(_tq);
    const w = i * STRIDE;
    buf[w] = _v.x;
    buf[w + 1] = _v.y;
    buf[w + 2] = _v.z;
    buf[w + 3] = _qb.x;
    buf[w + 4] = _qb.y;
    buf[w + 5] = _qb.z;
    buf[w + 6] = _qb.w;
  }

  // Synthetic clacks: Poisson at 25·energy per second.
  if (energy > 0.08 && count > 1 && Math.random() < 1 - Math.exp(-25 * energy * dt)) {
    clack.force = 0.2 + Math.random() * 0.6;
    bus.emit('clack', clack);
  }
}
