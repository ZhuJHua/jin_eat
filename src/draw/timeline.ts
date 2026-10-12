/**
 * Draw choreography as pure, sampleable functions.
 *
 * Coordinate conventions: metres, Y up, camera looks down −Z. Tube-local space has its origin at the
 * tube base and +Y along the tube axis. The stick box is (0.045 × 1.05 × 0.012) with its text on +Z.
 *
 * How the Director uses this module:
 * - `buildDrawTimeline(input)` once at trigger; `sampleDraw(tl, t)` every frame with t = seconds since
 *   trigger; emit `tl.events` with prevT < e.t ≤ t (see `eventsBetween`; start with prevT = −1).
 * - `physicsLanding = true` (tiers 1–2): the timeline ends at `handoffT` with step `'land'` and
 *   `hero: null` from then on. The Director hands the hero to Rapier (using `heroVel` / `heroAngVel`
 *   sampled just before `handoffT`), waits for `rt.hero.landed` (or snaps the hero onto the landing
 *   pose after `CFG.timeline.landMax`), then runs `buildPresent(rt.hero.pose)` and emits bell + burst itself.
 * - `physicsLanding = false` (tier 0) and reduced motion: the timeline is fully scripted through
 *   `'present'` to `'done'`, including thunk, bell and burst events.
 */
import type { CameraShot, Pose, Quat, Vec3 } from '@/types';
import { CFG } from '@/config';
import {
  DEG,
  QI,
  catmullRom,
  clamp01,
  clonePose,
  composePose,
  easeInOutCubic,
  easeOutCubic,
  lerp,
  qAngVel,
  qAxisAngle,
  qMul,
  qNormalize,
  qRotate,
  qSlerp,
  smoothstep,
  vAdd,
  vCross,
  vLerp,
  vNorm,
  vScale,
  vSub,
} from '@/draw/math';

export type DrawStep = 'tilt' | 'tease' | 'creep' | 'hold' | 'pop' | 'arc' | 'land' | 'present' | 'done';

export interface TimelineEvent {
  t: number;
  type: 'scrape' | 'pop' | 'eject' | 'handoff' | 'bell' | 'burst' | 'thunk';
  /** scrape: durationMs · thunk: force 0..1 */
  payload?: number;
}

export interface DrawTimelineInput {
  reducedMotion: boolean;
  tease: boolean;
  physicsLanding: boolean;
  /** World pose of the tube at rest (normally origin / identity). */
  tubeRest: Pose;
  /** Hero stick pose in tube-local space at trigger time. */
  heroStartLocal: Pose;
  /** Decoy stick pose in tube-local space, or null. */
  decoyStartLocal: Pose | null;
  /** World landing pose (see `landingPose()`). */
  landing: Pose;
}

interface ArcData {
  /** Control points: Pm1, P0, Apex, P3, P4. */
  pts: [Vec3, Vec3, Vec3, Vec3, Vec3];
  q0: Quat;
  qX: Quat;
  flipAxis: Vec3;
  flipAngle: number;
  /** Normalised cumulative time at u = k / (len − 1). */
  warp: number[];
}

interface ScriptData {
  popDist: number;
  popEndSpeed: number;
  arc: ArcData | null;
  arcEndPose: Pose | null;
  arcEndVel: Vec3;
  present: PresentTimeline | null;
  reducedFrom: Pose | null;
}

export interface DrawTimeline {
  input: DrawTimelineInput;
  marks: Partial<Record<DrawStep, [number, number]>>;
  /** Seconds since trigger at which the hero becomes a dynamic body; Infinity when there is no handoff. */
  handoffT: number;
  events: TimelineEvent[];
  /** Total scripted length (Infinity for physics landings). */
  duration: number;
  /** Internal precomputed data. */
  script: ScriptData;
}

export interface DrawSample {
  step: DrawStep;
  /** Forward tilt of the tube about world X, radians (toward the camera is positive). */
  tubeTilt: number;
  /** Hero world pose, or null when physics owns it. */
  hero: Pose | null;
  heroVel: Vec3;
  heroAngVel: Vec3;
  /** Visual scale of the hero (reduced-motion fade-in), normally 1. */
  heroScale: number;
  /** Hero opacity 0..1, normally 1. */
  heroOpacity: number;
  /** Decoy world pose during the tease, else null. */
  decoy: Pose | null;
  shot: CameraShot;
  /** Chromatic aberration pulse 0..1 (scale by tier max). */
  ca: number;
  /** Warm flash 0..1. */
  flash: number;
  /** Desktop dolly-zoom factor: 1 → 0.8 (= 28/35); the camera framing maps it per aspect. */
  fovScale: number;
}

