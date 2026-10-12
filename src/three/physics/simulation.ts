/**
 * Rapier world contents for the ritual, built imperatively so the Director can drive the step order
 * exactly: kinematic tube (a ring of CFG.tube.physWalls wall cuboids reaching above the rim as an
 * invisible collar, plus the floor), N dynamic sticks with soft CCD, the hero body for the landing
 * handoff and the altar.
 *
 * Responsibilities per `step(dt, now)`:
 * - keep the stick bodies in sync with `rt.sticks.count` (new sticks drop in from y 1.4);
 * - honour the ownership protocol in `bridge.ts` (owned sticks are kinematic inside the tube and
 *   disabled outside it; released sticks resume at their last pose);
 * - drive the tube from `rt.tube.target` with per-substep interpolation (safety-clamped to
 *   CFG.tube.maxVel / maxAngVel) and publish the pose the walls really have as `rt.tube.actual`,
 *   which is what the visuals render;
 * - step with 1/240 s substeps while anything moves (1/120 s otherwise; paused while everything
 *   sleeps in calm phases), interpolating owned kinematic sticks across the substeps;
 * - keep every stick inside the tube geometrically after each step (endpoint projection: a hard
 *   guarantee on top of the solver, which cannot always resolve thin sticks against a wall that is
 *   swept into them), write stick poses back, re-drop true escapees, emit clacks from impacts;
 * - run the hero's dynamic landing: matched-velocity handoff, thunks, `rt.hero.landed`.
 *
 * Imports only rapier *types*; the runtime module comes from @react-three/rapier's context.
 */
import { Quaternion, Vector3 } from 'three';
import type { RapierContext } from '@react-three/rapier';
import { CFG } from '@/config';
import { bus } from '@/lib/bus';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { restSlotLocal } from '@/three/sticks/SticksJitter';
import { STRIDE, isFinitePose, newPose, readVQ } from '@/three/sticks/poseBuffer';
import { G } from './groups';
import { isOwnedStick, physicsBridge, physicsStats } from './bridge';

type World = RapierContext['world'];
type RapierNS = RapierContext['rapier'];
type Body = ReturnType<World['createRigidBody']>;

const MAX = CFG.limits.maxRestaurants;
const HALF = CFG.stick.colliderHalf;
/** Substep while the tube, an owned stick or the hero moves / in busy phases, and otherwise. */
const SUB_FAST = 1 / 240;
const SUB_CALM = 1 / 120;
const MAX_SUBSTEPS = 8;
/** Physics wall: an N-gon of slabs with apothem APO, reaching up to COLLAR_TOP (invisible collar). */
const WALLS = CFG.tube.physWalls;
const APO = CFG.tube.physInnerR;
const WALL_HALF_T = 0.08;
const WALL_HALF_W = APO * Math.tan(Math.PI / WALLS) + 0.02;
const COLLAR_TOP = 1.6;
const FLOOR_Y = CFG.tube.floorY;
/**
 * Projection limit for the horizontal radius of any collider corner below COLLAR_TOP: the N-gon's
 * corner radius plus a little slack, so resting contact never triggers it. The visual stick is
 * strictly inside its collider, so it then stays inside the painted inner wall (min r 0.2604).
 */
const LIMIT_R = APO / Math.cos(Math.PI / WALLS) + 0.0015;
const FLOOR_SLOP = 0.003;
/**
 * Soft-CCD prediction distance (m) on the tube and the sticks: contacts are detected this far ahead
 * along the bodies' motion, so a wall swept toward a stick is resolved before it overlaps it deeply.
 */
const SOFT_CCD = 0.05;
/** A stick whose centre is beyond this radius (or far above the tube) has truly left it: re-drop it. */
const ESCAPE_R = 0.35;
const ESCAPE_Y = 2.6;
/**
 * Anti-climb guard (tube-local centre height, m). A shaken bundle of thin sticks can ratchet a
 * stick upward (it is kicked up and the others slip in under its foot), until it tips out over the
 * collar. Above LIFT_Y (bottom ~0.2 m off the floor) a stick's upward velocity relative to the tube
 * is faded out, reaching zero at LIFT_Y + LIFT_RANGE (its top still below the collar top).
 */
const LIFT_Y = 0.78;
const LIFT_RANGE = 0.2;

