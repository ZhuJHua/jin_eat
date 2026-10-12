/**
 * Allocation-free helpers for the 7-float pose buffers in `rt.sticks.poses`
 * (px, py, pz, qx, qy, qz, qw) and for `Pose` objects.
 */
import { Quaternion, Vector3 } from 'three';
import type { Pose } from '@/types';

export const STRIDE = 7;

export function writePose(buf: Float32Array, i: number, p: Pose): void {
  const o = i * STRIDE;
  buf[o] = p.p[0];
  buf[o + 1] = p.p[1];
  buf[o + 2] = p.p[2];
  buf[o + 3] = p.q[0];
  buf[o + 4] = p.q[1];
  buf[o + 5] = p.q[2];
  buf[o + 6] = p.q[3];
}

export function readVQ(buf: Float32Array, i: number, v: Vector3, q: Quaternion): void {
  const o = i * STRIDE;
  v.set(buf[o] ?? 0, buf[o + 1] ?? 0, buf[o + 2] ?? 0);
  q.set(buf[o + 3] ?? 0, buf[o + 4] ?? 0, buf[o + 5] ?? 0, buf[o + 6] ?? 1);
  if (q.lengthSq() < 1e-8) q.identity();
  else q.normalize();
}

export function copyPose(src: Pose, dst: Pose): Pose {
  dst.p[0] = src.p[0];
  dst.p[1] = src.p[1];
  dst.p[2] = src.p[2];
  dst.q[0] = src.q[0];
  dst.q[1] = src.q[1];
  dst.q[2] = src.q[2];
  dst.q[3] = src.q[3];
  return dst;
}

export function vqToPose(v: Vector3, q: Quaternion, out: Pose): Pose {
  out.p[0] = v.x;
  out.p[1] = v.y;
  out.p[2] = v.z;
  out.q[0] = q.x;
  out.q[1] = q.y;
  out.q[2] = q.z;
  out.q[3] = q.w;
  return out;
}

export const newPose = (): Pose => ({ p: [0, 0, 0], q: [0, 0, 0, 1] });

export function isFinitePose(p: Pose): boolean {
  return (
    Number.isFinite(p.p[0]) &&
    Number.isFinite(p.p[1]) &&
    Number.isFinite(p.p[2]) &&
    Number.isFinite(p.q[0]) &&
    Number.isFinite(p.q[1]) &&
    Number.isFinite(p.q[2]) &&
    Number.isFinite(p.q[3])
  );
}
