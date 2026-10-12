/**
 * The Director: one useFrame (priority −50, before every visual) that runs the
 * whole ritual pipeline in a fixed order each rendered frame:
 *
 *   1. phase logic — idle/armed framing, the draw choreography (timeline sampling, events → bus,
 *      hero hand-offs between scripted / dynamic / snap / present), the reveal rest pose, the 掷筊
 *      throw and the return-to-tube arc; it writes every Director-owned pose;
 *   2. TubeDriver — input → spring → rt.tube.target (or the scripted tilt);
 *   3. physics (`physicsBridge.step`) or, without it, the procedural stick jitter;
 *   4. fx decay (rt.fx, camera impulse shake).
 *
 * Robustness: the hero always ends visible (snap fallback when physics misbehaves, Director-level
 * watchdogs well inside the controller's), and onDrawingDone / onResetDone / onJiaobeiDone always
 * fire. The controller keeps its own watchdogs in case this component is not mounted at all.
 */
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Quaternion, Vector3 } from 'three';
import type { DrawResult, Phase, Pose } from '@/types';
import { CFG } from '@/config';
import { bus, EMPTY } from '@/lib/bus';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { onDrawingDone, onJiaobeiDone, onResetDone } from '@/draw/controller';
import { jiaobeiImpactForce, sampleJiaobei } from '@/draw/jiaobei';
import { clamp01, easeInOutCubic, easeOutCubic, smoothstep } from '@/draw/math';
import {
  TUBE_REST,
  buildDrawTimeline,
  buildPresent,
  buildReturn,
  heroHandoff,
  landingPose,
  presentPose,
  samplePresent,
  sampleDraw,
  type DrawSample,
  type DrawTimeline,
  type PresentTimeline,
  type TimelineEvent,
} from '@/draw/timeline';
import { physicsBridge } from './physics/bridge';
import { stepSticksJitter, restSlotLocal } from './sticks/SticksJitter';
import { copyPose, isFinitePose, newPose, readVQ, vqToPose, writePose } from './sticks/poseBuffer';
import { heroVisual } from './hero/heroVisual';
import { stepTubeDriver, tubeOffset } from './TubeDriver';
import { hitTestTube } from './tube/Tube';
import { attachPointerShake } from '@/sensors/pointer';

const TL = CFG.timeline;
const DEG = Math.PI / 180;
const HALF = CFG.stick.size[1] / 2;
const REST_Y = CFG.tube.floorY + HALF + 0.012;
const LANDING = landingPose();
const PRESENT = presentPose();
const DESK_FOV_END = CFG.camera.fovDesktop[1] / CFG.camera.fovDesktop[0];
const SNAP_MS = 250;
const DRAW_WATCHDOG_EXTRA_MS = 2000;
const DRAW_WATCHDOG_PHYSICS_MS = 7000;
const RESET_WATCHDOG_MS = 2000;
const JIAOBEI_WATCHDOG_MS = 3200;
const IDLE_FOCUS: [number, number, number] = [0, 0.65, 0];

/** The hero rests here, lying on the altar, while 锦少 judges the 筊杯 (clear of the blocks' spot). */
const WITNESS: Pose = (() => {
  const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ((90 - 6) * Math.PI) / 180);
  const flat = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const q = yaw.multiply(flat).normalize();
  return { p: [-0.06, 0.012, 0.44], q: [q.x, q.y, q.z, q.w] };
})();

// ───────────────────────────── scratch ─────────────────────────────

const _v = new Vector3();
const _q = new Quaternion();
const _v2 = new Vector3();
const _q2 = new Quaternion();
const _tv = new Vector3();
const _tq = new Quaternion();
const _lv = new Vector3();
const _lq = new Quaternion();
const _up = new Vector3(0, 1, 0);
const _x = new Vector3(1, 0, 0);
const _pose = newPose();
const _slot = newPose();
// Tube pose before this frame's TubeDriver step and the delta it applied (re-anchoring, below).
const _preV = new Vector3();
const _preQ = new Quaternion();
const _dq = new Quaternion();
const scrapePayload = { durationMs: 0 };
const thunkPayload = { force: 0 };
const landPayload = { force: 0 };
const clack = { force: 0 };

// ───────────────────────────── state ─────────────────────────────

type DrawStage = 'script' | 'dynamic' | 'snap' | 'present' | 'done';

interface DrawRun {
  tl: DrawTimeline;
  t0: number;
  prevT: number;
  physics: boolean;
  reduced: boolean;
  stage: DrawStage;
  stageT0: number;
  idx: number;
  /** Hero tube-local pose at trigger (actual) and the cleaned-up upright start fed to the timeline. */
  startActual: Pose;
  startClean: Pose;
  decoyIdx: number;
  decoyStartLocal: Pose | null;
  /** Decoy tube-local pose captured when the tease actually starts. */
  decoyCaptured: Pose | null;
  handoff: { pose: Pose; vel: [number, number, number]; angVel: [number, number, number] } | null;
  snapFrom: Pose;
  present: PresentTimeline | null;
  lastStep: DrawSample['step'];
}

interface ResetRun {
  t0: number;
  idx: number;
  ret: PresentTimeline;
}