/** Stick body modes. */
const DYN = 0;
const KIN = 1;
const OFF = 2;

// Scratch objects (no per-frame allocation in our own code).
const _v = new Vector3();
const _q = new Quaternion();
const _lv = new Vector3();
const _lq = new Quaternion();
const _tv = new Vector3();
const _tq = new Quaternion();
const _pv = new Vector3();
const _pq = new Quaternion();
const _kv = new Vector3();
const _kq = new Quaternion();
const _goalV = new Vector3();
const _goalQ = new Quaternion();
const _wv = new Vector3();
/** limitLift's relative velocity (kept apart from _wv, the step's tube target). */
const _rv = new Vector3();
const _wq = new Quaternion();
const _kinInv = new Quaternion();
/** The tube's motion over the current substep: linear and angular velocity (world). */
const _tubeLin = new Vector3();
const _tubeAng = new Vector3();
const _pkV = new Vector3();
const _pkQ = new Quaternion();
const _gv = new Vector3();
const _c = new Vector3();
const _ux = new Vector3();
const _uy = new Vector3();
const _uz = new Vector3();
const _ea = new Vector3();
const _eb = new Vector3();
const _nax = new Vector3();
const _dq = new Quaternion();
const _X = new Vector3(1, 0, 0);
const _Y = new Vector3(0, 1, 0);
const _Z = new Vector3(0, 0, 1);
const vec = { x: 0, y: 0, z: 0 };
const rot = { x: 0, y: 0, z: 0, w: 1 };
const zero = { x: 0, y: 0, z: 0 };
const _slot = newPose();
const clackPayload = { force: 0 };
const thunkPayload = { force: 0 };

type Vec3Like = { x: number; y: number; z: number };
type QuatLike = { x: number; y: number; z: number; w: number };

const setVec = (x: number, y: number, z: number): typeof vec => {
  vec.x = x;
  vec.y = y;
  vec.z = z;
  return vec;
};
const setRot = (q: Quaternion): typeof rot => {
  rot.x = q.x;
  rot.y = q.y;
  rot.z = q.z;
  rot.w = q.w;
  return rot;
};

export interface RitualSim {
  step(dt: number, now: number): void;
  dispose(): void;
}