const TL = CFG.timeline;
const RIM_Y = CFG.tube.rimY;
const STICK_HALF = CFG.stick.size[1] / 2;
const CLEAR_Y = RIM_Y + STICK_HALF + 0.03;
const ARC_WARP_N = 64;
const VEL_H = 1 / 240;
const X_AXIS: Vec3 = [1, 0, 0];
const Y_AXIS: Vec3 = [0, 1, 0];
const ZERO: Vec3 = [0, 0, 0];
const DESKTOP_FOV_END = CFG.camera.fovDesktop[1] / CFG.camera.fovDesktop[0];

// ───────────────────────────── canonical poses ─────────────────────────────

/** Lying flat on the altar, text face up, top pointing left, yawed by CFG.poses.landing.yawDeg. */
export function landingPose(): Pose {
  const L = CFG.poses.landing;
  const flat = qAxisAngle(X_AXIS, -90 * DEG); // +Z (text) → +Y, +Y (top) → −Z
  const yaw = qAxisAngle(Y_AXIS, (90 + L.yawDeg) * DEG); // −Z → −X (top points left)
  return { p: [L.p[0], L.p[1], L.p[2]], q: qNormalize(qMul(yaw, flat)) };
}

/** Upright, text facing the camera, top tilted back by CFG.poses.present.pitchDeg. */
export function presentPose(): Pose {
  const P = CFG.poses.present;
  return { p: [P.p[0], P.p[1], P.p[2]], q: qAxisAngle(X_AXIS, -P.pitchDeg * DEG) };
}

// ───────────────────────────── helpers ─────────────────────────────

function tubeWorld(rest: Pose, tilt: number): Pose {
  return { p: rest.p, q: qNormalize(qMul(rest.q, qAxisAngle(X_AXIS, tilt))) };
}

function offsetLocal(local: Pose, dx: number, dy: number, dz: number): Pose {
  return { p: [local.p[0] + dx, local.p[1] + dy, local.p[2] + dz], q: local.q };
}

function arcPoint(arc: ArcData, u: number): Vec3 {
  const [pm1, p0, a, p3, p4] = arc.pts;
  if (u < 0.5) return catmullRom(pm1, p0, a, p3, u * 2);
  return catmullRom(p0, a, p3, p4, u * 2 - 1);
}

/** Flip progress: spins hardest right after the pop and levels out before the handoff. */
const flipEase = (u: number): number => 0.88 * (1 - (1 - u) * (1 - u) * (1 - 0.35 * u)) + 0.12 * u;

function arcQuat(arc: ArcData, u: number): Quat {
  const f = flipEase(clamp01(u));
  const base = qSlerp(arc.q0, arc.qX, f);
  return qNormalize(qMul(qAxisAngle(arc.flipAxis, arc.flipAngle * f), base));
}

/** Real-time fraction s → path parameter u using the apex slow-motion warp table. */
function warpU(arc: ArcData, s: number): number {
  const w = arc.warp;
  const x = clamp01(s);
  let lo = 0;
  let hi = w.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (w[mid]! <= x) lo = mid;
    else hi = mid;
  }
  const a = w[lo]!;
  const b = w[hi]!;
  const f = b > a ? (x - a) / (b - a) : 0;
  return (lo + f) / (w.length - 1);
}

function buildWarp(apexScale: number): number[] {
  const speed = (u: number): number => 1 - (1 - apexScale) * Math.exp(-(((u - 0.5) / 0.17) ** 2));
  const out = [0];
  let acc = 0;
  for (let k = 1; k <= ARC_WARP_N; k++) {
    const um = (k - 0.5) / ARC_WARP_N;
    acc += 1 / speed(um);
    out.push(acc);
  }
  return out.map((v) => v / acc);
}

function arcPose(arc: ArcData, s: number): Pose {
  const u = warpU(arc, s);
  return { p: arcPoint(arc, u), q: arcQuat(arc, u) };
}

// ───────────────────────────── spring settle (tier 0 / snap) ─────────────────────────────