let lastNow = 0;
let lastPhase: Phase | null = null;
/**
 * Director-owned sticks whose world pose this frame was composed against the tube pose of the
 * previous frame (the phase logic runs before TubeDriver): the hero during the tilt step and the
 * teasing decoy. They are carried along by the tube's motion once TubeDriver has stepped.
 */
let anchorHero = -1;
let anchorDecoy = -1;
let draw: DrawRun | null = null;
let reset: ResetRun | null = null;
let pendingResetDone = false;
let revealLocked = false;
let jb = { t0: -1, seed: -1, impacts: 0, doneFired: false };

// ───────────────────────────── helpers ─────────────────────────────

/** The tube pose as last rendered/simulated (`rt.tube.actual`), which stick poses are relative to. */
function tubeTarget(v: Vector3, q: Quaternion): void {
  const t = rt.tube.actual;
  v.set(t.p[0], t.p[1], t.p[2]);
  q.set(t.q[0], t.q[1], t.q[2], t.q[3]);
}

function setHeroPose(p: Pose): void {
  copyPose(p, rt.hero.pose);
}

function setVec3(dst: [number, number, number], x: number, y: number, z: number): void {
  dst[0] = x;
  dst[1] = y;
  dst[2] = z;
}

/** Exponential approach of the hero pose to `target` (time constant tau seconds). */
function dampHero(target: Pose, dt: number, tau: number): void {
  const k = 1 - Math.exp(-dt / Math.max(1e-3, tau));
  const h = rt.hero.pose;
  if (!isFinitePose(h)) copyPose(target, h);
  for (let i = 0; i < 3; i++) h.p[i] = h.p[i]! + (target.p[i]! - h.p[i]!) * k;
  _q.set(h.q[0], h.q[1], h.q[2], h.q[3]).normalize();
  _q2.set(target.q[0], target.q[1], target.q[2], target.q[3]);
  _q.slerp(_q2, k);
  h.q[0] = _q.x;
  h.q[1] = _q.y;
  h.q[2] = _q.z;
  h.q[3] = _q.w;
}

function validIndex(i: number): boolean {
  return Number.isInteger(i) && i >= 0 && i < rt.sticks.count;
}

function unhideAll(): void {
  const h = rt.sticks.hidden;
  for (let i = 0; i < h.length; i++) h[i] = 0;
}

/**
 * Hero stick index for the current result. Resolved from the restaurant id (the stored draw index goes
 * stale when the list is reordered or edited while the scroll is open); the previously hidden slot is
 * released so the right stick disappears from the tube.
 */
function resolveHeroIndex(cur: DrawResult | null): number {
  let idx = -1;
  if (cur) {
    const list = getState().restaurants;
    const i = list[cur.index]?.id === cur.restaurantId ? cur.index : list.findIndex((r) => r.id === cur.restaurantId);
    if (validIndex(i)) idx = i;
  }
  if (!cur && validIndex(rt.hero.index)) idx = rt.hero.index;
  const old = rt.hero.index;
  if (old !== idx && validIndex(old) && old !== rt.decoy.index) rt.sticks.hidden[old] = 0;
  rt.hero.index = idx;
  return idx;
}

/**
 * Upright version of a tube-local stick pose: same yaw, foot on the floor, kept off the wall.
 * With `heroLane` the stick is also steered to the left half of the tube: the arc then travels mostly
 * along +X to the landing spot, so its 1.5 flips turn in the screen plane and the swinging ends stay
 * clear of the barrel.
 */
function cleanStartLocal(actual: Pose, out: Pose, heroLane = false): Pose {
  _q.set(actual.q[0], actual.q[1], actual.q[2], actual.q[3]).normalize();
  // Yaw = twist about Y after removing the swing of the stick axis.
  _v.copy(_up).applyQuaternion(_q);
  _q2.setFromUnitVectors(_up, _v.normalize()).invert();
  _q2.multiply(_q);
  const yaw = 2 * Math.atan2(_q2.y, _q2.w);
  _q.setFromAxisAngle(_up, Number.isFinite(yaw) ? yaw : 0);
  let x = actual.p[0];
  let z = actual.p[2];
  const r = Math.hypot(x, z);
  const rMax = 0.17;
  if (!Number.isFinite(r)) {
    x = 0;
    z = 0;
  } else if (r > rMax) {
    x *= rMax / r;
    z *= rMax / r;
  }
  if (heroLane) {
    x = Math.min(-0.07, Math.max(-0.16, x - 0.1));
    z = Math.max(-0.06, Math.min(0.06, z));
  }
  out.p[0] = x;
  out.p[1] = REST_Y;
  out.p[2] = z;
  out.q[0] = _q.x;
  out.q[1] = _q.y;
  out.q[2] = _q.z;
  out.q[3] = _q.w;
  return out;
}

/** Tube-local pose of stick i from rt.sticks.poses and the current tube target. */
function stickLocal(i: number, out: Pose): Pose {
  tubeTarget(_tv, _tq);
  readVQ(rt.sticks.poses, i, _v, _q);
  _q2.copy(_tq).invert();
  _v.sub(_tv).applyQuaternion(_q2);
  _q.premultiply(_q2);
  return vqToPose(_v, _q, out);
}

