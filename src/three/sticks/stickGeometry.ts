/**
 * Stick geometry: a BoxGeometry of `CFG.stick.size` with UVs remapped so only the +Z face shows the
 * full painted column; every other face samples a thin edge strip of the same column (bamboo,
 * nodes and the red tip, but no text).
 */
import { BoxGeometry } from 'three';
import { CFG } from '@/config';

/** Fraction of a column's width sampled by the side/back faces. */
export const EDGE_FRAC = 0.04;

let shared: BoxGeometry | null = null;

export function createStickGeometry(): BoxGeometry {
  const [w, h, d] = CFG.stick.size;
  const g = new BoxGeometry(w, h, d, 1, 1, 1);
  const uv = g.attributes.uv!;
  // Face order: +x, −x, +y, −y, +z, −z (4 vertices each).
  for (let face = 0; face < 6; face++) {
    if (face === 4) continue;
    for (let k = 0; k < 4; k++) {
      const i = face * 4 + k;
      const u = uv.getX(i);
      let v = uv.getY(i);
      if (face === 2) v = 0.995; // top end cap → red tip
      if (face === 3) v = 0.005; // bottom end cap → bamboo end
      const base = face === 5 ? EDGE_FRAC * 0.5 : 0;
      uv.setXY(i, base + u * EDGE_FRAC, v);
    }
  }
  uv.needsUpdate = true;
  return g;
}

/** One geometry shared by the instanced sticks and the hero (never disposed; ~1 KB). */
export function sharedStickGeometry(): BoxGeometry {
  if (!shared) shared = createStickGeometry();
  return shared;
}
