/**
 * Mutable per-frame data shared by sensors, the master loop, the Director and visuals.
 * React never reads this during render; sensors never set React state per event.
 * Mutate fields in place (other modules may hold references to nested arrays).
 */
import type { CameraShot, InputMode, JiaobeiOutcome, Pose, Quat, Vec3 } from '@/types';
import { CFG } from '@/config';

export interface Runtime {
  input: {
    mode: InputMode;
    motion: {
      lin: Vec3;
      mag: number;
      magLP: number;
      tilt: { x: number; y: number };
      forward: number;
      lastTs: number;
      peaks: number;
      active: boolean;
      /** Intent-gate gain 0..1 applied to `lin` (debug / tuning; see CFG.sensors.feel). */
      intent: number;
    };
    pointer: { over: boolean; grabbing: boolean; ndc: [number, number]; vel: [number, number]; mag: number; lastTs: number };
    auto: { active: boolean; kind: 'hold' | 'quick' | null; t0: number; until: number };
  };
  shake: {
    meter: number;
    energy: number;
    stillMs: number;
    fullLatched: boolean;
    fullSince: number | null;
    armSustainMs: number;
    lastInputTs: number;
  };
  /**
   * `target`: the pose TubeDriver wants. `actual`: the pose the tube really has this frame — the
   * kinematic physics body's pose when the simulation runs, else a copy of `target`. Everything that
   * renders the tube or composes sticks with it reads `actual`, so visuals and walls always agree.
   */
  tube: { target: Pose; actual: Pose; vel: Vec3; scriptedTilt: number | null };
  /** poses: 7·count floats (px,py,pz,qx,qy,qz,qw) in world space. */
  sticks: { count: number; poses: Float32Array; hidden: Uint8Array; version: number };
  hero: {
    index: number;
    mode: 'off' | 'scripted' | 'dynamic' | 'settle' | 'present' | 'return';
    pose: Pose;
    vel: Vec3;
    angVel: Vec3;
    landed: boolean;
    handoffAt: number | null;
  };
  decoy: { index: number; active: boolean; pose: Pose };
  camera: { shot: CameraShot; focus: Vec3; fovScale: number; shake: number; dock: 'none' | 'right' | 'bottom' };
  fx: {
    flash: number;
    caPulse: number;
    dustBurst: number;
    burstOrigin: Vec3;
    confettiT0: number;
    smokeBend: [number, number];
    lanternDrive: [number, number];
    presentBloom: number;
  };
  /**
   * 掷筊 state. `targets`, `seed`, `t0` (performance.now ms) and `outcome` are written by
   * controller.throwJiaobei; the Director samples `draw/jiaobei.sampleJiaobei(targets, seed, t)`.
   */
  jiaobei: { active: boolean; poses: [Pose, Pose]; targets: [Quat, Quat]; seed: number; t0: number; outcome: JiaobeiOutcome | null };
  physicsReady: boolean;
}

const pose = (): Pose => ({ p: [0, 0, 0], q: [0, 0, 0, 1] });

const DEFAULT_STICKS = 9;

export const rt: Runtime = {
  input: {
    mode: 'pointer',
    motion: { lin: [0, 0, 0], mag: 0, magLP: 0, tilt: { x: 0, y: 0 }, forward: 0, lastTs: 0, peaks: 0, active: false, intent: 0 },
    pointer: { over: false, grabbing: false, ndc: [0, 0], vel: [0, 0], mag: 0, lastTs: 0 },
    auto: { active: false, kind: null, t0: 0, until: 0 },
  },
  shake: { meter: 0, energy: 0, stillMs: 0, fullLatched: false, fullSince: null, armSustainMs: 0, lastInputTs: 0 },
  tube: { target: pose(), actual: pose(), vel: [0, 0, 0], scriptedTilt: null },
  sticks: { count: 0, poses: new Float32Array(0), hidden: new Uint8Array(0), version: 0 },
  hero: { index: -1, mode: 'off', pose: pose(), vel: [0, 0, 0], angVel: [0, 0, 0], landed: false, handoffAt: null },
  decoy: { index: -1, active: false, pose: pose() },
  camera: { shot: 'idle', focus: [0, 0.65, 0], fovScale: 1, shake: 0, dock: 'none' },
  fx: {
    flash: 0,
    caPulse: 0,
    dustBurst: 0,
    burstOrigin: [0, 0.8, 0.6],
    confettiT0: -1,
    smokeBend: [0, 0],
    lanternDrive: [0, 0],
    presentBloom: 0,
  },
  jiaobei: {
    active: false,
    poses: [pose(), pose()],
    targets: [
      [0, 0, 0, 1],
      [0, 0, 0, 1],
    ],
    seed: 0,
    t0: 0,
    outcome: null,
  },
  physicsReady: false,
};

