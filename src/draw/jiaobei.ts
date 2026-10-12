/**
 * 掷筊. The outcome is rolled first; scripted arcs then land each block on its target
 * quaternion. Block geometry: crescent in the XY plane, extruded along Z; the bulged +Z side is the
 * red "round" face, the −Z side is the flat wooden face.
 *
 * 圣筊 = one flat + one round face up · 笑筊 = both flat up · 阴筊 = both round up.
 */
import type { JiaobeiOutcome, Pose, Quat, Vec3 } from '@/types';
import { CFG } from '@/config';
import { DEG, clamp01, lerp, qAxisAngle, qMul, qNormalize, qRotate, qSlerp, smoothstep, vNorm } from '@/draw/math';
import { cryptoSource, sfc32FromString, uniformFloat, weightedPick, type RandomSource } from '@/lib/rng';

const ORDER: readonly JiaobeiOutcome[] = ['sheng', 'xiao', 'yin'];

const X: Vec3 = [1, 0, 0];
const Y: Vec3 = [0, 1, 0];
/** Flat (−Z) face up. */
const FLAT_UP: Quat = qAxisAngle(X, 90 * DEG);
/** Round (+Z) face up. */
const ROUND_UP: Quat = qAxisAngle(X, -90 * DEG);

export const JIAOBEI_TIMING = { flight: 0.9, rock: 0.5, stagger: 0.08, settleFrac: 0.3, apex: 0.5 } as const;
/** Seconds from throw until both blocks are at rest. */
export const JIAOBEI_DURATION = JIAOBEI_TIMING.flight + JIAOBEI_TIMING.rock + JIAOBEI_TIMING.stagger;

const START: [Vec3, Vec3] = [
  [-0.05, 1.25, 0.08],
  [0.05, 1.28, 0.06],
];
const END: [Vec3, Vec3] = [
  [-0.22, 0.02, 0.72],
  [0.22, 0.02, 0.72],
];
/** Bounces after first contact: [start, duration, height]. */
const BOUNCES: readonly [number, number, number][] = [
  [0, 0.16, 0.03],
  [0.16, 0.1, 0.008],
];

export function rollJiaobei(src: RandomSource = cryptoSource): JiaobeiOutcome {
  const odds = CFG.odds.jiaobei;
  return ORDER[
    Math.max(
      0,
      weightedPick(ORDER, (o) => odds[o], src),
    )
  ]!;
}

function yawed(base: Quat, yaw: number): Quat {
  return qNormalize(qMul(qAxisAngle(Y, yaw), base));
}

/** Target resting quaternions for both blocks (random yaw; which block is flat in 圣筊 is random). */
export function jiaobeiTargets(o: JiaobeiOutcome, src: RandomSource = cryptoSource): [Quat, Quat] {
  let a: Quat;
  let b: Quat;
  if (o === 'xiao') {
    a = FLAT_UP;
    b = FLAT_UP;
  } else if (o === 'yin') {
    a = ROUND_UP;
    b = ROUND_UP;
  } else if (uniformFloat(src) < 0.5) {
    a = FLAT_UP;
    b = ROUND_UP;
  } else {
    a = ROUND_UP;
    b = FLAT_UP;
  }
  const ya = uniformFloat(src) * Math.PI * 2;
  const yb = uniformFloat(src) * Math.PI * 2;
  return [yawed(a, ya), yawed(b, yb)];
}

/** Which face of a block points up for a given orientation. */
export function faceUp(q: Quat): 'flat' | 'round' {
  return qRotate(q, [0, 0, 1])[1] > 0 ? 'round' : 'flat';
}

/** Outcome implied by two resting orientations. */
export function outcomeOf(targets: [Quat, Quat]): JiaobeiOutcome {
  const a = faceUp(targets[0]);
  const b = faceUp(targets[1]);
  if (a !== b) return 'sheng';
  return a === 'flat' ? 'xiao' : 'yin';
}

interface BlockParams {
  axis: Vec3;
  turns: number;
  q0: Quat;
  rockAxis: Vec3;
}