const SETTLE = { g: 9.81, restitution: 0.32, omega: 12, tail: 0.25, rock: 0.12 };

interface SettlePlan {
  h: number;
  vy0: number;
  t1: number;
  u1: number;
  d1: number;
  u2: number;
  d2: number;
  end: number;
  impacts: { t: number; speed: number }[];
}

function settlePlan(from: Pose, vel: Vec3, to: Pose): SettlePlan {
  const g = SETTLE.g;
  const h = Math.max(0, from.p[1] - to.p[1]);
  const vy0 = vel[1];
  const t1 = (vy0 + Math.sqrt(vy0 * vy0 + 2 * g * h)) / g;
  const vImp = Math.abs(vy0 - g * t1);
  const u1 = SETTLE.restitution * vImp;
  const d1 = (2 * u1) / g;
  const u2 = SETTLE.restitution * u1;
  const d2 = (2 * u2) / g;
  const end = t1 + d1 + d2 + SETTLE.tail;
  return {
    h,
    vy0,
    t1,
    u1,
    d1,
    u2,
    d2,
    end,
    impacts: [
      { t: t1, speed: vImp },
      { t: t1 + d1, speed: u1 },
      { t: t1 + d1 + d2, speed: u2 },
    ],
  };
}

/** Impact times (seconds after start) and speeds of a spring settle; useful for thunk events. */
export function settleImpacts(from: Pose, vel: Vec3, to: Pose): { t: number; force: number }[] {
  return settlePlan(from, vel, to).impacts.map((i) => ({ t: i.t, force: clamp01(i.speed / 3) }));
}

/** Total length of a spring settle in seconds. */
export function settleDuration(from: Pose, vel: Vec3, to: Pose): number {
  return settlePlan(from, vel, to).end;
}

/**
 * Tier-0 landing: a short ballistic drop with two bounces onto `to`, critically damped horizontal
 * approach and a decaying rock about the stick's long axis. `bounced` = at least one impact so far.
 */
export function springSettle(from: Pose, vel: Vec3, to: Pose, t: number): { pose: Pose; bounced: boolean; done: boolean } {
  const plan = settlePlan(from, vel, to);
  if (t >= plan.end) return { pose: clonePose(to), bounced: true, done: true };
  const tt = Math.max(0, t);
  const g = SETTLE.g;

  let y: number;
  if (tt < plan.t1) y = to.p[1] + plan.h + plan.vy0 * tt - 0.5 * g * tt * tt;
  else if (tt < plan.t1 + plan.d1) {
    const s = tt - plan.t1;
    y = to.p[1] + plan.u1 * s - 0.5 * g * s * s;
  } else if (tt < plan.t1 + plan.d1 + plan.d2) {
    const s = tt - plan.t1 - plan.d1;
    y = to.p[1] + plan.u2 * s - 0.5 * g * s * s;
  } else y = to.p[1];
  y = Math.max(to.p[1], y);

  const w = SETTLE.omega;
  const decay = Math.exp(-w * tt);
  const horiz = (i: 0 | 2): number => {
    const x0 = from.p[i] - to.p[i];
    return to.p[i] + (x0 + (vel[i] + w * x0) * tt) * decay;
  };
  // Fade any residual in the tail so the end is exact.
  const tailK = 1 - smoothstep((tt - (plan.end - SETTLE.tail)) / SETTLE.tail);
  const px = to.p[0] + (horiz(0) - to.p[0]) * tailK;
  const pz = to.p[2] + (horiz(2) - to.p[2]) * tailK;

  const rotK = 1 - decay * (1 + w * tt);
  let q = qSlerp(from.q, to.q, clamp01(rotK + (1 - rotK) * (1 - tailK)));
  if (tt >= plan.t1) {
    const s = tt - plan.t1;
    const rock = SETTLE.rock * Math.exp(-7 * s) * Math.sin(22 * s) * tailK;
    const axis = qRotate(to.q, Y_AXIS);
    q = qNormalize(qMul(qAxisAngle(axis, rock), q));
  }
  return { pose: { p: [px, y, pz], q }, bounced: tt >= plan.t1, done: false };
}

// ───────────────────────────── present / return ─────────────────────────────