/** World pose = current tube ∘ local. */
function tubeCompose(local: Pose, out: Pose): Pose {
  tubeTarget(_tv, _tq);
  _v.set(local.p[0], local.p[1], local.p[2]).applyQuaternion(_tq).add(_tv);
  _q.set(local.q[0], local.q[1], local.q[2], local.q[3]).premultiply(_tq);
  return vqToPose(_v, _q, out);
}

function burst(at: Pose, reduced: boolean): void {
  if (reduced) return;
  rt.fx.dustBurst = 1;
  setVec3(rt.fx.burstOrigin, at.p[0], at.p[1], at.p[2]);
  rt.fx.confettiT0 = performance.now();
}

function bell(): void {
  bus.emit('bell', EMPTY);
  rt.fx.presentBloom = 1;
}

function dampHalo(want: number, dt: number): void {
  const k = 1 - Math.exp(-dt / 0.25);
  heroVisual.halo += (want - heroVisual.halo) * k;
}

// ───────────────────────────── drawing ─────────────────────────────

function enterDrawing(now: number): void {
  const s = getState();
  const cur = s.current;
  const reduced = s.reducedMotion;
  const idx = resolveHeroIndex(cur);

  const startActual = newPose();
  if (idx >= 0) stickLocal(idx, startActual);
  else {
    startActual.p[0] = 0;
    startActual.p[1] = REST_Y;
    startActual.p[2] = 0;
  }
  if (!isFinitePose(startActual)) {
    startActual.p = [0, REST_Y, 0];
    startActual.q = [0, 0, 0, 1];
  }
  const startClean = cleanStartLocal(startActual, newPose(), !reduced);

  let decoyIdx = -1;
  if (!reduced && cur?.tease && cur.decoyIndex !== null && validIndex(cur.decoyIndex) && cur.decoyIndex !== idx && rt.sticks.count >= 2) {
    decoyIdx = cur.decoyIndex;
  }
  const decoyStartLocal = decoyIdx >= 0 ? cleanStartLocal(stickLocal(decoyIdx, newPose()), newPose()) : null;
  rt.decoy.index = decoyIdx;
  rt.decoy.active = false;

  const physics = !reduced && s.tier >= 1 && rt.physicsReady && physicsBridge.step !== null;
  const tl = buildDrawTimeline({
    reducedMotion: reduced,
    tease: decoyIdx >= 0,
    physicsLanding: physics,
    tubeRest: TUBE_REST,
    heroStartLocal: startClean,
    decoyStartLocal,
    landing: LANDING,
  });
  const h = physics ? heroHandoff(tl) : null;

  if (idx >= 0) rt.sticks.hidden[idx] = 1;
  rt.hero.index = idx;
  rt.hero.mode = 'scripted';
  rt.hero.landed = false;
  rt.hero.handoffAt = null;
  tubeCompose(startActual, rt.hero.pose);
  heroVisual.scale = reduced ? 0.55 : 1;
  heroVisual.opacity = 1;
  heroVisual.glow = 0.15;
  heroVisual.halo = 0;
  rt.camera.shot = reduced ? 'follow' : 'shake';
  rt.camera.fovScale = 1;
  rt.camera.dock = 'none';

  draw = {
    tl,
    t0: now,
    prevT: -1,
    physics,
    reduced,
    stage: 'script',
    stageT0: now,
    idx,
    startActual,
    startClean,
    decoyIdx,
    decoyStartLocal,
    decoyCaptured: null,
    handoff: h ? { pose: h.pose, vel: h.vel, angVel: h.angVel } : null,
    snapFrom: newPose(),
    present: null,
    lastStep: 'tilt',
  };
}

function handleEvent(e: TimelineEvent, run: DrawRun): void {
  switch (e.type) {
    case 'scrape':
      scrapePayload.durationMs = e.payload ?? 400;
      bus.emit('scrape', scrapePayload);
      break;
    case 'pop':
      bus.emit('pop', EMPTY);
      if (!run.reduced) rt.camera.shake = Math.max(rt.camera.shake, 0.35);
      break;
    case 'eject':
      bus.emit('eject', EMPTY);
      break;
    case 'thunk':
      thunkPayload.force = e.payload ?? 0.4;
      bus.emit('thunk', thunkPayload);
      if (!run.reduced) rt.camera.shake = Math.max(rt.camera.shake, (e.payload ?? 0.4) * 0.6);
      break;
    case 'bell':
      bell();
      break;
    case 'burst':
      burst(PRESENT, run.reduced);
      break;
    case 'handoff':
      break;
  }
}

/**
 * Tube tilt during the draw. During the arc the timeline eases the tube upright right away, which
 * sweeps the tilted rim through the stick's exit path; instead hold the throw pose until the stick
 * is well clear (22% of the arc) and settle upright before it comes back down (50%).
 */
function arcTilt(run: DrawRun, smp: DrawSample, t: number): number {
  if (run.reduced || smp.step !== 'arc') return smp.tubeTilt;
  const am = run.tl.marks.arc!;
  const s = (t - am[0]) / (am[1] - am[0]);
  return TL.tiltDeg * DEG * (1 - easeInOutCubic((s - 0.22) / 0.28));
}

