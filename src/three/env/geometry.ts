/**
 * Geometry helpers for the set pieces: merge any mix of indexed / non-indexed geometries into one
 * non-indexed BufferGeometry, keeping only the attributes every part shares (or the listed ones).
 * Inputs are disposed.
 */
import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export function mergeAll(parts: BufferGeometry[], keep?: readonly string[]): BufferGeometry {
  const flat = parts.map((g) => {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.dispose();
    return ng;
  });
  const names = keep ?? Object.keys(flat[0]?.attributes ?? {}).filter((n) => flat.every((g) => g.getAttribute(n) !== undefined));
  for (const g of flat) {
    for (const n of Object.keys(g.attributes)) if (!names.includes(n)) g.deleteAttribute(n);
    g.morphAttributes = {};
  }
  const merged = mergeGeometries(flat, false);
  for (const g of flat) g.dispose();
  if (!merged) throw new Error('[env] geometry merge failed');
  return merged;
}
