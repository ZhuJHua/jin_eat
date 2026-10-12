/**
 * 筊杯 block geometry: a crescent moon (outer arc r 0.11 minus an inner arc r 0.12 offset 0.07: a
 * ~200° sweep, 0.06 thick at the belly with sharp horns) extruded 0.03 deep with a 0.01 bevel. The
 * +Z side bulges by 0.025·(1 − (x/0.11)²) and is painted red lacquer; the flat −Z side is bare
 * wood. Centred so z = 0 is the mid-plane of the slab.
 */
import { BufferAttribute, type BufferGeometry, Color, ExtrudeGeometry, Shape } from 'three';

export const JIAOBEI_DIMS = { outerR: 0.11, innerR: 0.12, offset: 0.07, depth: 0.03, bevel: 0.01, bulge: 0.025 } as const;

/** Height of the block's centre above the surface it rests on, for a given "round side up" factor. */
export function restLift(roundDown: number): number {
  // Flat side down: half the slab (+bevel). Round side down: the bulge raises it further.
  return 0.024 + JIAOBEI_DIMS.bulge * Math.max(0, Math.min(1, roundDown));
}

export function createJiaobeiGeometry(): BufferGeometry {
  const { outerR: R, innerR: r, offset: d, depth, bevel, bulge } = JIAOBEI_DIMS;
  // Circle intersections: x² + y² = R², x² + (y − d)² = r².
  const yi = (R * R - r * r + d * d) / (2 * d);
  const xi = Math.sqrt(Math.max(0, R * R - yi * yi));
  const aOuter = Math.atan2(yi, xi);
  const aInner = Math.atan2(yi - d, xi);

  const shape = new Shape();
  // Outer arc from the right tip clockwise through the bottom to the left tip.
  shape.absarc(0, 0, R, aOuter, Math.PI - aOuter + Math.PI * 2, true);
  // Inner arc back from the left tip through its bottom to the right tip.
  shape.absarc(0, d, r, Math.PI - aInner, aInner + Math.PI * 2, false);
  shape.closePath();

  const g = new ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel * 0.8,
    bevelSegments: 3,
    curveSegments: 28,
    steps: 1,
  });
  g.translate(0, 0, -depth / 2);
  // Centre the crescent on its own centroid-ish (between the outer bottom and the tips).
  g.computeBoundingBox();
  const bb = g.boundingBox!;
  g.translate(-(bb.min.x + bb.max.x) / 2, -(bb.min.y + bb.max.y) / 2, 0);

  // Bulge the +Z side and colour by side.
  const pos = g.attributes.position!;
  const colors = new Float32Array(pos.count * 3);
  const red = new Color('#b3121b').convertSRGBToLinear();
  const wood = new Color('#c9a06a').convertSRGBToLinear();
  const edge = new Color('#8a5a2c').convertSRGBToLinear();
  const half = depth / 2;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    let c = wood;
    if (z > half - 1e-4) {
      const k = Math.max(0, 1 - (x / R) * (x / R));
      pos.setZ(i, z + bulge * k);
      c = red;
    } else if (z > 0) {
      c = red;
    } else if (z > -half + 1e-4) {
      c = edge;
    }
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  pos.needsUpdate = true;
  g.setAttribute('color', new BufferAttribute(colors, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
