/**
 * Responsive set dressing. The camera framing is wide on desktop and very narrow on portrait
 * phones, so peripheral props slide inward on narrow screens to stay in frame while keeping clear
 * of the tube, the hero landing pose and the 掷筊 landing spots. `t` = 0 for portrait phones, 1 for
 * landscape/desktop.
 */
import { useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import type { Vec3 } from '@/types';

export interface SceneLayout {
  aspect: number;
  t: number;
  censer: Vec3;
  plate: Vec3;
  cup: Vec3;
  /** Rest position of each lantern body centre. */
  lanterns: [Vec3, Vec3];
  /** Cord length from the pivot to the lantern's top cap. */
  lanternCord: number;
  plaque: Vec3;
  plaqueScale: number;
  /** Couplet centre (mirrored in x); hidden when they would be off-screen anyway. */
  couplet: { x: number; y: number; z: number; visible: boolean };
  pillarX: number;
  /** Moon window on the backdrop (world x/y). */
  window: { x: number; y: number; r: number };
}

/** Altar-cloth / altar facts shared with the env pieces. */
export const ALTAR = {
  /** Visual width (wider than the 4 m physics collider so its ends stay off-screen on 16:9). */
  width: 5.6,
  height: 0.25,
  depth: 2.2,
  /** Front face z. */
  front: 1.1,
  floorY: -1.6,
  cabinetInset: 0.1,
} as const;

export const BACKDROP = { radius: 6, arcDeg: 120, height: 6.4, z: -2.5, bottomY: -1.7 } as const;

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const smooth = (e0: number, e1: number, x: number): number => {
  const k = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

export function computeLayout(aspect: number): SceneLayout {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const t = smooth(0.55, 1.3, a);
  const lx = lerp(0.6, 0.98, t);
  const ly = lerp(1.5, 1.4, t);
  const lz = lerp(-0.55, -0.35, t);
  const cx = lerp(0.95, 2.0, smooth(0.9, 1.6, a));
  return {
    aspect: a,
    t,
    censer: lerp3([-0.52, 0, 0.1], [-0.8, 0, 0.22], t),
    plate: lerp3([0.56, 0, -0.06], [0.84, 0, 0.16], t),
    cup: lerp3([0.64, 0, 0.3], [1.14, 0, 0.44], t),
    lanterns: [
      [-lx, ly, lz],
      [lx, ly, lz],
    ],
    lanternCord: 0.5,
    plaque: [0, lerp(1.74, 1.66, t), -0.95],
    plaqueScale: lerp(0.8, 0.72, t),
    couplet: { x: cx, y: 0.92, z: -0.97, visible: a >= 0.9 },
    pillarX: cx,
    window: { x: 0, y: lerp(0.95, 0.9, t), r: lerp(0.62, 0.7, t) },
  };
}

/** Layout for the current canvas aspect (recomputed only when the size changes). */
export function useLayout(): SceneLayout {
  const width = useThree((s) => s.size.width);
  const height = useThree((s) => s.size.height);
  return useMemo(() => computeLayout(height > 0 ? width / height : 1), [width, height]);
}

/**
 * Objects on this layer only are rendered by the main camera but skipped by the ContactShadows
 * capture camera (layer 0), so walls, cloth, smoke and particles never smear the altar shadow.
 * They are also invisible to R3F raycasts, which keeps pointer picking cheap.
 */
export const NO_CONTACT_LAYER = 1;

export function noContact(obj: { layers: { set(layer: number): void } } | null): void {
  obj?.layers.set(NO_CONTACT_LAYER);
}
