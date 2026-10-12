/** Tiny tuple math for the pure timeline modules (no three.js dependency, unit-testable in node). */
import type { Pose, Quat, Vec3 } from '@/types';

export const DEG = Math.PI / 180;

export const clamp = (x: number, a: number, b: number): number => (x < a ? a : x > b ? b : x);
export const clamp01 = (x: number): number => clamp(x, 0, 1);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const easeInOutCubic = (t: number): number => {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
};
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

export const vAdd = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const vSub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const vScale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const vLerp = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const vLen = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const vCross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const vNorm = (a: Vec3): Vec3 => {
  const l = vLen(a);
  return l > 1e-9 ? vScale(a, 1 / l) : [0, 1, 0];
};

export const QI: Quat = [0, 0, 0, 1];

export function qAxisAngle(axis: Vec3, angle: number): Quat {
  const n = vNorm(axis);
  const s = Math.sin(angle / 2);
  return [n[0] * s, n[1] * s, n[2] * s, Math.cos(angle / 2)];
}

/** Hamilton product a*b (apply b first, then a). */
export function qMul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

export const qConj = (q: Quat): Quat => [-q[0], -q[1], -q[2], q[3]];

export function qNormalize(q: Quat): Quat {
  const l = Math.hypot(q[0], q[1], q[2], q[3]);
  return l > 1e-12 ? [q[0] / l, q[1] / l, q[2] / l, q[3] / l] : [0, 0, 0, 1];
}

export function qSlerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let cos = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }
  if (cos > 0.9995) {
    return qNormalize([lerp(a[0], bx, t), lerp(a[1], by, t), lerp(a[2], bz, t), lerp(a[3], bw, t)]);
  }
  const theta = Math.acos(clamp(cos, -1, 1));
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return [a[0] * wa + bx * wb, a[1] * wa + by * wb, a[2] * wa + bz * wb, a[3] * wa + bw * wb];
}

/** Rotate vector v by unit quaternion q. */
export function qRotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + (qy * tz - qz * ty), vy + qw * ty + (qz * tx - qx * tz), vz + qw * tz + (qx * ty - qy * tx)];
}

/** Angle between two unit quaternions (radians, 0..π). */
export function qAngle(a: Quat, b: Quat): number {
  const d = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]);
  return 2 * Math.acos(clamp(d, -1, 1));
}

/** Angular velocity (world, rad/s) that takes q0 to q1 in dt seconds. */
export function qAngVel(q0: Quat, q1: Quat, dt: number): Vec3 {
  let d = qMul(q1, qConj(q0));
  if (d[3] < 0) d = [-d[0], -d[1], -d[2], -d[3]];
  const s = Math.hypot(d[0], d[1], d[2]);
  if (s < 1e-9 || dt <= 0) return [0, 0, 0];
  const angle = 2 * Math.atan2(s, d[3]);
  const k = angle / (s * dt);
  return [d[0] * k, d[1] * k, d[2] * k];
}

/** World pose of a child given its parent pose and child-local pose. */
export function composePose(parent: Pose, local: Pose): Pose {
  return { p: vAdd(parent.p, qRotate(parent.q, local.p)), q: qNormalize(qMul(parent.q, local.q)) };
}

export const clonePose = (p: Pose): Pose => ({ p: [p.p[0], p.p[1], p.p[2]], q: [p.q[0], p.q[1], p.q[2], p.q[3]] });

/** Uniform Catmull–Rom point between p1 and p2. */
export function catmullRom(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const t2 = t * t;
  const t3 = t2 * t;
  const out: Vec3 = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const a = p0[i]!;
    const b = p1[i]!;
    const c = p2[i]!;
    const d = p3[i]!;
    out[i] = 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
  }
  return out;
}