/**
 * Upright resting layout inside the tube (world space, tube at rest at the origin): a sunflower
 * spread inside r < 0.16 so the bundle looks natural before physics/jitter takes over.
 */
function fillRestingPoses(poses: Float32Array, count: number): void {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const y = CFG.tube.floorY + CFG.stick.size[1] / 2 + 0.01;
  for (let i = 0; i < count; i++) {
    const r = 0.16 * Math.sqrt((i + 0.5) / Math.max(1, count));
    const a = i * golden;
    const o = i * 7;
    poses[o] = Math.cos(a) * r;
    poses[o + 1] = y;
    poses[o + 2] = Math.sin(a) * r;
    // Lean slightly outward (≤ 4°) about the tangent axis.
    const lean = ((4 * Math.PI) / 180) * (r / 0.16);
    const ax = -Math.sin(a);
    const az = Math.cos(a);
    const s = Math.sin(lean / 2);
    poses[o + 3] = ax * s;
    poses[o + 4] = 0;
    poses[o + 5] = az * s;
    poses[o + 6] = Math.cos(lean / 2);
  }
}

/** Reallocate stick buffers for a new list size (keeps the first min(old,new) poses) and bump version. */
export function resizeSticks(count: number): void {
  const n = Math.max(0, Math.floor(count));
  const s = rt.sticks;
  if (n === s.count && s.poses.length === n * 7) return;
  const poses = new Float32Array(n * 7);
  fillRestingPoses(poses, n);
  const keep = Math.min(n, s.count);
  if (keep > 0) poses.set(s.poses.subarray(0, keep * 7));
  const hidden = new Uint8Array(n);
  s.poses = poses;
  s.hidden = hidden;
  s.count = n;
  s.version++;
  if (rt.hero.index >= n) rt.hero.index = -1;
  if (rt.decoy.index >= n) rt.decoy.index = -1;
}

function resetPose(p: Pose): void {
  p.p[0] = 0;
  p.p[1] = 0;
  p.p[2] = 0;
  p.q[0] = 0;
  p.q[1] = 0;
  p.q[2] = 0;
  p.q[3] = 1;
}

/** Clear shake / hero / decoy / fx / jiaobei state between draws (stick poses are left alone). */
export function resetForDraw(): void {
  const sh = rt.shake;
  sh.meter = 0;
  sh.energy = 0;
  sh.stillMs = 0;
  sh.fullLatched = false;
  sh.fullSince = null;
  sh.armSustainMs = 0;
  sh.lastInputTs = 0;

  const a = rt.input.auto;
  a.active = false;
  a.kind = null;
  a.t0 = 0;
  a.until = 0;

  const h = rt.hero;
  h.index = -1;
  h.mode = 'off';
  h.vel[0] = h.vel[1] = h.vel[2] = 0;
  h.angVel[0] = h.angVel[1] = h.angVel[2] = 0;
  h.landed = false;
  h.handoffAt = null;

  rt.decoy.index = -1;
  rt.decoy.active = false;
  resetPose(rt.decoy.pose);

  rt.tube.scriptedTilt = null;

  const c = rt.camera;
  c.shot = 'idle';
  c.fovScale = 1;
  c.shake = 0;

  const fx = rt.fx;
  fx.flash = 0;
  fx.caPulse = 0;
  fx.dustBurst = 0;
  fx.confettiT0 = -1;
  fx.presentBloom = 0;

  rt.jiaobei.active = false;
  rt.jiaobei.outcome = null;
}

resizeSticks(DEFAULT_STICKS);
