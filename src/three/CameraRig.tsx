/**
 * Camera rig. Each frame: framing for `rt.camera.shot` → critically damped approach
 * (smoothTime 0.35 s, follow 0.25 s, present 0.15 s so the dolly-zoom keeps the subject size) →
 * idle breathing, pointer/tilt parallax (±4°), handheld shake scaled by shake energy and impulse
 * shake from `rt.camera.shake` (both off under reduced motion) → FOV and the dock view offset.
 */
import { useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera, Vector3 } from 'three';
import type { CameraShot } from '@/types';
import { getState } from '@/state/store';
import { rt } from '@/state/runtime';
import { frameForInto, viewOffsetInto, type Framing } from './framing';
import { tubeHit } from './tube/Tube';

const DEG = Math.PI / 180;

const target: Framing = { pos: [0, 1.25, 3.6], look: [0, 0.65, 0], fov: 35 };
const pos = new Vector3(0, 1.25, 3.6);
const look = new Vector3(0, 0.65, 0);
const posVel = new Vector3();
const lookVel = new Vector3();
const tmp = new Vector3();
const off = new Vector3();
const vo = { x: 0, y: 0 };
const viewport = { w: 1, h: 1 };
let fov = 35;
let fovVel = 0;
let offX = 0;
let offY = 0;
let initialized = false;
let lastNow = 0;
let parX = 0;
let parY = 0;

/** Unity-style SmoothDamp on one scalar; writes the new value and velocity into `out`. */
function smoothDamp(cur: number, to: number, vel: number, smooth: number, dt: number, out: { v: number; vel: number }): void {
  const omega = 2 / Math.max(1e-4, smooth);
  const x = omega * dt;
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
  const change = cur - to;
  const temp = (vel + omega * change) * dt;
  out.vel = (vel - omega * temp) * exp;
  out.v = to + (change + temp) * exp;
}

const sd = { v: 0, vel: 0 };

function damp3(cur: Vector3, to: readonly [number, number, number], vel: Vector3, smooth: number, dt: number): void {
  smoothDamp(cur.x, to[0], vel.x, smooth, dt, sd);
  cur.x = sd.v;
  vel.x = sd.vel;
  smoothDamp(cur.y, to[1], vel.y, smooth, dt, sd);
  cur.y = sd.v;
  vel.y = sd.vel;
  smoothDamp(cur.z, to[2], vel.z, smooth, dt, sd);
  cur.z = sd.v;
  vel.z = sd.vel;
}

function smoothTimeFor(shot: CameraShot): number {
  if (shot === 'follow') return 0.25;
  if (shot === 'present') return 0.15;
  return 0.35;
}

/** Sum-of-sines noise, roughly −1..1. */
function n1(t: number, ph: number): number {
  return Math.sin(t * 1.0 + ph) * 0.5 + Math.sin(t * 2.31 + ph * 1.7) * 0.3 + Math.sin(t * 5.17 + ph * 2.9) * 0.2;
}