export interface PresentTimeline {
  from: Pose;
  to: Pose;
  duration: number;
  /** Vertical rise of the first Bézier handle (m). */
  lift: number;
  /** Vertical offset of the second Bézier handle relative to `to` (m). */
  liftEnd: number;
  fovFrom: number;
  fovTo: number;
}

/** Lift the landed stick and turn it to face the camera; dolly-zoom 1 → 0.8 unless reduced. */
export function buildPresent(from: Pose, reducedMotion: boolean): PresentTimeline {
  return {
    from: clonePose(from),
    to: presentPose(),
    duration: reducedMotion ? TL.reduced.present : TL.present,
    lift: TL.presentLift,
    liftEnd: -0.12,
    fovFrom: 1,
    fovTo: reducedMotion ? 1 : DESKTOP_FOV_END,
  };
}

/** Arc the hero from wherever it is back over the rim and down into `slotLocal` of the resting tube. */
export function buildReturn(from: Pose, tubeRest: Pose, slotLocal: Pose): PresentTimeline {
  const to = composePose(tubeRest, slotLocal);
  const over = CLEAR_Y + 0.1;
  return {
    from: clonePose(from),
    to,
    duration: TL.reset,
    lift: Math.max(0.3, over - from.p[1] + 0.5),
    liftEnd: Math.max(0.3, over - to.p[1] + 0.35),
    fovFrom: 1,
    fovTo: 1,
  };
}

export function samplePresent(p: PresentTimeline, t: number): { pose: Pose; done: boolean; fovScale: number } {
  const tau = p.duration > 0 ? clamp01(t / p.duration) : 1;
  if (tau >= 1) return { pose: clonePose(p.to), done: true, fovScale: p.fovTo };
  const e = easeInOutCubic(tau);
  const a = p.from.p;
  const d = p.to.p;
  const b: Vec3 = [a[0], a[1] + p.lift, a[2]];
  const c: Vec3 = [d[0], d[1] + p.liftEnd, d[2]];
  const m = 1 - e;
  const pos: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    pos[i] = m * m * m * a[i]! + 3 * m * m * e * b[i]! + 3 * m * e * e * c[i]! + e * e * e * d[i]!;
  }
  const rotE = easeInOutCubic(clamp01((tau - 0.1) / 0.8));
  return { pose: { p: pos, q: qSlerp(p.from.q, p.to.q, rotE) }, done: false, fovScale: lerp(p.fovFrom, p.fovTo, e) };
}

// ───────────────────────────── build ─────────────────────────────