function glowFor(run: DrawRun, step: DrawSample['step'], t: number): number {
  const m = run.tl.marks;
  switch (step) {
    case 'tilt':
    case 'tease':
      return 0.15;
    case 'creep': {
      const c = m.creep!;
      return 0.25 + 0.55 * clamp01((t - c[0]) / (c[1] - c[0]));
    }
    case 'hold': {
      const hm = m.hold!;
      return 0.8 + 0.35 * Math.sin((t - hm[0]) * Math.PI * 2 * 3);
    }
    case 'pop':
      return 1.35;
    case 'arc':
      return run.reduced ? 1 : 1.15;
    case 'land':
      return 1;
    case 'present':
    case 'done':
      return 1 + 0.6 * rt.fx.presentBloom;
  }
}

/** Write the decoy pose for this frame (tease window), capturing its real pose at tease start. */
function driveDecoy(run: DrawRun, smp: DrawSample): void {
  const di = run.decoyIdx;
  if (di < 0 || !validIndex(di)) return;
  if (!smp.decoy || !run.decoyStartLocal) {
    if (rt.decoy.active) {
      // Tease over: leave the stick exactly where it started so physics/jitter resume seamlessly.
      if (run.decoyCaptured) writePose(rt.sticks.poses, di, tubeCompose(run.decoyCaptured, _pose));
      rt.decoy.active = false;
    }
    return;
  }
  if (!rt.decoy.active) {
    run.decoyCaptured = stickLocal(di, newPose());
    if (!isFinitePose(run.decoyCaptured)) run.decoyCaptured = copyPose(run.decoyStartLocal, newPose());
    rt.decoy.active = true;
  }
  // Rise along the tube axis: recover dy from the timeline's sample (tube at rest + forward tilt).
  _q.setFromAxisAngle(_x, -smp.tubeTilt);
  _v.set(smp.decoy.p[0] - TUBE_REST.p[0], smp.decoy.p[1] - TUBE_REST.p[1], smp.decoy.p[2] - TUBE_REST.p[2]).applyQuaternion(_q);
  const dy = Math.max(0, _v.y - run.decoyStartLocal.p[1]);
  const c = run.decoyCaptured!;
  _pose.p[0] = c.p[0];
  _pose.p[1] = c.p[1] + dy;
  _pose.p[2] = c.p[2];
  _pose.q[0] = c.q[0];
  _pose.q[1] = c.q[1];
  _pose.q[2] = c.q[2];
  _pose.q[3] = c.q[3];
  tubeCompose(_pose, _pose);
  copyPose(_pose, rt.decoy.pose);
  writePose(rt.sticks.poses, di, _pose);
  anchorDecoy = di;
}

function beginPresent(run: DrawRun, now: number): void {
  rt.hero.mode = 'present';
  run.present = buildPresent(rt.hero.pose, run.reduced);
  run.stage = 'present';
  run.stageT0 = now;
  bell();
  burst(PRESENT, run.reduced);
  if (!run.reduced) rt.fx.flash = Math.max(rt.fx.flash, 0.35);
}

function heroLanded(run: DrawRun): void {
  rt.hero.landed = true;
  rt.hero.mode = 'settle';
  bus.emit('landed', EMPTY);
  if (!run.reduced) rt.camera.shake = Math.max(rt.camera.shake, 0.25);
}

function finishDraw(run: DrawRun): void {
  run.stage = 'done';
  setHeroPose(PRESENT);
  rt.hero.mode = 'present';
  rt.hero.landed = true;
  rt.tube.scriptedTilt = null;
  rt.decoy.active = false;
  heroVisual.scale = 1;
  heroVisual.opacity = 1;
  rt.camera.shot = 'present';
  rt.camera.fovScale = run.reduced ? 1 : DESK_FOV_END;
  onDrawingDone();
}

function heroOutOfBounds(): boolean {
  const p = rt.hero.pose.p;
  if (!isFinitePose(rt.hero.pose)) return true;
  return p[1] < -0.25 || p[1] > 3 || Math.abs(p[0]) > 1.9 || p[2] > 1.2 || p[2] < -1.05;
}