export function createRitualSim(world: World, R: RapierNS): RitualSim {
  // ── tube (kinematic) ──
  const tgt = rt.tube.target;
  const tubeBody = world.createRigidBody(
    R.RigidBodyDesc.kinematicPositionBased()
      .setSoftCcdPrediction(SOFT_CCD)
      .setTranslation(tgt.p[0], tgt.p[1], tgt.p[2])
      .setRotation({ x: tgt.q[0], y: tgt.q[1], z: tgt.q[2], w: tgt.q[3] }),
  );
  for (let k = 0; k < WALLS; k++) {
    const a = (k / WALLS) * Math.PI * 2;
    const th = Math.PI / 2 - a;
    const rc = APO + WALL_HALF_T;
    world.createCollider(
      R.ColliderDesc.cuboid(WALL_HALF_W, COLLAR_TOP / 2, WALL_HALF_T)
        .setTranslation(Math.cos(a) * rc, COLLAR_TOP / 2, Math.sin(a) * rc)
        .setRotation({ x: 0, y: Math.sin(th / 2), z: 0, w: Math.cos(th / 2) })
        .setFriction(0.5)
        .setRestitution(0.1)
        .setCollisionGroups(G.TUBE),
      tubeBody,
    );
  }
  world.createCollider(
    R.ColliderDesc.cuboid(0.32, 0.03, 0.32).setTranslation(0, 0.03, 0).setFriction(0.5).setRestitution(0.1).setCollisionGroups(G.TUBE),
    tubeBody,
  );
  const kinV = new Vector3(tgt.p[0], tgt.p[1], tgt.p[2]);
  const kinQ = new Quaternion(tgt.q[0], tgt.q[1], tgt.q[2], tgt.q[3]);
  const prevTV = kinV.clone();
  const prevTQ = kinQ.clone();
  const steppedTV = kinV.clone();
  const steppedTQ = kinQ.clone();
  const writeActual = (): void => {
    const a = rt.tube.actual;
    a.p[0] = kinV.x;
    a.p[1] = kinV.y;
    a.p[2] = kinV.z;
    a.q[0] = kinQ.x;
    a.q[1] = kinQ.y;
    a.q[2] = kinQ.z;
    a.q[3] = kinQ.w;
  };
  writeActual();

  // ── altar (fixed) ──
  const altarBody = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.125, 0));
  world.createCollider(
    R.ColliderDesc.cuboid(2.0, 0.125, 1.1).setFriction(0.75).setRestitution(0.22).setCollisionGroups(G.ALTAR),
    altarBody,
  );

  // ── hero (dynamic, enabled only during the landing) ──
  const heroBody = world.createRigidBody(
    R.RigidBodyDesc.dynamic().setEnabled(false).setCcdEnabled(true).setLinearDamping(0.12).setAngularDamping(0.45),
  );
  world.createCollider(
    R.ColliderDesc.cuboid(HALF[0], HALF[1], HALF[2])
      .setDensity(CFG.stick.density)
      .setFriction(0.55)
      .setRestitution(0.28)
      .setCollisionGroups(G.HERO),
    heroBody,
  );
  let heroOn = false;
  let heroStillMs = 0;
  let heroLastThunk = -Infinity;
  const heroPrevV = new Vector3();

  // ── sticks ──
  const bodies: Body[] = [];
  const mode = new Uint8Array(MAX);
  const prevVel = new Float32Array(MAX * 3);
  /** Owned (kinematic) sticks: pose at the end of the previous step, for per-substep interpolation. */
  const ownPrev = new Float32Array(MAX * STRIDE);
  const lastClack = new Float64Array(MAX);
  /** ownPrev[i] ← rt.sticks.poses[i] (a plain loop: subarray() would allocate a view per call). */
  const copyOwnPrev = (i: number): void => {
    const src = rt.sticks.poses;
    for (let k = i * STRIDE, e = k + STRIDE; k < e; k++) ownPrev[k] = src[k]!;
  };
  let lastGlobalClack = -Infinity;
  let lastVersion = -1;
  let solverIters = -1;
  let sleepCheckAt = 0;
  let allSleeping = false;
  let disposed = false;

  /** The tube frame the walls really have (the kinematic pose of the last step) → _tv/_tq. */
  const tubeVQ = (): void => {
    _tv.copy(kinV);
    _tq.copy(kinQ);
  };

  /** Is world point `wv` inside the tube volume? Uses the actual (kinematic) tube pose in _tv/_tq. */
  const insideTube = (wv: Vector3): boolean => {
    _lv.copy(wv).sub(_tv).applyQuaternion(_pq.copy(_tq).invert());
    return Math.hypot(_lv.x, _lv.z) < 0.3 && _lv.y > -0.05 && _lv.y < 1.65;
  };

  /**
   * Clamp one end (centre of an end face, tube-local, in place) so that none of its 4 collider
   * corners below the collar top lies beyond LIMIT_R. Uses the axes in _ux/_uz.
   */
  const clampEnd = (e: Vector3): boolean => {
    let worst = LIMIT_R;
    let wx = 0;
    let wz = 0;
    for (let c = 0; c < 4; c++) {
      const sx = c & 1 ? HALF[0] : -HALF[0];
      const sz = c & 2 ? HALF[2] : -HALF[2];
      const py = e.y + _ux.y * sx + _uz.y * sz;
      if (py > COLLAR_TOP) continue;
      const px = e.x + _ux.x * sx + _uz.x * sz;
      const pz = e.z + _ux.z * sx + _uz.z * sz;
      const r = Math.hypot(px, pz);
      if (r > worst) {
        worst = r;
        wx = px;
        wz = pz;
      }
    }
    if (worst <= LIMIT_R) return false;
    // Move the end straight in along the worst corner's radial line by its excess.
    const k = (worst - LIMIT_R) / worst;
    e.x -= wx * k;
    e.z -= wz * k;
    return true;
  };

  /**
   * Geometric containment (tube-local, actual tube frame): keep every collider corner of stick `body`
   * (world pose `t`/`r`, already fetched) inside the wall's circumscribed radius and above the
   * floor. The inside of the tube is convex, so constraining the two end faces constrains the whole
   * stick. Leaves the stick's final world pose in _v/_q; returns true if it had to be moved.
   * Needs _kinInv = kinQ⁻¹.
   */
  const projectStick = (body: Body, t: Vec3Like, r: QuatLike): boolean => {
    _v.set(t.x, t.y, t.z);
    _q.set(r.x, r.y, r.z, r.w);
    _c.copy(_v).sub(kinV).applyQuaternion(_kinInv);
    _lq.copy(_q).premultiply(_kinInv);
    if (!Number.isFinite(_c.x + _c.y + _c.z + _lq.x + _lq.y + _lq.z + _lq.w)) return false;
    let moved = false;
    let lifted = false;
    for (let iter = 0; iter < 3; iter++) {
      _ux.copy(_X).applyQuaternion(_lq);
      _uy.copy(_Y).applyQuaternion(_lq);
      _uz.copy(_Z).applyQuaternion(_lq);
      _ea.copy(_c).addScaledVector(_uy, -HALF[1]);
      _eb.copy(_c).addScaledVector(_uy, HALF[1]);
      let changed = clampEnd(_ea);
      changed = clampEnd(_eb) || changed;
      const low = Math.min(_ea.y, _eb.y) - Math.abs(_ux.y) * HALF[0] - Math.abs(_uz.y) * HALF[2];
      if (low < FLOOR_Y - FLOOR_SLOP) {
        const d = FLOOR_Y - low;
        _ea.y += d;
        _eb.y += d;
        changed = true;
        lifted = true;
      }
      if (!changed) break;
      moved = true;
      // Restore the length: keep the lower end and the horizontal layout, set the higher end's height.
      const lo = _ea.y <= _eb.y ? _ea : _eb;
      const hi = lo === _ea ? _eb : _ea;
      const len = 2 * HALF[1];
      let hx = hi.x - lo.x;
      let hz = hi.z - lo.z;
      let hd = Math.hypot(hx, hz);
      if (hd > len * 0.995) {
        hx *= (len * 0.995) / hd;
        hz *= (len * 0.995) / hd;
        hd = len * 0.995;
        hi.x = lo.x + hx;
        hi.z = lo.z + hz;
      }
      hi.y = lo.y + Math.sqrt(len * len - hd * hd);
      _nax.copy(_eb).sub(_ea).normalize();
      _dq.setFromUnitVectors(_uy, _nax);
      _lq.premultiply(_dq).normalize();
      _c.copy(_ea).add(_eb).multiplyScalar(0.5);
    }
    if (!moved) return false;
    // Velocity (tube-local orientation): drop the outward radial part (and any downward part if it
    // was lifted off the floor), calm the spin. Rare (a safety net), so the getters' allocations
    // only happen when it fires.
    const lv = body.linvel();
    _lv.set(lv.x, lv.y, lv.z).applyQuaternion(_kinInv);
    const rr = Math.hypot(_c.x, _c.z);
    if (rr > 1e-6) {
      const nx = _c.x / rr;
      const nz = _c.z / rr;
      const vr = _lv.x * nx + _lv.z * nz;
      if (vr > 0) {
        _lv.x -= vr * nx;
        _lv.z -= vr * nz;
      }
    }
    if (lifted && _lv.y < 0) _lv.y = 0;
    _lv.applyQuaternion(kinQ);
    _v.copy(_c).applyQuaternion(kinQ).add(kinV);
    _q.multiplyQuaternions(kinQ, _lq);
    body.setTranslation(setVec(_v.x, _v.y, _v.z), true);
    body.setRotation(setRot(_q), true);
    body.setLinvel(setVec(_lv.x, _lv.y, _lv.z), true);
    const av = body.angvel();
    body.setAngvel(setVec(av.x * 0.5, av.y * 0.5, av.z * 0.5), true);
    physicsStats.projections++;
    return true;
  };

  /**
   * Fade out a stick's upward velocity relative to the tube above LIFT_Y (see LIFT_Y). Stick centre
   * (world) in _v, its velocity `lv` (already fetched). Needs _kinInv = kinQ⁻¹.
   */
  const limitLift = (body: Body, lv: Vec3Like): void => {
    _c.copy(_v).sub(kinV);
    _lv.copy(_c).applyQuaternion(_kinInv);
    if (!(_lv.y > LIFT_Y)) return;
    // Velocity of the tube at the stick's centre (over the last substep), and the stick's velocity
    // relative to it.
    _gv.crossVectors(_tubeAng, _c).add(_tubeLin);
    _rv.set(lv.x - _gv.x, lv.y - _gv.y, lv.z - _gv.z).applyQuaternion(_kinInv);
    if (_rv.y <= 0) return;
    const f = Math.max(0, 1 - (_lv.y - LIFT_Y) / LIFT_RANGE);
    _rv.y *= f;
    _rv.applyQuaternion(kinQ).add(_gv);
    body.setLinvel(setVec(_rv.x, _rv.y, _rv.z), true);
  };

  const placeAtSlot = (i: number, body: Body, local: { y: number; r: number } | null): void => {
    if (local) {
      const a = Math.random() * Math.PI * 2;
      _lv.set(Math.cos(a) * local.r, local.y, Math.sin(a) * local.r);
      _lq.identity();
    } else {
      restSlotLocal(i, _slot);
      _lv.set(_slot.p[0], _slot.p[1], _slot.p[2]);
      _lq.set(_slot.q[0], _slot.q[1], _slot.q[2], _slot.q[3]);
    }
    _v.copy(_lv).applyQuaternion(_tq).add(_tv);
    _q.multiplyQuaternions(_tq, _lq);
    body.setTranslation(setVec(_v.x, _v.y, _v.z), true);
    body.setRotation(setRot(_q), true);
    body.setLinvel(zero, true);
    body.setAngvel(zero, true);
    const o = i * STRIDE;
    const buf = rt.sticks.poses;
    buf[o] = _v.x;
    buf[o + 1] = _v.y;
    buf[o + 2] = _v.z;
    buf[o + 3] = _q.x;
    buf[o + 4] = _q.y;
    buf[o + 5] = _q.z;
    buf[o + 6] = _q.w;
    prevVel[i * 3] = prevVel[i * 3 + 1] = prevVel[i * 3 + 2] = 0;
  };

  const createStick = (i: number, dropIn: boolean): Body => {
    const body = world.createRigidBody(
      // No hard CCD: with 240 Hz substeps a stick never moves far per step, and CCD's motion clamping
      // against a wall that is itself moving pins sticks into it (they then lodge in the slab).
      // Soft CCD (predictive contacts) is cheap and does help against the moving wall.
      R.RigidBodyDesc.dynamic()
        .setCcdEnabled(false)
        .setSoftCcdPrediction(SOFT_CCD)
        .setLinearDamping(CFG.stick.linDamp)
        .setAngularDamping(CFG.stick.angDamp)
        .setCanSleep(true),
    );
    world.createCollider(
      R.ColliderDesc.cuboid(HALF[0], HALF[1], HALF[2])
        .setDensity(CFG.stick.density)
        .setFriction(CFG.stick.friction)
        .setRestitution(CFG.stick.restitution)
        .setCollisionGroups(G.STICK),
      body,
    );
    tubeVQ();
    if (dropIn) {
      placeAtSlot(i, body, { y: 1.4, r: 0.1 });
    } else {
      // Continue from the pose the jitter/visuals were showing, when it is sane.
      readVQ(rt.sticks.poses, i, _v, _q);
      if (Number.isFinite(_v.x + _v.y + _v.z + _q.x + _q.y + _q.z + _q.w) && insideTube(_v)) {
        body.setTranslation(setVec(_v.x, _v.y, _v.z), true);
        body.setRotation(setRot(_q), true);
      } else placeAtSlot(i, body, null);
    }
    mode[i] = DYN;
    return body;
  };

  const removeStick = (body: Body): void => {
    try {
      world.removeRigidBody(body);
    } catch {
      /* world already freed */
    }
  };

  const syncCount = (): void => {
    const s = rt.sticks;
    if (s.version === lastVersion && bodies.length === Math.min(MAX, s.count)) return;
    const n = Math.min(MAX, s.count);
    const growing = lastVersion !== -1 && n > bodies.length;
    while (bodies.length > n) removeStick(bodies.pop()!);
    while (bodies.length < n) bodies.push(createStick(bodies.length, growing));
    lastVersion = s.version;
    sleepCheckAt = 0;
  };

  /** Apply the ownership protocol; returns true if any stick is kinematic this frame. */
  const updateOwnership = (): boolean => {
    const s = rt.sticks;
    const dec = rt.decoy;
    let anyKin = false;
    tubeVQ();
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i]!;
      const owned = isOwnedStick(i, s.hidden, dec.active, dec.index);
      if (owned) {
        readVQ(s.poses, i, _v, _q);
        const want = insideTube(_v) ? KIN : OFF;
        if (want !== mode[i]) {
          if (want === KIN) {
            if (mode[i] === OFF) body.setEnabled(true);
            body.setBodyType(R.RigidBodyType.KinematicPositionBased, true);
            body.setTranslation(setVec(_v.x, _v.y, _v.z), true);
            body.setRotation(setRot(_q), true);
            copyOwnPrev(i);
          } else {
            body.setEnabled(false);
          }
          mode[i] = want;
        }
        if (want === KIN) anyKin = true;
      } else if (mode[i] !== DYN) {
        // Released: resume as a dynamic body at the pose the Director left it in.
        readVQ(s.poses, i, _v, _q);
        if (mode[i] === OFF) body.setEnabled(true);
        body.setBodyType(R.RigidBodyType.Dynamic, true);
        if (Number.isFinite(_v.x + _v.y + _v.z) && insideTube(_v)) {
          body.setTranslation(setVec(_v.x, _v.y, _v.z), true);
          body.setRotation(setRot(_q), true);
          body.setLinvel(zero, true);
          body.setAngvel(zero, true);
          prevVel[i * 3] = prevVel[i * 3 + 1] = prevVel[i * 3 + 2] = 0;
        } else placeAtSlot(i, body, null);
        body.wakeUp();
        mode[i] = DYN;
        sleepCheckAt = 0;
      }
    }
    return anyKin;
  };

  const updateHeroActivation = (): void => {
    const h = rt.hero;
    if (h.mode === 'dynamic' && !heroOn) {
      const p = h.pose;
      heroBody.setEnabled(true);
      heroBody.setBodyType(R.RigidBodyType.Dynamic, true);
      heroBody.setTranslation(setVec(p.p[0], p.p[1], p.p[2]), true);
      _q.set(p.q[0], p.q[1], p.q[2], p.q[3]).normalize();
      heroBody.setRotation(setRot(_q), true);
      heroBody.setLinvel(setVec(h.vel[0], h.vel[1], h.vel[2]), true);
      heroBody.setAngvel(setVec(h.angVel[0], h.angVel[1], h.angVel[2]), true);
      heroBody.wakeUp();
      heroPrevV.set(h.vel[0], h.vel[1], h.vel[2]);
      heroStillMs = 0;
      heroOn = true;
    } else if (h.mode !== 'dynamic' && heroOn) {
      heroBody.setEnabled(false);
      heroOn = false;
    }
  };

  const readBackSticks = (dt: number, now: number): void => {
    const s = rt.sticks;
    const buf = s.poses;
    tubeVQ();
    _pq.copy(_tq).invert();
    _kinInv.copy(_pq);
    const vThresh = 0.45 + 9.81 * dt;
    for (let i = 0; i < bodies.length; i++) {
      if (mode[i] !== DYN) continue;
      const body = bodies[i]!;
      if (body.isSleeping()) continue;
      const t = body.translation();
      const r = body.rotation();
      // Last resort (projection keeps sticks inside; this catches NaNs and sticks that flew out over
      // the collar): drop it back in from above, the way new sticks arrive.
      _lv.set(t.x, t.y, t.z).sub(_tv).applyQuaternion(_pq);
      const rr = Math.hypot(_lv.x, _lv.z);
      if (!Number.isFinite(rr + _lv.y + r.x + r.y + r.z + r.w) || rr > ESCAPE_R || _lv.y < -0.1 || _lv.y > ESCAPE_Y) {
        placeAtSlot(i, body, { y: 1.7, r: 0.08 });
        physicsStats.teleports++;
        continue;
      }
      // Containment (→ final pose in _v/_q), using the pose and velocity fetched once per frame:
      // each Rapier getter allocates, so nothing here re-reads the body.
      projectStick(body, t, r);
      const lv = body.linvel();
      limitLift(body, lv);
      const o = i * STRIDE;
      buf[o] = _v.x;
      buf[o + 1] = _v.y;
      buf[o + 2] = _v.z;
      buf[o + 3] = _q.x;
      buf[o + 4] = _q.y;
      buf[o + 5] = _q.z;
      buf[o + 6] = _q.w;

      // Impact-based clacks: a sudden velocity change larger than gravity alone explains.
      const k = i * 3;
      const dv = Math.hypot(lv.x - prevVel[k]!, lv.y - prevVel[k + 1]!, lv.z - prevVel[k + 2]!);
      prevVel[k] = lv.x;
      prevVel[k + 1] = lv.y;
      prevVel[k + 2] = lv.z;
      if (dv > vThresh && now - lastClack[i]! > 80 && now - lastGlobalClack > 18) {
        lastClack[i] = now;
        lastGlobalClack = now;
        clackPayload.force = Math.min(1, Math.max(0.08, (dv - 0.35) / 2.2));
        bus.emit('clack', clackPayload);
      }
    }
  };

  const readBackHero = (dt: number, now: number): void => {
    if (!heroOn) return;
    const h = rt.hero;
    const t = heroBody.translation();
    const r = heroBody.rotation();
    const lv = heroBody.linvel();
    const av = heroBody.angvel();
    h.pose.p[0] = t.x;
    h.pose.p[1] = t.y;
    h.pose.p[2] = t.z;
    h.pose.q[0] = r.x;
    h.pose.q[1] = r.y;
    h.pose.q[2] = r.z;
    h.pose.q[3] = r.w;
    h.vel[0] = lv.x;
    h.vel[1] = lv.y;
    h.vel[2] = lv.z;
    h.angVel[0] = av.x;
    h.angVel[1] = av.y;
    h.angVel[2] = av.z;
    if (!isFinitePose(h.pose)) return;

    const dv = Math.hypot(lv.x - heroPrevV.x, lv.y - heroPrevV.y, lv.z - heroPrevV.z);
    heroPrevV.set(lv.x, lv.y, lv.z);
    if (dv > 0.5 + 9.81 * dt && now - heroLastThunk > 70) {
      heroLastThunk = now;
      thunkPayload.force = Math.min(1, dv / 3);
      bus.emit('thunk', thunkPayload);
      rt.camera.shake = Math.max(rt.camera.shake, Math.min(1, dv / 4));
    }

    const speed = Math.hypot(lv.x, lv.y, lv.z);
    const spin = Math.hypot(av.x, av.y, av.z);
    if (heroBody.isSleeping() || (speed < 0.05 && spin < 0.3)) heroStillMs += dt * 1000;
    else heroStillMs = 0;
    if (heroStillMs >= 150 || heroBody.isSleeping()) h.landed = true;
  };

  const step = (dt: number, now: number): void => {
    if (disposed) return;
    syncCount();
    const anyKin = updateOwnership();
    updateHeroActivation();

    const phase = getState().phase;
    const busy = phase === 'armed' || phase === 'drawing' || phase === 'resetting';
    const iters = busy ? 8 : 4;
    if (iters !== solverIters) {
      world.integrationParameters.numSolverIterations = iters;
      solverIters = iters;
    }

    // Pause while nothing can change: calm phase, all sticks asleep, tube not moved.
    _wv.set(tgt.p[0], tgt.p[1], tgt.p[2]);
    _wq.set(tgt.q[0], tgt.q[1], tgt.q[2], tgt.q[3]);
    const tubeMoved = _wv.distanceToSquared(steppedTV) > 4e-8 || _wq.angleTo(steppedTQ) > 2e-4;
    if (now >= sleepCheckAt) {
      sleepCheckAt = now + 500;
      allSleeping = true;
      for (let i = 0; i < bodies.length; i++) {
        if (mode[i] === DYN && !bodies[i]!.isSleeping()) {
          allSleeping = false;
          break;
        }
      }
    }
    if (tubeMoved) {
      // Rapier does not reliably wake bodies resting against a kinematic body that starts moving;
      // a sleeping stick would then hang in world space while the tube turns around it.
      for (let i = 0; i < bodies.length; i++) if (mode[i] === DYN) bodies[i]!.wakeUp();
      allSleeping = false;
    }
    const calm = !busy && !heroOn && !anyKin && allSleeping && !tubeMoved;
    if (calm) {
      prevTV.copy(_wv);
      prevTQ.copy(_wq);
      writeActual();
      physicsBridge.lastStepAt = now;
      return;
    }

    const h = Math.min(dt, 0.05);
    const fast = tubeMoved || busy || heroOn || anyKin;
    const n = Math.max(1, Math.min(MAX_SUBSTEPS, Math.ceil(h / (fast ? SUB_FAST : SUB_CALM) - 1e-6)));
    const sub = h / n;
    const maxD = CFG.tube.maxVel * sub;
    const maxA = CFG.tube.maxAngVel * sub;
    for (let k = 0; k < n; k++) {
      const f = (k + 1) / n;
      _goalV.copy(prevTV).lerp(_wv, f);
      _goalQ.copy(prevTQ).slerp(_wq, f);
      _pkV.copy(kinV);
      _pkQ.copy(kinQ);
      _kv.copy(_goalV).sub(kinV);
      const d = _kv.length();
      if (d > maxD) _kv.multiplyScalar(maxD / d);
      kinV.add(_kv);
      if (kinQ.angleTo(_goalQ) > maxA) kinQ.rotateTowards(_goalQ, maxA);
      else kinQ.copy(_goalQ);
      // The tube's velocity over this substep (for velocities relative to the tube).
      _tubeLin.copy(_kv).divideScalar(sub);
      _dq.copy(_pkQ).invert().premultiply(kinQ);
      if (_dq.w < 0) _dq.set(-_dq.x, -_dq.y, -_dq.z, -_dq.w);
      const sh = Math.hypot(_dq.x, _dq.y, _dq.z);
      const ang = 2 * Math.atan2(sh, _dq.w);
      if (sh > 1e-9) _tubeAng.set(_dq.x, _dq.y, _dq.z).multiplyScalar(ang / (sh * sub));
      else _tubeAng.set(0, 0, 0);
      tubeBody.setNextKinematicTranslation(setVec(kinV.x, kinV.y, kinV.z));
      tubeBody.setNextKinematicRotation(setRot(kinQ));

      if (anyKin) {
        // Owned sticks glide across the substeps instead of jumping on the first one (an n× spike
        // in their implied velocity that would bat the dynamic sticks around).
        const buf = rt.sticks.poses;
        for (let i = 0; i < bodies.length; i++) {
          if (mode[i] !== KIN) continue;
          readVQ(buf, i, _pv, _kq);
          readVQ(ownPrev, i, _goalV, _goalQ);
          if (Number.isFinite(_goalV.x + _goalV.y + _goalV.z + _goalQ.w)) {
            _pv.lerpVectors(_goalV, _pv, f);
            _kq.copy(_goalQ.normalize().slerp(_kq, f));
          }
          const b = bodies[i]!;
          b.setNextKinematicTranslation(setVec(_pv.x, _pv.y, _pv.z));
          b.setNextKinematicRotation(setRot(_kq));
        }
      }
      world.timestep = sub;
      world.step();
    }
    if (anyKin) {
      for (let i = 0; i < bodies.length; i++) if (mode[i] === KIN) copyOwnPrev(i);
    }
    writeActual();
    steppedTV.copy(_wv);
    steppedTQ.copy(_wq);
    kinV.toArray(physicsStats.kinP);
    physicsStats.kinQ[0] = kinQ.x;
    physicsStats.kinQ[1] = kinQ.y;
    physicsStats.kinQ[2] = kinQ.z;
    physicsStats.kinQ[3] = kinQ.w;
    prevTV.copy(_wv);
    prevTQ.copy(_wq);

    readBackSticks(h, now);
    readBackHero(h, now);
    physicsBridge.lastStepAt = now;
  };

  // Identity of the world these bodies live in. <Physics> frees its world (and lazily makes a new
  // one) when it unmounts — including React StrictMode's simulated unmount, which may run before
  // our cleanup. Removing stale bodies through the proxy would then hit the new world and trip
  // wasm-bindgen's aliasing guard, so only remove them while our world is still the live one.
  const ownBodySet = world.bodies;

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    let alive: boolean;
    try {
      alive = world.bodies === ownBodySet;
    } catch {
      alive = false;
    }
    if (alive) {
      for (const b of bodies) removeStick(b);
      for (const b of [tubeBody, altarBody, heroBody]) removeStick(b);
    }
    bodies.length = 0;
  };

  // Seed the visuals' poses from the bodies right away.
  syncCount();
  return { step, dispose };
}
