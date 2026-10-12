/**
 * 签筒 geometry. A lathe profile through a radius key table, a separate inner wall
 * (rendered BackSide), the interior floor, a rounded lip, three gold bands and a medallion disc bent
 * onto the curved front. Profile points are spaced uniformly in y so the lathe's v coordinate is
 * linear in height (the lacquer pattern texture relies on that).
 */
import { BufferGeometry, CircleGeometry, LatheGeometry, TorusGeometry, Vector2 } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Literal-typed so a mismatch with CFG.tube (rimY / innerR / floorY) is easy to spot; tubeGeometry.test.ts asserts they agree. */
export const TUBE_DIMS: { height: 0.85; innerR: 0.27; floorY: 0.06; rimY: 0.85 } = {
  height: 0.85,
  innerR: 0.27,
  floorY: 0.06,
  rimY: 0.85,
};

/** Visual wall thickness, kept thin so the painted inner wall (min r ≈ 0.26 at the waist) stays outside
 * the physics wall and sticks pressed against it never poke through. */
export const WALL = 0.024;
export const PROFILE_POINTS = 24;
export const LATHE_SEGMENTS = 48;

/** Height of the medallion centre and its radius. */
export const MEDALLION = { y: 0.45, r: 0.11, lift: 0.011 } as const;
/** Heights of the gold bands. */
export const BAND_Y = [0.12, 0.5, 0.8] as const;

const KEYS: readonly (readonly [number, number])[] = [
  [0, 0.32],
  [0.06, 0.3],
  [0.45, 0.285],
  [0.8, 0.3],
  [0.85, 0.31],
];

/** Outer radius at height y (Catmull–Rom through the key table, clamped at the ends). */
export function outerRadiusAt(y: number): number {
  const n = KEYS.length;
  if (y <= KEYS[0]![0]) return KEYS[0]![1];
  if (y >= KEYS[n - 1]![0]) return KEYS[n - 1]![1];
  let i = 0;
  while (i < n - 2 && y > KEYS[i + 1]![0]) i++;
  const k0 = KEYS[Math.max(0, i - 1)]!;
  const k1 = KEYS[i]!;
  const k2 = KEYS[i + 1]!;
  const k3 = KEYS[Math.min(n - 1, i + 2)]!;
  const t = (y - k1[0]) / (k2[0] - k1[0]);
  // Non-uniform knots: estimate tangents with finite differences in y.
  const m1 = (k2[1] - k0[1]) / Math.max(1e-6, k2[0] - k0[0]);
  const m2 = (k3[1] - k1[1]) / Math.max(1e-6, k3[0] - k1[0]);
  const h = k2[0] - k1[0];
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * k1[1] + (t3 - 2 * t2 + t) * h * m1 + (-2 * t3 + 3 * t2) * k2[1] + (t3 - t2) * h * m2;
}

function profile(offset: number, y0: number): Vector2[] {
  const pts: Vector2[] = [];
  const top = TUBE_DIMS.rimY;
  for (let i = 0; i < PROFILE_POINTS; i++) {
    const y = y0 + ((top - y0) * i) / (PROFILE_POINTS - 1);
    pts.push(new Vector2(outerRadiusAt(y) + offset, y));
  }
  return pts;
}

export function createTubeGeometries(): { outer: LatheGeometry; inner: LatheGeometry; floor: CircleGeometry } {
  const outer = new LatheGeometry(profile(0, 0), LATHE_SEGMENTS);
  const inner = new LatheGeometry(profile(-WALL, TUBE_DIMS.floorY), LATHE_SEGMENTS);
  const floor = new CircleGeometry(outerRadiusAt(TUBE_DIMS.floorY) - WALL + 0.002, LATHE_SEGMENTS);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, TUBE_DIMS.floorY, 0);
  return { outer, inner, floor };
}

/** Rounded lacquer lip covering the wall's top edge. */
export function createRimGeometry(): TorusGeometry {
  const rOut = outerRadiusAt(TUBE_DIMS.rimY);
  const g = new TorusGeometry(rOut - WALL / 2, WALL / 2 + 0.002, 10, 64);
  g.rotateX(Math.PI / 2);
  g.translate(0, TUBE_DIMS.rimY, 0);
  return g;
}

/** The three gold bands merged into one draw call. */
export function createBandGeometry(): BufferGeometry {
  const parts = BAND_Y.map((y) => {
    const g = new TorusGeometry(outerRadiusAt(y) + 0.0015, 0.008, 8, 64);
    g.rotateX(Math.PI / 2);
    g.translate(0, y, 0);
    return g;
  });
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  if (!merged) throw new Error('band geometry merge failed');
  return merged;
}

/** Medallion disc bent onto the curved front surface (centred at +Z, facing the camera). */
export function createMedallionGeometry(): CircleGeometry {
  const r = MEDALLION.r;
  const g = new CircleGeometry(r, 40);
  const pos = g.attributes.position!;
  const R = outerRadiusAt(MEDALLION.y) + MEDALLION.lift;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    // Follow the barrel's horizontal curvature and its slight vertical bulge.
    const Ry = outerRadiusAt(MEDALLION.y + y) + MEDALLION.lift;
    const z = Math.sqrt(Math.max(0, Ry * Ry - x * x)) - R;
    pos.setXYZ(i, x, y + MEDALLION.y, z + R);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** Invisible, generous hit volume for grabbing the tube (sticks included). */
export const HIT_VOLUME = { radiusTop: 0.42, radiusBottom: 0.38, height: 1.45, y: 0.72 } as const;