function frameDrawing(now: number, dt: number): void {
  const run = draw;
  if (!run) return;
  const t = (now - run.t0) / 1000;

  // Director-level watchdog (inside the controller's): always land on a visible, presented hero.
  const limit = Number.isFinite(run.tl.duration) ? run.tl.duration * 1000 + DRAW_WATCHDOG_EXTRA_MS : DRAW_WATCHDOG_PHYSICS_MS;
  if (run.stage !== 'done' && now - run.t0 > limit) {
    console.warn('[director] draw watchdog fired; presenting the hero directly');
    finishDraw(run);
    return;
  }

  switch (run.stage) {
    case 'script': {
      const smp = sampleDraw(run.tl, t);
      for (const e of run.tl.events) if (e.t > run.prevT && e.t <= t) handleEvent(e, run);
      run.prevT = t;

      const inTubeStep = smp.step === 'tilt' || smp.step === 'tease' || smp.step === 'creep' || smp.step === 'hold' || smp.step === 'pop';
      rt.tube.scriptedTilt = smp.step === 'land' || smp.step === 'present' || smp.step === 'done' ? null : arcTilt(run, smp, t);

      // Landing → present transition of the fully scripted path (tier 0 / reduced motion).
      if ((run.lastStep === 'land' || (run.reduced && run.lastStep === 'arc')) && smp.step === 'present') heroLanded(run);
      run.lastStep = smp.step;

      if (run.physics && t >= run.tl.handoffT && run.handoff) {
        const hd = run.handoff;
        setHeroPose(hd.pose);
        setVec3(rt.hero.vel, hd.vel[0], hd.vel[1], hd.vel[2]);
        setVec3(rt.hero.angVel, hd.angVel[0], hd.angVel[1], hd.angVel[2]);
        rt.hero.handoffAt = now;
        rt.hero.landed = false;
        rt.hero.mode = 'dynamic';
        rt.tube.scriptedTilt = null;
        run.stage = 'dynamic';
        run.stageT0 = now;
        rt.camera.shot = 'follow';
        break;
      }

      if (smp.hero) {
        if (smp.step === 'tilt' && !run.reduced) {
          // Ease from the stick's real resting pose to the clean upright start during the tilt.
          const m = run.tl.marks.tilt!;
          const e = easeInOutCubic(clamp01((t - m[0]) / (m[1] - m[0])));
          const a = run.startActual;
          const b = run.startClean;
          _lv.set(a.p[0] + (b.p[0] - a.p[0]) * e, a.p[1] + (b.p[1] - a.p[1]) * e, a.p[2] + (b.p[2] - a.p[2]) * e);
          _lq.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize();
          _q2.set(b.q[0], b.q[1], b.q[2], b.q[3]);
          _lq.slerp(_q2, e);
          tubeTarget(_tv, _tq);
          _v2.copy(_lv).applyQuaternion(_tq).add(_tv);
          _lq.premultiply(_tq);
          vqToPose(_v2, _lq, rt.hero.pose);
          anchorHero = run.idx;
        } else {
          // The timeline assumes a resting tube; carry over the spring's leftover offset while the
          // stick is still inside and fade it out over the first 30% of the arc.
          let k = 0;
          if (inTubeStep) k = 1;
          else if (smp.step === 'arc' && !run.reduced) {
            const am = run.tl.marks.arc!;
            k = 1 - smoothstep((t - am[0]) / ((am[1] - am[0]) * 0.3));
          }
          const h = rt.hero.pose;
          copyPose(smp.hero, h);
          h.p[0] += tubeOffset.x * k;
          h.p[1] += tubeOffset.y * k;
          h.p[2] += tubeOffset.z * k;
        }
        setVec3(rt.hero.vel, smp.heroVel[0], smp.heroVel[1], smp.heroVel[2]);
        setVec3(rt.hero.angVel, smp.heroAngVel[0], smp.heroAngVel[1], smp.heroAngVel[2]);
        if (run.idx >= 0) writePose(rt.sticks.poses, run.idx, rt.hero.pose);
      }

      driveDecoy(run, smp);

      heroVisual.scale = smp.heroScale;
      heroVisual.opacity = smp.heroOpacity;
      heroVisual.glow = glowFor(run, smp.step, t);
      dampHalo(smp.step === 'present' || smp.step === 'done' ? 1 : 0, dt);
      rt.fx.caPulse = run.reduced ? 0 : smp.ca;
      rt.fx.flash = Math.max(rt.fx.flash, run.reduced ? 0 : smp.flash);
      rt.camera.shot = smp.shot;
      rt.camera.fovScale = smp.fovScale;
      const fp = smp.step === 'present' || smp.step === 'done' ? PRESENT.p : rt.hero.pose.p;
      setVec3(rt.camera.focus, fp[0], fp[1], fp[2]);

      if (smp.step === 'done') finishDraw(run);
      break;
    }

    case 'dynamic': {
      const smp = sampleDraw(run.tl, t);
      rt.fx.caPulse = smp.ca;
      heroVisual.glow = 1;
      rt.camera.shot = 'follow';
      const hp = rt.hero.pose.p;
      setVec3(rt.camera.focus, hp[0], hp[1], hp[2]);
      const elapsed = now - run.stageT0;
      const bridgeGone = physicsBridge.step === null || !rt.physicsReady || now - physicsBridge.lastStepAt > 250;
      if (rt.hero.landed && !heroOutOfBounds()) {
        heroLanded(run);
        beginPresent(run, now);
      } else if (heroOutOfBounds() || elapsed > TL.landMax * 1000 || (bridgeGone && elapsed > 100)) {
        copyPose(isFinitePose(rt.hero.pose) ? rt.hero.pose : (run.handoff?.pose ?? LANDING), run.snapFrom);
        rt.hero.mode = 'settle';
        run.stage = 'snap';
        run.stageT0 = now;
      }
      break;
    }

    case 'snap': {
      const u = clamp01((now - run.stageT0) / SNAP_MS);
      const e = easeOutCubic(u);
      const a = run.snapFrom;
      const h = rt.hero.pose;
      for (let i = 0; i < 3; i++) h.p[i] = a.p[i]! + (LANDING.p[i]! - a.p[i]!) * e;
      h.p[1] += 0.025 * Math.sin(Math.PI * u) * (1 - u);
      _q.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize();
      _q2.set(LANDING.q[0], LANDING.q[1], LANDING.q[2], LANDING.q[3]);
      _q.slerp(_q2, e);
      h.q[0] = _q.x;
      h.q[1] = _q.y;
      h.q[2] = _q.z;
      h.q[3] = _q.w;
      rt.camera.shot = 'follow';
      setVec3(rt.camera.focus, h.p[0], h.p[1], h.p[2]);
      if (u >= 1) {
        thunkPayload.force = 0.35;
        bus.emit('thunk', thunkPayload);
        heroLanded(run);
        beginPresent(run, now);
      }
      break;
    }

    case 'present': {
      const p = run.present;
      if (!p) {
        finishDraw(run);
        break;
      }
      const smp = samplePresent(p, (now - run.stageT0) / 1000);
      setHeroPose(smp.pose);
      rt.camera.shot = 'present';
      rt.camera.fovScale = smp.fovScale;
      setVec3(rt.camera.focus, PRESENT.p[0], PRESENT.p[1], PRESENT.p[2]);
      heroVisual.glow = 1 + 0.6 * rt.fx.presentBloom;
      dampHalo(1, dt);
      if (!run.reduced) {
        const k = (now - run.stageT0) / 500;
        if (k < 1) rt.fx.flash = Math.max(rt.fx.flash, 0.35 * (1 - k));
      }
      if (smp.done) finishDraw(run);
      break;
    }

    case 'done':
      break;
  }
}