export function buildDrawTimeline(i: DrawTimelineInput): DrawTimeline {
  const marks: Partial<Record<DrawStep, [number, number]>> = {};
  const events: TimelineEvent[] = [];
  const script: ScriptData = {
    popDist: 0,
    popEndSpeed: 0,
    arc: null,
    arcEndPose: null,
    arcEndVel: [0, 0, 0],
    present: null,
    reducedFrom: null,
  };

  if (i.reducedMotion) {
    const R = TL.reduced;
    marks.tilt = [0, R.tilt];
    marks.arc = [R.tilt, R.tilt + R.slide];
    const pEnd = R.tilt + R.slide + R.present;
    marks.present = [R.tilt + R.slide, pEnd];
    marks.done = [pEnd, Infinity];
    const rimLocal = { p: [i.heroStartLocal.p[0], CLEAR_Y, i.heroStartLocal.p[2]] as Vec3, q: i.heroStartLocal.q };
    script.reducedFrom = composePose(tubeWorld(i.tubeRest, R.tiltDeg * DEG), rimLocal);
    script.present = buildPresent(i.landing, true);
    events.push({ t: R.tilt, type: 'pop' }, { t: R.tilt, type: 'eject' });
    events.push({ t: R.tilt + R.slide, type: 'thunk', payload: 0.25 });
    events.push({ t: R.tilt + R.slide, type: 'bell' });
    return { input: i, marks, handoffT: Infinity, events, duration: pEnd, script };
  }

  marks.tilt = [0, TL.tilt];
  let t = TL.tilt;
  if (i.tease && i.decoyStartLocal) {
    marks.tease = [t, t + TL.tease];
    events.push({ t, type: 'scrape', payload: Math.round(TL.tease * 0.45 * 1000) });
    t += TL.tease;
  }
  marks.creep = [t, t + TL.creep];
  events.push({ t, type: 'scrape', payload: Math.round(TL.creep * 1000) });
  t += TL.creep;
  marks.hold = [t, t + TL.hold];
  t += TL.hold;
  marks.pop = [t, t + TL.pop];
  events.push({ t, type: 'pop' }, { t, type: 'eject' });
  t += TL.pop;
  marks.arc = [t, t + TL.arc];
  t += TL.arc;
  const arcEnd = t;

  // Pop distance: the stick's bottom must clear the rim.
  const yAfterCreep = i.heroStartLocal.p[1] + TL.creepDist;
  script.popDist = Math.max(0.3, CLEAR_Y - yAfterCreep);

  // Arc geometry from the pop-exit pose (tube fully tilted) to just above the landing.
  const tilted = tubeWorld(i.tubeRest, TL.tiltDeg * DEG);
  const exitLocal = offsetLocal(i.heroStartLocal, 0, TL.creepDist + script.popDist, 0);
  const exit = composePose(tilted, exitLocal);
  const axis = vNorm(qRotate(tilted.q, Y_AXIS));
  const p0 = exit.p;
  const p3 = vAdd(i.landing.p, [0, TL.handoffHeight, 0]);
  const apexXZ = vLerp(p0, p3, 0.45);
  const apex: Vec3 = [apexXZ[0], Math.max(p0[1], p3[1]) + 0.26, apexXZ[2]];
  const pm1 = vSub(p0, vScale(axis, 0.5));
  const travel = vSub(p3, p0);
  const horiz = vNorm([travel[0], 0, travel[2]]);
  const p4: Vec3 = [p3[0] + horiz[0] * 0.15, p3[1] - 0.45, p3[2] + horiz[2] * 0.15];
  const flipAxis = vNorm(vCross(Y_AXIS, horiz));
  const flipAngle = TL.arcFlips * 2 * Math.PI;
  const qX = qNormalize(qMul(qAxisAngle(flipAxis, -flipAngle), i.landing.q));
  const arc: ArcData = { pts: [pm1, p0, apex, p3, p4], q0: exit.q, qX, flipAxis, flipAngle, warp: buildWarp(TL.apexTimeScale) };
  script.arc = arc;

  // Match the pop's exit speed to the arc's starting speed (Hermite ease, kept monotonic).
  const s0 = arcPose(arc, 0).p;
  const s1 = arcPose(arc, VEL_H / TL.arc).p;
  const startSpeed = Math.hypot(s1[0] - s0[0], s1[1] - s0[1], s1[2] - s0[2]) / VEL_H;
  script.popEndSpeed = Math.min(startSpeed, (3 * script.popDist) / TL.pop);

  const endPose = arcPose(arc, 1);
  const before = arcPose(arc, 1 - VEL_H / TL.arc);
  script.arcEndPose = endPose;
  script.arcEndVel = vScale(vSub(endPose.p, before.p), 1 / VEL_H);

  if (i.physicsLanding) {
    marks.land = [arcEnd, arcEnd + TL.landMax];
    events.push({ t: arcEnd, type: 'handoff' });
    return { input: i, marks, handoffT: arcEnd, events, duration: Infinity, script };
  }

  const settleLen = settleDuration(endPose, script.arcEndVel, i.landing);
  marks.land = [arcEnd, arcEnd + settleLen];
  for (const imp of settleImpacts(endPose, script.arcEndVel, i.landing)) {
    if (imp.force > 0.03) events.push({ t: arcEnd + imp.t, type: 'thunk', payload: imp.force });
  }
  const presentStart = arcEnd + settleLen;
  script.present = buildPresent(i.landing, false);
  const presentEnd = presentStart + script.present.duration;
  marks.present = [presentStart, presentEnd];
  marks.done = [presentEnd, Infinity];
  events.push({ t: presentStart, type: 'bell' }, { t: presentStart, type: 'burst' });
  events.sort((a, b) => a.t - b.t);
  return { input: i, marks, handoffT: Infinity, events, duration: presentEnd, script };
}

// ───────────────────────────── sample ─────────────────────────────

function inMark(tl: DrawTimeline, step: DrawStep, t: number): boolean {
  const m = tl.marks[step];
  return m !== undefined && t >= m[0] && t < m[1];
}