let cacheSeed = NaN;
let cacheParams: [BlockParams, BlockParams] | null = null;

function paramsFor(seed: number): [BlockParams, BlockParams] {
  if (cacheParams && cacheSeed === seed) return cacheParams;
  const src = sfc32FromString(`jiaobei|${seed}`);
  const one = (): BlockParams => {
    const axis = vNorm([uniformFloat(src) * 2 - 1, uniformFloat(src) * 0.6 - 0.3, uniformFloat(src) * 2 - 1]);
    const turns = 2 + uniformFloat(src);
    const q0 = qNormalize(qMul(qAxisAngle(Y, uniformFloat(src) * Math.PI * 2), qAxisAngle(X, (uniformFloat(src) - 0.5) * 1.2)));
    const ra = uniformFloat(src) * Math.PI * 2;
    return { axis, turns, q0, rockAxis: [Math.cos(ra), 0, Math.sin(ra)] };
  };
  cacheParams = [one(), one()];
  cacheSeed = seed;
  return cacheParams;
}

function blockPose(k: 0 | 1, target: Quat, prm: BlockParams, tk: number): { pose: Pose; impacts: number } {
  const T = JIAOBEI_TIMING;
  const start = START[k];
  const end = END[k];
  if (tk <= 0) return { pose: { p: [start[0], start[1], start[2]], q: prm.q0 }, impacts: 0 };
  if (tk < T.flight) {
    const tau = tk / T.flight;
    const p: Vec3 = [lerp(start[0], end[0], tau), lerp(start[1], end[1], tau) + T.apex * 4 * tau * (1 - tau), lerp(start[2], end[2], tau)];
    const spin = qNormalize(qMul(qAxisAngle(prm.axis, prm.turns * Math.PI * 2 * tau), prm.q0));
    const w = smoothstep((tau - (1 - T.settleFrac)) / T.settleFrac);
    return { pose: { p, q: qSlerp(spin, target, w) }, impacts: 0 };
  }
  const s = tk - T.flight;
  if (s >= T.rock) return { pose: { p: [end[0], end[1], end[2]], q: target }, impacts: 1 + BOUNCES.length };
  let y = end[1];
  let impacts = 1;
  for (const [b0, dur, h] of BOUNCES) {
    if (s >= b0 + dur) impacts++;
    else if (s >= b0) y = end[1] + h * Math.sin((Math.PI * (s - b0)) / dur);
  }
  const tail = 1 - smoothstep((s - T.rock * 0.6) / (T.rock * 0.4));
  const rock = 0.22 * Math.exp(-6 * s) * Math.sin(18 * s) * tail;
  const q = qNormalize(qMul(qAxisAngle(prm.rockAxis, rock), target));
  return { pose: { p: [end[0], y, end[2]], q }, impacts };
}

/**
 * Both blocks at t seconds after the throw. `landedCount` counts first contacts (0..2);
 * `impacts` counts every contact including bounces (emit `jiaobei-land` when it increases).
 */
export function sampleJiaobei(
  targets: [Quat, Quat],
  seed: number,
  t: number,
): { poses: [Pose, Pose]; landedCount: number; impacts: number; done: boolean } {
  const prm = paramsFor(seed);
  const a = blockPose(0, targets[0], prm[0], t);
  const b = blockPose(1, targets[1], prm[1], t - JIAOBEI_TIMING.stagger);
  const landed = (t >= JIAOBEI_TIMING.flight ? 1 : 0) + (t - JIAOBEI_TIMING.stagger >= JIAOBEI_TIMING.flight ? 1 : 0);
  return {
    poses: [a.pose, b.pose],
    landedCount: landed,
    impacts: a.impacts + b.impacts,
    done: t >= JIAOBEI_DURATION,
  };
}

/** Force (0..1) for the n-th impact (first contact loud, bounces softer). */
export function jiaobeiImpactForce(impactIndexWithinBlock: number): number {
  return clamp01(0.9 / (1 + impactIndexWithinBlock * 1.6));
}