function exitDrawing(): void {
  rt.tube.scriptedTilt = null;
  if (draw && draw.decoyIdx >= 0 && rt.decoy.active && draw.decoyCaptured && validIndex(draw.decoyIdx)) {
    writePose(rt.sticks.poses, draw.decoyIdx, tubeCompose(draw.decoyCaptured, _pose));
  }
  rt.decoy.active = false;
  // If something cut the draw short, the hero is brought to rest by the reveal frame (damped).
  if (rt.hero.mode === 'dynamic' || rt.hero.mode === 'scripted') rt.hero.mode = 'settle';
  heroVisual.scale = 1;
  heroVisual.opacity = 1;
  draw = null;
}

// ───────────────────────────── reveal / jiaobei ─────────────────────────────

function enterReveal(): void {
  const s = getState();
  const cur = s.current;
  const idx = resolveHeroIndex(cur);
  if (rt.camera.shot === 'locked' && rt.hero.mode === 'off') revealLocked = true;
  if (rt.hero.mode === 'off' && cur) {
    // Locked load (or a draw finished without us): show the stick immediately, no animation.
    setHeroPose(revealLocked ? LANDING : PRESENT);
    rt.hero.mode = revealLocked ? 'settle' : 'present';
    rt.hero.landed = true;
    if (idx >= 0) rt.sticks.hidden[idx] = 1;
    heroVisual.scale = 1;
    heroVisual.opacity = 1;
    heroVisual.glow = 1;
    if (!revealLocked) rt.camera.fovScale = s.reducedMotion ? 1 : DESK_FOV_END;
  }
}

/** Shared by reveal and jiaobei: keep the hero visible and gently at rest at `target`. */
function holdHero(target: Pose, dt: number, tau: number): void {
  const s = getState();
  const idx = resolveHeroIndex(s.current);
  if (idx >= 0) rt.sticks.hidden[idx] = 1;
  if (rt.hero.mode === 'off' && s.current) {
    setHeroPose(target);
    rt.hero.mode = 'present';
  }
  if (rt.hero.mode === 'dynamic' || rt.hero.mode === 'scripted' || rt.hero.mode === 'return') rt.hero.mode = 'settle';
  dampHero(target, dt, tau);
}

function frameReveal(now: number, dt: number): void {
  const s = getState();
  const reduced = s.reducedMotion;
  if (revealLocked) {
    holdHero(LANDING, dt, 0.35);
    rt.camera.shot = 'locked';
    rt.camera.fovScale = 1;
    setVec3(rt.camera.focus, LANDING.p[0], LANDING.p[1], LANDING.p[2]);
    heroVisual.glow = 1;
    dampHalo(0, dt);
  } else {
    // Present pose with a slow float and sway.
    const t = now / 1000;
    const amp = reduced ? 0.3 : 1;
    copyPose(PRESENT, _pose);
    _pose.p[1] += 0.012 * Math.sin(t * 1.3) * amp;
    _q.set(PRESENT.q[0], PRESENT.q[1], PRESENT.q[2], PRESENT.q[3]);
    _q2.setFromAxisAngle(_up, 0.045 * Math.sin(t * 0.6) * amp);
    _q.premultiply(_q2);
    _pose.q[0] = _q.x;
    _pose.q[1] = _q.y;
    _pose.q[2] = _q.z;
    _pose.q[3] = _q.w;
    holdHero(_pose, dt, 0.35);
    rt.camera.shot = 'present';
    rt.camera.fovScale = reduced ? 1 : DESK_FOV_END;
    setVec3(rt.camera.focus, PRESENT.p[0], PRESENT.p[1], PRESENT.p[2]);
    heroVisual.glow = 1 + 0.6 * rt.fx.presentBloom;
    dampHalo(1, dt);
  }
  heroVisual.scale = 1;
  heroVisual.opacity = 1;
}