function stepAt(tl: DrawTimeline, t: number): DrawStep {
  const order: DrawStep[] = ['tilt', 'tease', 'creep', 'hold', 'pop', 'arc', 'land', 'present'];
  for (const s of order) if (inMark(tl, s, t)) return s;
  if (tl.marks.done && t >= tl.marks.done[0]) return 'done';
  if (tl.input.physicsLanding && !tl.input.reducedMotion && t >= tl.handoffT) return 'land';
  return t < 0 ? 'tilt' : 'done';
}

function tubeTiltAt(tl: DrawTimeline, t: number): number {
  if (tl.input.reducedMotion) {
    const R = TL.reduced;
    const max = R.tiltDeg * DEG;
    if (t < R.tilt) return max * easeInOutCubic(t / R.tilt);
    return max * (1 - easeInOutCubic((t - R.tilt) / R.slide));
  }
  const max = TL.tiltDeg * DEG;
  if (t < TL.tilt) return max * easeInOutCubic(t / TL.tilt);
  const arc = tl.marks.arc!;
  if (t < arc[0]) return max;
  return max * (1 - easeInOutCubic((t - arc[0]) / (TL.arc * 0.6)));
}

/** Hero pose (world) or null when physics owns it. */
function heroPoseAt(tl: DrawTimeline, t: number): Pose | null {
  const i = tl.input;
  const s = tl.script;
  if (i.reducedMotion) {
    const arcM = tl.marks.arc!;
    if (t < arcM[0]) return composePose(tubeWorld(i.tubeRest, tubeTiltAt(tl, t)), i.heroStartLocal);
    if (t < arcM[1]) {
      const tau = (t - arcM[0]) / (arcM[1] - arcM[0]);
      const e = easeInOutCubic(tau);
      const from = s.reducedFrom!;
      const p = vLerp(from.p, i.landing.p, e);
      p[1] += 0.12 * Math.sin(Math.PI * e);
      return { p, q: qSlerp(from.q, i.landing.q, e) };
    }
    const pm = tl.marks.present!;
    return samplePresent(s.present!, t - pm[0]).pose;
  }

  const tilt = tubeTiltAt(tl, t);
  const creep = tl.marks.creep!;
  const hold = tl.marks.hold!;
  const pop = tl.marks.pop!;
  const arcM = tl.marks.arc!;
  const tube = (): Pose => tubeWorld(i.tubeRest, tilt);

  if (t < creep[0]) return composePose(tube(), i.heroStartLocal);
  if (t < creep[1]) {
    const tau = (t - creep[0]) / (creep[1] - creep[0]);
    const dy = TL.creepDist * easeInOutCubic(tau);
    const jit = 0.0035 * Math.sin(tau * Math.PI * 2 * 7) * Math.sin(Math.PI * tau);
    const jitz = 0.002 * Math.sin(tau * Math.PI * 2 * 11 + 1.3) * Math.sin(Math.PI * tau);
    return composePose(tube(), offsetLocal(i.heroStartLocal, jit, dy, jitz));
  }
  if (t < hold[1]) {
    const tau = (t - hold[0]) / (hold[1] - hold[0]);
    const tremble = 0.0025 * Math.sin(tau * Math.PI * 2 * 9) * (1 - tau);
    return composePose(tube(), offsetLocal(i.heroStartLocal, tremble * 0.6, TL.creepDist + tremble, 0));
  }
  if (t < pop[1]) {
    const tau = (t - pop[0]) / (pop[1] - pop[0]);
    // Cubic Hermite: p(0)=0, p'(0)=0, p(1)=D, p'(1)=V·dur.
    const D = s.popDist;
    const VT = s.popEndSpeed * TL.pop;
    const h01 = -2 * tau ** 3 + 3 * tau ** 2;
    const h11 = tau ** 3 - tau ** 2;
    const dy = D * h01 + VT * h11;
    return composePose(tube(), offsetLocal(i.heroStartLocal, 0, TL.creepDist + dy, 0));
  }
  if (t < arcM[1]) return arcPose(s.arc!, (t - arcM[0]) / (arcM[1] - arcM[0]));

  if (i.physicsLanding) return null;

  const land = tl.marks.land!;
  if (t < land[1]) return springSettle(s.arcEndPose!, s.arcEndVel, i.landing, t - land[0]).pose;
  const pm = tl.marks.present!;
  return samplePresent(s.present!, t - pm[0]).pose;
}