export function CameraRig(): null {
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    tubeHit.camera = camera;
    initialized = false;
    return () => {
      if (tubeHit.camera === camera) tubeHit.camera = null;
    };
  }, [camera]);

  useFrame((state) => {
    const cam = state.camera;
    if (!(cam instanceof PerspectiveCamera)) return;
    tubeHit.camera = cam;
    const now = performance.now();
    const dt = lastNow > 0 ? Math.min(0.1, Math.max(0, (now - lastNow) / 1000)) : 1 / 60;
    lastNow = now;
    const t = now / 1000;

    const w = state.size.width;
    const h = state.size.height;
    const aspect = w > 0 && h > 0 ? w / h : 1;
    const s = getState();
    const reduced = s.reducedMotion;
    const c = rt.camera;
    const shot = c.shot;

    viewport.w = w;
    viewport.h = h;
    frameForInto(target, shot, aspect, c.focus, c.dock, c.fovScale, viewport);

    if (!initialized) {
      pos.set(target.pos[0], target.pos[1], target.pos[2]);
      look.set(target.look[0], target.look[1], target.look[2]);
      fov = target.fov;
      posVel.set(0, 0, 0);
      lookVel.set(0, 0, 0);
      fovVel = 0;
      viewOffsetInto(vo, c.dock, w, h);
      offX = w > 0 ? vo.x / w : 0;
      offY = h > 0 ? vo.y / h : 0;
      initialized = true;
    } else {
      const st = smoothTimeFor(shot);
      damp3(pos, target.pos, posVel, st, dt);
      damp3(look, target.look, lookVel, st, dt);
      smoothDamp(fov, target.fov, fovVel, st, dt, sd);
      fov = sd.v;
      fovVel = sd.vel;
    }

    // ── parallax: orbit the look point by up to ±4° from pointer or device tilt ──
    const mo = rt.input.motion;
    let px = 0;
    let py = 0;
    if (rt.input.mode === 'motion' && mo.active) {
      // Same convention as the pointer ndc: x right, y up.
      px = Math.max(-1, Math.min(1, mo.tilt.x / (20 * DEG)));
      py = Math.max(-1, Math.min(1, mo.tilt.y / (20 * DEG)));
    } else if (!rt.input.pointer.grabbing) {
      px = rt.input.pointer.ndc[0];
      py = rt.input.pointer.ndc[1];
    }
    const pk = 1 - Math.exp(-dt / 0.5);
    parX += (px - parX) * pk;
    parY += (py - parY) * pk;
    const weight = (shot === 'idle' || shot === 'locked' ? 1 : shot === 'shake' ? 0.6 : 0.35) * (reduced ? 0.3 : 1);
    const yaw = parX * 4 * DEG * weight;
    const pitch = -parY * 2.5 * DEG * weight;

    off.copy(pos).sub(look);
    const r = off.length();
    if (r > 1e-4) {
      off.applyAxisAngle(tmp.set(0, 1, 0), -yaw);
      tmp.set(off.z, 0, -off.x).normalize();
      if (tmp.lengthSq() > 0) off.applyAxisAngle(tmp, pitch);
    }
    cam.position.copy(look).add(off);

    // ── breathing (idle-ish shots) ──
    if (shot === 'idle' || shot === 'locked' || shot === 'shake') {
      cam.position.y += Math.sin(t * Math.PI * 2 * 0.15) * 0.02 * (reduced ? 0.3 : 1);
    }

    // ── handheld + impulse shake ──
    if (!reduced) {
      const e = shot === 'shake' ? rt.shake.energy * 0.012 : 0;
      const imp = c.shake * 0.018;
      if (e + imp > 1e-5) {
        cam.position.x += n1(t * 9, 0.3) * e + n1(t * 23, 1.1) * imp;
        cam.position.y += n1(t * 11, 2.2) * e + n1(t * 27, 3.4) * imp;
        cam.position.z += n1(t * 7, 4.1) * e * 0.5;
      }
    }
    cam.lookAt(look);

    // ── FOV and dock offset ──
    viewOffsetInto(vo, c.dock, w, h);
    const wantX = w > 0 ? vo.x / w : 0;
    const wantY = h > 0 ? vo.y / h : 0;
    const ok = 1 - Math.exp(-dt / 0.3);
    offX += (wantX - offX) * ok;
    offY += (wantY - offY) * ok;
    if (Math.abs(offX - wantX) < 1e-4) offX = wantX;
    if (Math.abs(offY - wantY) < 1e-4) offY = wantY;

    let dirty = false;
    if (Math.abs(cam.fov - fov) > 1e-4) {
      cam.fov = fov;
      dirty = true;
    }
    if (Math.abs(offX) > 1e-4 || Math.abs(offY) > 1e-4) {
      const v = cam.view;
      if (
        !v ||
        !v.enabled ||
        v.fullWidth !== w ||
        v.fullHeight !== h ||
        Math.abs(v.offsetX - offX * w) > 0.05 ||
        Math.abs(v.offsetY - offY * h) > 0.05
      ) {
        cam.setViewOffset(w, h, offX * w, offY * h, w, h);
        dirty = false;
      }
    } else if (cam.view && cam.view.enabled) {
      cam.clearViewOffset();
      dirty = false;
    }
    if (dirty) cam.updateProjectionMatrix();
  }, -10);

  return null;
}
