import { describe, expect, it } from 'vitest';
import type { CameraShot, Vec3 } from '@/types';
import { CFG } from '@/config';
import { presentPose } from '@/draw/timeline';
import { G } from '@/three/physics/groups';
import { baseFov, dockForViewport, effectiveFovScale, frameFor, viewOffsetFor } from './framing';
import { initialStickPosesLocal } from './sticks/SticksJitter';

const DEG = Math.PI / 180;

/** Vertical half-extent visible at the look point for a framing. */
function halfHeightAtLook(pos: Vec3, look: Vec3, fov: number): number {
  const d = Math.hypot(pos[0] - look[0], pos[1] - look[1], pos[2] - look[2]);
  return d * Math.tan((fov * DEG) / 2);
}

describe('framing', () => {
  it('idle shot reproduces the base desktop and portrait framings', () => {
    const desk = frameFor('idle', 16 / 9, [0, 0, 0], 'none');
    expect(desk.fov).toBe(35);
    expect(desk.pos[0]).toBeCloseTo(0, 5);
    expect(desk.pos[1]).toBeCloseTo(1.25, 5);
    expect(desk.pos[2]).toBeCloseTo(3.6, 5);
    expect(desk.look).toEqual([0, 0.65, 0]);
    const port = frameFor('idle', 0.6, [0, 0, 0], 'none');
    expect(port.fov).toBeCloseTo(45, 5);
    expect(port.pos[1]).toBeCloseTo(1.35, 5);
    expect(port.pos[2]).toBeCloseTo(3.0, 5);
  });

  it('clamps the portrait FOV to 45–55°', () => {
    expect(baseFov(0.8)).toBe(45);
    expect(baseFov(0.46)).toBeGreaterThan(45);
    expect(baseFov(0.1)).toBe(55);
  });

  it('keeps the whole presented stick in frame for every aspect and dock', () => {
    const P = presentPose();
    const half = CFG.stick.size[1] / 2;
    for (const aspect of [0.45, 0.6, 0.75, 1.0, 1.33, 1.78, 2.4]) {
      for (const dock of ['none', 'right', 'bottom'] as const) {
        for (const fs of [1, 0.9, 0.8]) {
          const f = frameFor('present', aspect, P.p, dock, fs, { w: aspect * 800, h: 800 });
          const regionH = dock === 'bottom' ? 0.38 : 1;
          expect(halfHeightAtLook(f.pos, f.look, f.fov) * regionH).toBeGreaterThanOrEqual(half);
        }
      }
    }
  });

  it('keeps the subject size constant through the dolly-zoom', () => {
    const P = presentPose();
    const a = frameFor('present', 16 / 9, P.p, 'none', 1);
    const b = frameFor('present', 16 / 9, P.p, 'none', 0.8);
    expect(b.fov).toBeCloseTo(28, 5);
    expect(halfHeightAtLook(a.pos, a.look, a.fov)).toBeCloseTo(halfHeightAtLook(b.pos, b.look, b.fov), 5);
  });

  it('maps the desktop dolly-zoom range onto the mobile range', () => {
    expect(effectiveFovScale(1, 0.5)).toBe(1);
    expect(effectiveFovScale(0.8, 0.5)).toBeCloseTo(40 / 45, 5);
    expect(effectiveFovScale(0.8, 1.5)).toBeCloseTo(0.8, 5);
  });

  it('offsets the view for the docked scroll', () => {
    expect(viewOffsetFor('none', 1440, 900)).toBeNull();
    expect(viewOffsetFor('right', 1440, 900)).toEqual({ x: 210, y: 0 });
    expect(viewOffsetFor('right', 800, 400)!.x).toBeCloseTo(180, 5);
    expect(viewOffsetFor('bottom', 390, 844)!.y).toBeCloseTo(0.31 * 844, 5);
    expect(dockForViewport(1440, 900)).toBe('right');
    expect(dockForViewport(390, 844)).toBe('bottom');
  });

  it('produces finite framings for every shot', () => {
    const shots: CameraShot[] = ['idle', 'shake', 'follow', 'present', 'toss', 'jiaobei', 'locked'];
    for (const shot of shots) {
      const f = frameFor(shot, 1.6, [0.1, 0.8, 0.5], 'right', 0.9, { w: 1600, h: 1000 });
      for (const v of [...f.pos, ...f.look, f.fov]) expect(Number.isFinite(v)).toBe(true);
      expect(f.pos[2]).toBeGreaterThan(f.look[2]);
    }
  });
});

describe('stick layout', () => {
  it('stands every stick on the floor and keeps it inside the rim', () => {
    for (const n of [4, 9, 16]) {
      const poses = initialStickPosesLocal(n, 0x51ab);
      expect(poses).toHaveLength(n);
      for (const p of poses) {
        const [qx, qy, qz, qw] = p.q;
        // Stick axis (local +Y rotated by q).
        const ax = 2 * (qx * qy - qw * qz);
        const ay = 1 - 2 * (qx * qx + qz * qz);
        const az = 2 * (qy * qz + qw * qx);
        const half = CFG.stick.size[1] / 2;
        const foot = [p.p[0] - ax * half, p.p[1] - ay * half, p.p[2] - az * half];
        expect(foot[1]).toBeCloseTo(CFG.tube.floorY + 0.01, 2);
        const k = (CFG.tube.rimY - foot[1]!) / ay;
        const rimR = Math.hypot(foot[0]! + ax * k, foot[2]! + az * k);
        expect(rimR).toBeLessThan(CFG.tube.innerR);
        expect(Math.hypot(qx, qy, qz, qw)).toBeCloseTo(1, 5);
      }
    }
  });
});

describe('collision groups', () => {
  const member = (g: number): number => g >>> 16;
  const filter = (g: number): number => g & 0xffff;
  const collide = (a: number, b: number): boolean => (member(a) & filter(b)) !== 0 && (member(b) & filter(a)) !== 0;

  it('collides only the intended group pairs', () => {
    expect(collide(G.TUBE, G.STICK)).toBe(true);
    expect(collide(G.STICK, G.STICK)).toBe(true);
    expect(collide(G.ALTAR, G.HERO)).toBe(true);
    expect(collide(G.TUBE, G.HERO)).toBe(false);
    expect(collide(G.STICK, G.HERO)).toBe(false);
    expect(collide(G.ALTAR, G.STICK)).toBe(false);
    expect(collide(G.TUBE, G.ALTAR)).toBe(false);
  });
});