/** Sample the draw at t seconds since trigger. The arc runs on the apex slow-motion time-warp. */
export function sampleDraw(tl: DrawTimeline, t: number): DrawSample {
  const tt = Math.max(0, t);
  const i = tl.input;
  const step = stepAt(tl, tt);
  const tubeTilt = step === 'land' || step === 'present' || step === 'done' ? 0 : tubeTiltAt(tl, tt);

  let hero: Pose | null;
  let heroVel: Vec3 = ZERO;
  let heroAngVel: Vec3 = ZERO;
  if (i.physicsLanding && !i.reducedMotion && tt >= tl.handoffT) {
    hero = null;
  } else {
    hero = heroPoseAt(tl, tt);
    // Velocities by backward difference (exact at handoff: samples stay inside the arc).
    const prev = heroPoseAt(tl, Math.max(0, tt - VEL_H));
    if (hero && prev && tt > 0) {
      heroVel = vScale(vSub(hero.p, prev.p), 1 / VEL_H);
      heroAngVel = qAngVel(prev.q, hero.q, VEL_H);
    }
  }

  let decoy: Pose | null = null;
  const tm = tl.marks.tease;
  if (tm && i.decoyStartLocal && tt >= tm[0] && tt < tm[1]) {
    const tau = (tt - tm[0]) / (tm[1] - tm[0]);
    const rise = TL.creepDist * TL.teaseFrac;
    let dy: number;
    if (tau < 0.45) dy = rise * easeOutCubic(tau / 0.45);
    else if (tau < 0.65) dy = rise * (1 + 0.04 * Math.sin(((tau - 0.45) / 0.2) * Math.PI * 4));
    else dy = rise * (1 - easeInOutCubic((tau - 0.65) / 0.35));
    decoy = composePose(tubeWorld(i.tubeRest, tubeTilt), offsetLocal(i.decoyStartLocal, 0, dy, 0));
  }

  let shot: CameraShot;
  if (step === 'present' || step === 'done') shot = 'present';
  else if (step === 'tilt' || step === 'tease') shot = i.reducedMotion ? 'follow' : 'shake';
  else shot = 'follow';

  let ca = 0;
  let flash = 0;
  let fovScale = 1;
  let heroScale = 1;
  let heroOpacity = 1;
  if (!i.reducedMotion) {
    const pop = tl.marks.pop;
    if (pop && tt >= pop[0]) {
      const k = (tt - pop[0]) / TL.caPulse;
      if (k < 1) ca = (1 - k) * (1 - k);
    }
    const pm = tl.marks.present;
    if (pm && tt >= pm[0]) {
      const k = (tt - pm[0]) / 0.5;
      if (k < 1) flash = 0.35 * (1 - k);
      fovScale = samplePresent(tl.script.present!, tt - pm[0]).fovScale;
    }
  } else {
    const arcM = tl.marks.arc!;
    if (tt >= arcM[0] && tt < arcM[1]) {
      const tau = (tt - arcM[0]) / (arcM[1] - arcM[0]);
      heroScale = lerp(0.55, 1, easeOutCubic(tau));
      heroOpacity = clamp01(tau / 0.4);
    }
  }

  return { step, tubeTilt, hero, heroVel, heroAngVel, heroScale, heroOpacity, decoy, shot, ca, flash, fovScale };
}

/**
 * Hero state at the physics handoff (end of the arc): world pose plus matched linear and angular
 * velocity. Null when the timeline has no handoff.
 */
export function heroHandoff(tl: DrawTimeline): { pose: Pose; vel: Vec3; angVel: Vec3 } | null {
  if (!Number.isFinite(tl.handoffT) || !tl.script.arc) return null;
  const end = arcPose(tl.script.arc, 1);
  const before = arcPose(tl.script.arc, 1 - VEL_H / TL.arc);
  return {
    pose: end,
    vel: vScale(vSub(end.p, before.p), 1 / VEL_H),
    angVel: qAngVel(before.q, end.q, VEL_H),
  };
}

/** Events with t0 < e.t ≤ t1 (pass t0 = −1 on the first frame). */
export function eventsBetween(tl: DrawTimeline, t0: number, t1: number): TimelineEvent[] {
  if (t1 <= t0) return [];
  return tl.events.filter((e) => e.t > t0 && e.t <= t1);
}

/** Identity tube-rest pose. */
export const TUBE_REST: Pose = { p: [0, 0, 0], q: QI };