function frameJiaobei(now: number, dt: number): void {
  const j = rt.jiaobei;
  if (j.t0 !== jb.t0 || j.seed !== jb.seed) jb = { t0: j.t0, seed: j.seed, impacts: 0, doneFired: false };
  if (j.active) {
    const t = Math.max(0, (now - j.t0) / 1000);
    const smp = sampleJiaobei(j.targets, j.seed, t);
    copyPose(smp.poses[0], j.poses[0]);
    copyPose(smp.poses[1], j.poses[1]);
    while (jb.impacts < smp.impacts) {
      const n = jb.impacts;
      landPayload.force = jiaobeiImpactForce(n < 2 ? 0 : n < 4 ? 1 : 2);
      bus.emit('jiaobei-land', landPayload);
      jb.impacts++;
    }
    if ((smp.done || now - j.t0 > JIAOBEI_WATCHDOG_MS) && !jb.doneFired) {
      jb.doneFired = true;
      onJiaobeiDone();
    }
  }
  holdHero(WITNESS, dt, 0.3);
  heroVisual.glow = 0.85;
  heroVisual.scale = 1;
  heroVisual.opacity = 1;
  dampHalo(0, dt);
  // Follow the toss while the blocks are airborne, then settle onto the landing spot.
  rt.camera.shot = j.active && jb.impacts === 0 ? 'toss' : 'jiaobei';
  rt.camera.fovScale = 1;
  setVec3(rt.camera.focus, 0, 0.1, 0.65);
}

// ───────────────────────────── resetting ─────────────────────────────

function enterResetting(now: number): void {
  const s = getState();
  const idx = resolveHeroIndex(s.current);
  revealLocked = false;
  rt.camera.shot = 'idle';
  rt.camera.fovScale = 1;
  rt.camera.dock = 'none';
  rt.decoy.active = false;
  if (rt.hero.mode === 'off' || idx < 0 || !isFinitePose(rt.hero.pose)) {
    // Nothing to put back; finish on the next frame (never synchronously inside a phase change).
    rt.hero.mode = 'off';
    if (idx >= 0) rt.sticks.hidden[idx] = 0;
    pendingResetDone = true;
    reset = null;
    return;
  }
  restSlotLocal(idx, _slot);
  // With physics the stick is released a hair above its slot and settles in for real.
  if (physicsBridge.step && rt.physicsReady) _slot.p[1] += 0.03;
  rt.sticks.hidden[idx] = 1;
  rt.hero.mode = 'return';
  reset = { t0: now, idx, ret: buildReturn(rt.hero.pose, TUBE_REST, _slot) };
}

function finishReset(): void {
  const r = reset;
  if (r && validIndex(r.idx)) {
    writePose(rt.sticks.poses, r.idx, r.ret.to);
    rt.sticks.hidden[r.idx] = 0;
  }
  reset = null;
  rt.hero.mode = 'off';
  heroVisual.halo = 0;
  onResetDone();
}

function frameResetting(now: number, dt: number): void {
  if (pendingResetDone) {
    pendingResetDone = false;
    finishReset();
    return;
  }
  const r = reset;
  if (!r) {
    finishReset();
    return;
  }
  const u = (now - r.t0) / 1000;
  const smp = samplePresent(r.ret, u);
  setHeroPose(smp.pose);
  if (validIndex(r.idx)) writePose(rt.sticks.poses, r.idx, smp.pose);
  heroVisual.glow = Math.max(0.2, heroVisual.glow - dt * 2);
  dampHalo(0, dt);
  if (smp.done) {
    clack.force = 0.55;
    bus.emit('clack', clack);
    finishReset();
  } else if (now - r.t0 > RESET_WATCHDOG_MS) finishReset();
}

// ───────────────────────────── idle / armed ─────────────────────────────

function frameIdle(phase: Phase): void {
  // Nothing is Director-owned outside the ritual phases (also repairs state if a watchdog in the
  // controller finished a phase without us).
  rt.hero.mode = 'off';
  unhideAll();
  rt.decoy.active = false;
  rt.tube.scriptedTilt = null;
  rt.camera.shot = phase === 'armed' ? 'shake' : 'idle';
  rt.camera.fovScale = 1;
  // The reveal scroll owns rt.camera.dock while it is up; nothing is docked outside it.
  rt.camera.dock = 'none';
  setVec3(rt.camera.focus, IDLE_FOCUS[0], IDLE_FOCUS[1], IDLE_FOCUS[2]);
  heroVisual.halo = 0;
  heroVisual.glow = 0;
}

// ───────────────────────────── phase transitions ─────────────────────────────

function onPhaseChange(from: Phase | null, to: Phase, now: number): void {
  if (from === 'drawing') exitDrawing();
  if (from === 'resetting') {
    reset = null;
    pendingResetDone = false;
  }
  switch (to) {
    case 'drawing':
      enterDrawing(now);
      break;
    case 'reveal':
      enterReveal();
      break;
    case 'resetting':
      enterResetting(now);
      break;
    case 'jiaobei':
      jb = { t0: -1, seed: -1, impacts: 0, doneFired: false };
      break;
    default:
      revealLocked = false;
      break;
  }
}

// ───────────────────────────── main ─────────────────────────────

function decayFx(dt: number, drawing: boolean): void {
  const fx = rt.fx;
  fx.flash *= Math.exp(-dt / 0.3);
  if (fx.flash < 1e-3) fx.flash = 0;
  if (!drawing) fx.caPulse = Math.max(0, fx.caPulse - dt / TL.caPulse);
  fx.dustBurst = Math.max(0, fx.dustBurst - dt / 1.2);
  fx.presentBloom = Math.max(0, fx.presentBloom - dt / 1.2);
  rt.camera.shake *= Math.exp(-dt / 0.25);
  if (rt.camera.shake < 1e-3) rt.camera.shake = 0;
}

/** Move the anchored owned sticks by the tube motion TubeDriver just applied (pre → actual). */
function reanchorOwned(): void {
  const t = rt.tube.actual;
  _tv.set(t.p[0], t.p[1], t.p[2]);
  _tq.set(t.q[0], t.q[1], t.q[2], t.q[3]);
  _dq.copy(_preQ).invert().premultiply(_tq);
  if (anchorHero >= 0 && validIndex(anchorHero) && rt.sticks.hidden[anchorHero] === 1) {
    reanchorPose(rt.hero.pose);
    writePose(rt.sticks.poses, anchorHero, rt.hero.pose);
  }
  if (anchorDecoy >= 0 && validIndex(anchorDecoy) && rt.decoy.active && rt.decoy.index === anchorDecoy) {
    reanchorPose(rt.decoy.pose);
    writePose(rt.sticks.poses, anchorDecoy, rt.decoy.pose);
  }
  anchorHero = -1;
  anchorDecoy = -1;
}

function reanchorPose(p: Pose): void {
  _v.set(p.p[0], p.p[1], p.p[2]).sub(_preV).applyQuaternion(_dq).add(_tv);
  _q.set(p.q[0], p.q[1], p.q[2], p.q[3]).premultiply(_dq);
  vqToPose(_v, _q, p);
}

function directorFrame(): void {
  const now = performance.now();
  const dt = lastNow > 0 ? Math.min(CFG.loop.maxDt, Math.max(0, (now - lastNow) / 1000)) : 1 / 60;
  lastNow = now;

  const s = getState();
  const phase = s.phase;
  if (phase !== lastPhase) {
    const from = lastPhase;
    lastPhase = phase;
    onPhaseChange(from, phase, now);
  }

  switch (phase) {
    case 'drawing':
      if (!draw) enterDrawing(now);
      frameDrawing(now, dt);
      break;
    case 'reveal':
      frameReveal(now, dt);
      break;
    case 'jiaobei':
      frameJiaobei(now, dt);
      break;
    case 'resetting':
      frameResetting(now, dt);
      break;
    default:
      frameIdle(phase);
      break;
  }

  const t0 = rt.tube.actual;
  _preV.set(t0.p[0], t0.p[1], t0.p[2]);
  _preQ.set(t0.q[0], t0.q[1], t0.q[2], t0.q[3]);
  stepTubeDriver(dt, now);
  if (anchorHero >= 0 || anchorDecoy >= 0) reanchorOwned();
  if (physicsBridge.step && rt.physicsReady) physicsBridge.step(dt, now);
  else stepSticksJitter(dt, now);

  decayFx(dt, phase === 'drawing');
}

function resetDirectorState(): void {
  if (draw) exitDrawing();
  draw = null;
  reset = null;
  pendingResetDone = false;
  lastPhase = null;
  lastNow = 0;
  anchorHero = -1;
  anchorDecoy = -1;
  rt.tube.scriptedTilt = null;
  rt.decoy.active = false;
}

export function Director(): null {
  const canvas = useThree((s) => s.gl.domElement);

  useEffect(() => {
    resetDirectorState();
    return () => {
      resetDirectorState();
      // Leave the world in a sane state for Fallback2D or a remount.
      if (rt.hero.mode === 'off') unhideAll();
    };
  }, []);

  // Grab-and-wiggle on the tube: the pointer shake integrator, hit-tested against the tube's grab volume.
  useEffect(() => attachPointerShake(canvas, hitTestTube), [canvas]);

  useFrame(() => {
    try {
      directorFrame();
    } catch (err) {
      console.error('[director] frame failed', err);
      // Fail safe: make sure the ritual can complete without us.
      rt.tube.scriptedTilt = null;
      const phase = getState().phase;
      if (phase === 'drawing') {
        setHeroPose(PRESENT);
        rt.hero.mode = 'present';
        draw = null;
        onDrawingDone();
      } else if (phase === 'resetting') {
        reset = null;
        rt.hero.mode = 'off';
        unhideAll();
        onResetDone();
      } else if (phase === 'jiaobei' && rt.jiaobei.active) onJiaobeiDone();
    }
  }, -50);

  return null;
}
